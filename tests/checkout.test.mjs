import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const skill = fileURLToPath(new URL('../agent/skills/checkout/', import.meta.url));
const exists = async location => { try { await fs.lstat(location); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-checkout-test-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const remotes = path.join(temp, 'remotes');
  const cache = path.join(temp, 'cache with spaces');
  await fs.mkdir(home);
  await fs.mkdir(remotes);
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0', CHECKOUT_CACHE_ROOT: cache, CHECKOUT_DEFAULT_HOST: 'fixture.invalid', CHECKOUT_UPDATE_INTERVAL: '300' };
  // Isolate host Git targeting/config injection as well as credentials. Production
  // still inherits trusted config; these tests use only their local URL rewrite.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT'].includes(key)) delete env[key];
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(temp, 'config', '--global', `url.${pathToFileURL(`${remotes}/`).href}.insteadOf`, 'https://fixture.invalid/');
  git(temp, 'config', '--global', 'user.name', 'Checkout Test');
  git(temp, 'config', '--global', 'user.email', 'checkout@example.invalid');
  const cli = (args, { shell = false, extraEnv = {} } = {}) => spawnSync(shell ? 'bash' : process.execPath, [path.join(skill, shell ? 'checkout.sh' : 'checkout.mjs'), ...args], { cwd: temp, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const success = (args, options) => {
    const result = cli(args, options);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const seed = async (name = 'team/repo') => {
    const remote = path.join(remotes, `${name}.git`);
    const publisher = path.join(temp, `publisher-${name.replaceAll('/', '-')}`);
    await fs.mkdir(path.dirname(remote), { recursive: true });
    git(temp, 'init', '--bare', '--initial-branch=main', remote);
    git(temp, 'init', '--initial-branch=main', publisher);
    await fs.writeFile(path.join(publisher, 'source.txt'), 'initial\n');
    git(publisher, 'add', '.');
    git(publisher, 'commit', '-m', 'initial');
    git(publisher, 'remote', 'add', 'origin', remote);
    git(publisher, 'push', '-u', 'origin', 'main');
    const destination = path.join(cache, 'fixture.invalid', name);
    return { name, remote, publisher, destination, marker: path.join(destination, '.git/pi-checkout-last-fetch') };
  };
  const publish = async (repo, filename, content) => {
    await fs.writeFile(path.join(repo.publisher, filename), content);
    git(repo.publisher, 'add', '.');
    git(repo.publisher, 'commit', '-m', `update ${filename}`);
    git(repo.publisher, 'push');
    return git(repo.publisher, 'rev-parse', 'HEAD');
  };
  return { temp, home, cache, remotes, env, git, cli, success, seed, publish };
}
function failed(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.length > 0);
}

// Exactly four caller-level flows, real CLI + Git, no internal stubs.
test('A: supported shell caller and equivalent references clone and reuse one canonical cache', async t => {
  const f = await fixture(t);
  const r = await f.seed();
  // The launcher itself also lives under a path containing spaces.
  const launcher = path.join(f.temp, 'skill with spaces');
  await fs.mkdir(launcher);
  await fs.copyFile(path.join(skill, 'checkout.sh'), path.join(launcher, 'checkout.sh'));
  await fs.copyFile(path.join(skill, 'checkout.mjs'), path.join(launcher, 'checkout.mjs'));
  const first = spawnSync('bash', [path.join(launcher, 'checkout.sh'), r.name, '--path-only'], { cwd: f.temp, env: f.env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, `${r.destination}\n`);
  assert.equal(f.git(r.destination, 'config', '--get', 'remote.origin.url'), 'https://fixture.invalid/team/repo.git');
  assert.equal(await fs.readFile(path.join(r.destination, 'source.txt'), 'utf8'), 'initial\n');
  const head = f.git(r.destination, 'rev-parse', 'HEAD');
  const receipt = await fs.readFile(r.marker, 'utf8');
  for (const ref of ['https://fixture.invalid/team/repo.git/?q=ignored#fragment', 'git@fixture.invalid:team/repo.git', 'ssh://git@fixture.invalid/team/repo.git']) {
    assert.equal(f.success(['--path-only', ref]).stdout, `${r.destination}\n`);
    assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), head);
    assert.equal(await fs.readFile(r.marker, 'utf8'), receipt);
  }
  const summary = f.success([r.name]).stdout;
  assert.match(summary, /reused/);
  assert.match(summary, /throttled/);
  const nested = await f.seed('group/subgroup/repo');
  // An inherited target must not redirect helper operations into the publisher.
  assert.equal(f.success([nested.name, '--path-only'], { extraEnv: { GIT_DIR: path.join(r.publisher, '.git'), GIT_WORK_TREE: r.publisher, GIT_INDEX_FILE: path.join(r.publisher, '.git/index') } }).stdout, `${nested.destination}\n`);
  assert.equal(f.git(r.publisher, 'remote', 'get-url', 'origin'), r.remote);
});

test('B: throttled, forced and interval refreshes succeed; fetch and clone failures return no path', async t => {
  const f = await fixture(t);
  const r = await f.seed();
  f.success([r.name, '--path-only']);
  const initial = f.git(r.destination, 'rev-parse', 'HEAD');
  const next = await f.publish(r, 'new.txt', 'new content\n');
  f.success([r.name, '--path-only']);
  assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), initial);
  f.success([r.name, '--force-update', '--path-only']);
  assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), next);
  assert.equal(await fs.readFile(path.join(r.destination, 'new.txt'), 'utf8'), 'new content\n');
  const oldMarker = path.join(r.destination, '.git/checkout-last-fetch');
  await fs.writeFile(oldMarker, 'old arbitrary receipt\n');
  await fs.writeFile(r.marker, '1\n');
  const newer = await f.publish(r, 'new.txt', 'newer content\n');
  f.success([r.name, '--update-interval', '0', '--path-only'], { extraEnv: { CHECKOUT_UPDATE_INTERVAL: 'invalid-overridden-value' } });
  assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), newer);
  assert.equal(await fs.readFile(oldMarker, 'utf8'), 'old arbitrary receipt\n');
  // Existing caches without the new receipt fetch once, ignoring the old file.
  await fs.unlink(r.marker);
  const newest = await f.publish(r, 'new.txt', 'newest content\n');
  f.success([r.name, '--path-only']);
  assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), newest);
  assert.equal(await fs.readFile(oldMarker, 'utf8'), 'old arbitrary receipt\n');
  const receipt = await fs.readFile(r.marker, 'utf8');
  await fs.rename(r.remote, `${r.remote}.unavailable`);
  failed(f.cli([r.name, '--force-update', '--path-only']));
  assert.equal(await fs.readFile(r.marker, 'utf8'), receipt);
  assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), newest);
  failed(f.cli(['team/missing', '--path-only']));
});

test('C: fetch preserves tracked edits, divergent history, ignored collisions and detached HEAD without hooks', async t => {
  const f = await fixture(t);
  const hookDir = path.join(f.temp, 'hooks');
  const sentinel = path.join(f.temp, 'hook-ran');
  await fs.mkdir(hookDir);
  for (const hook of ['post-checkout', 'pre-merge-commit', 'post-merge']) await fs.writeFile(path.join(hookDir, hook), `#!/bin/sh\nprintf ran > '${sentinel}'\n`, { mode: 0o755 });
  f.git(f.temp, 'config', '--global', 'core.hooksPath', hookDir);
  for (const state of ['dirty', 'diverged', 'ignored', 'detached']) {
    const r = await f.seed(`team/${state}`);
    f.success([r.name, '--path-only'], { shell: true });
    if (state === 'dirty') await fs.writeFile(path.join(r.destination, 'source.txt'), 'local edits\n');
    if (state === 'diverged') {
      await fs.writeFile(path.join(r.destination, 'local.txt'), 'local commit\n');
      f.git(r.destination, 'add', '.');
      f.git(r.destination, 'commit', '-m', 'local history');
    }
    if (state === 'ignored') {
      await fs.appendFile(path.join(r.destination, '.git/info/exclude'), '\ncollision.txt\n');
      await fs.writeFile(path.join(r.destination, 'collision.txt'), 'local ignored data\n');
    }
    if (state === 'detached') f.git(r.destination, '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach');
    const before = f.git(r.destination, 'rev-parse', 'HEAD');
    const beforeSource = await fs.readFile(path.join(r.destination, 'source.txt'), 'utf8');
    const next = await f.publish(r, state === 'ignored' ? 'collision.txt' : 'remote.txt', 'upstream data\n');
    const result = f.success([r.name, '--force-update', '--path-only']);
    assert.equal(result.stdout, `${r.destination}\n`);
    assert.match(result.stderr, /Warning:/);
    assert.equal(f.git(r.destination, 'rev-parse', 'origin/main'), next);
    assert.equal(f.git(r.destination, 'rev-parse', 'HEAD'), before);
    assert.equal(await fs.readFile(path.join(r.destination, 'source.txt'), 'utf8'), beforeSource);
    if (state === 'ignored') assert.equal(await fs.readFile(path.join(r.destination, 'collision.txt'), 'utf8'), 'local ignored data\n');
    if (state === 'diverged') assert.equal(await fs.readFile(path.join(r.destination, 'local.txt'), 'utf8'), 'local commit\n');
    assert.equal(f.git(r.destination, 'stash', 'list'), '');
    assert.equal(f.git(r.destination, 'rev-list', '--count', '--merges', 'HEAD'), '0');
  }
  assert.equal(await exists(sentinel), false);
});

test('D: malformed references and occupied or escaping cache paths fail before mutation; help and deep links work', async t => {
  const f = await fixture(t);
  for (const args of [
    ['../repo'], ['https://fixture.invalid/team/../repo'], ['https://fixture.invalid/team/%2e%2e/repo'],
    ['https://bad_host/team/repo'], ['file:///team/repo'], ['team/repo', '--update-interval', '-1'], ['team/repo', '--unknown'],
  ]) {
    failed(f.cli([...args, '--path-only']));
    assert.equal(await exists(f.cache), false);
  }
  const occupied = path.join(f.cache, 'fixture.invalid/team/occupied');
  await fs.mkdir(occupied, { recursive: true });
  await fs.writeFile(path.join(occupied, 'sentinel'), 'keep\n');
  failed(f.cli(['team/occupied', '--path-only']));
  assert.equal(await fs.readFile(path.join(occupied, 'sentinel'), 'utf8'), 'keep\n');
  assert.equal(await exists(path.join(occupied, '.git')), false);
  const outside = path.join(f.temp, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel'), 'outside\n');
  await fs.symlink(outside, path.join(f.cache, 'fixture.invalid/escape'));
  failed(f.cli(['escape/repo', '--path-only']));
  assert.deepEqual(await fs.readdir(outside), ['sentinel']);
  assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'outside\n');
  const helpRoot = path.join(f.temp, 'help-must-not-create');
  assert.match(f.success(['--help'], { extraEnv: { CHECKOUT_CACHE_ROOT: helpRoot, CHECKOUT_UPDATE_INTERVAL: 'invalid' } }).stdout, /Usage:/);
  assert.equal(await exists(helpRoot), false);
  const r = await f.seed('owner/repo');
  f.git(f.temp, 'config', '--global', `url.${pathToFileURL(`${f.remotes}/`).href}.insteadOf`, 'https://github.com/');
  const deep = f.success(['https://github.com/owner/repo/tree/main/source.txt', '--path-only']);
  const destination = path.join(f.cache, 'github.com/owner/repo');
  assert.equal(deep.stdout, `${destination}\n`);
  assert.equal(f.git(destination, 'config', '--get', 'remote.origin.url'), 'https://github.com/owner/repo.git');
  assert.equal(await fs.readFile(path.join(destination, 'source.txt'), 'utf8'), 'initial\n');
  assert.equal(f.git(destination, 'rev-parse', 'HEAD'), f.git(r.publisher, 'rev-parse', 'HEAD'));
});
