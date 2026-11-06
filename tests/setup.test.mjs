import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runSetup, inspectSetup } from '../scripts/setup.mjs';
import { checkSetup } from '../scripts/check.mjs';
import { updateCheckout } from '../scripts/update.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const exists = async name => { try { await fs.lstat(name); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-setup-test-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'checkout');
  const home = path.join(temp, 'home');
  const bin = path.join(temp, 'bin');
  await fs.mkdir(root);
  await fs.mkdir(home);
  await fs.mkdir(bin);
  await fs.cp(path.join(source, 'agent'), path.join(root, 'agent'), { recursive: true });
  await fs.cp(path.join(source, 'manifests'), path.join(root, 'manifests'), { recursive: true });
  const target = path.join(home, 'custom-agent');
  const calls = path.join(temp, 'calls.jsonl');
  const pi = path.join(bin, 'pi');
  // Pi is a prerequisite only; any execution is an unexpected external effect.
  await fs.writeFile(pi, `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FAKE_CALLS, JSON.stringify(process.argv.slice(2))+'\\n');\nprocess.exit(1);\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: '~/custom-agent', PATH: bin, FAKE_CALLS: calls };
  const ask = async (key, message, fallback) => {
    assert.deepEqual([key, message, fallback], ['apply', 'Apply safe changes?', false]);
    return true;
  };
  const setup = options => runSetup({ root, env, ask, log() {}, ...options });
  return { temp, root, home, bin, target, calls, env, ask, setup, settings: path.join(target, 'settings.json'), backups: path.join(home, '.local/state/pi-setup/backups') };
}

test('confirmation in a narrow terminal prints each question once, bounds edits and preserves approval/cancellation', { skip: process.platform !== 'darwin' }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-prompt-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const entry = path.join(temp, 'confirmation.mjs');
  const question = 'Apply safe changes?';
  await fs.writeFile(entry, `import { ask } from ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/prompts.mjs')).href)};
console.log('APPROVED:' + await ask('apply', ${JSON.stringify(question)}, false));
console.log('REPEATED:' + await ask('repeated', 'Reject repeated answer?', false));
console.log('DEFAULT:' + await ask('default', 'Default decline?', false));
try { await ask('cancel', 'Cancel confirmation?', false); } catch { console.log('CANCELLED'); }
console.log('RAW:' + process.stdin.isRaw);
`);
  // macOS's system expect drives a real PTY; neither the key parser nor the prompt is stubbed.
  const driver = path.join(temp, 'terminal.exp');
  await fs.writeFile(driver, `set timeout 10
set stty_init {columns 24 rows 24}
spawn -noecho [lindex $argv 0] [lindex $argv 1]
expect_before timeout { exit 1 }
expect -exact {${question} [y/N]}
send -- "[string repeat y 40][string repeat \\177 39]\\r"
expect -exact {Reject repeated answer? [y/N]}
send -- "yyy\\r"
expect -exact {Default decline? [y/N]}
send -- "\\r"
expect -exact {Cancel confirmation? [y/N]}
send -- "\\033"
expect eof
lassign [wait] pid spawnid osError status
exit $status
`);
  const child = spawn('/usr/bin/expect', ['-f', driver, process.execPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Prompt stalled: ${output}\n${errors}`)); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Prompt exited ${code}: ${output}\n${errors}`)); });
  });
  assert.equal(output.split(question).length - 1, 1);
  const edits = output.split('\r\x1b[2K').slice(1).map(frame => frame.split(/[\r\n]/)[0]);
  assert.ok(edits.length > 40);
  assert.ok(edits.every(frame => frame.length < 24), 'answer redraw must never wrap');
  assert.match(output, /APPROVED:true/);
  assert.match(output, /REPEATED:false/);
  assert.match(output, /DEFAULT:false/);
  assert.match(output, /CANCELLED/);
  assert.match(output, /RAW:false/);
});

// Setup caller-level flows below use no internal implementation stubs.
test('fresh install: preview/prerequisites/cancellation are read-only, then one approval links resources and adds defaults', async t => {
  const f = await fixture(t);
  let prompted = false;
  await f.setup({ dryRun: true, ask: async () => { prompted = true; throw new Error('prompted'); } });
  assert.equal(prompted, false);
  await assert.rejects(f.setup({ env: { ...f.env, PATH: path.join(f.temp, 'missing') } }), /Pi is required on PATH/);
  const cancelledLogs = [];
  await f.setup({ ask: async (key, _message, fallback) => key === 'apply' ? false : fallback, log: line => cancelledLogs.push(line) });
  assert.match(cancelledLogs.join('\n'), /Cancelled; no setup changes applied\. Any source update remains in place/);
  assert.equal(await exists(f.target), false);
  assert.equal(await exists(f.backups), false);
  assert.equal(await exists(f.calls), false);
  let approvals = 0;
  const result = await f.setup({ ask: async (...args) => { approvals++; return f.ask(...args); } });
  assert.equal(approvals, 1);
  assert.equal(result.applied, true);
  assert.equal(result.backup, undefined);
  for (const link of result.links) {
    assert.equal(link.status, 'linked');
    assert.equal(await fs.readlink(link.to), link.from);
  }
  assert.equal((await fs.lstat(path.join(f.target, 'extensions'))).isSymbolicLink(), false);
  assert.equal((await fs.lstat(path.join(f.target, 'skills'))).isSymbolicLink(), false);
  const settings = await readJSON(f.settings);
  assert.deepEqual(settings, await readJSON(path.join(f.root, 'agent/settings.base.json')));
  assert.equal(await exists(f.calls), false);
  assert.equal(await exists(f.backups), false);
  const before = await fs.readFile(f.settings, 'utf8');
  assert.ok((await checkSetup({ root: f.root, env: f.env })).some(line => line.startsWith('linked:')));
  assert.equal(await fs.readFile(f.settings, 'utf8'), before);
  const help = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs'), '--help'], { env: f.env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  const invalid = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs'), '--yes'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown argument/);
  const nonTTY = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs')], { env: f.env, encoding: 'utf8' });
  assert.match(nonTTY.stderr, /TTY/);
});

test('rerun and upstream update preserve settings; new resource links apply and unsafe Git updates refuse without resetting', async t => {
  const f = await fixture(t);
  const gitEnv = { ...f.env, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Setup Test', '-c', 'user.email=setup-test@example.invalid', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  // Only local temporary Git repositories: no real checkout or remote network.
  const upstream = path.join(f.temp, 'upstream.git');
  const publisher = path.join(f.temp, 'publisher');
  git(f.temp, 'init', '--bare', '--initial-branch=main', upstream);
  git(f.root, 'init', '--initial-branch=main');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'Initial fixture');
  git(f.root, 'remote', 'add', 'origin', upstream);
  git(f.root, 'push', '-u', 'origin', 'main');
  git(f.temp, 'clone', upstream, publisher);
  const updateLogs = [];
  const update = () => updateCheckout({ root: f.root, env: gitEnv, log: line => updateLogs.push(line) });
  await f.setup();
  const originalSettings = await fs.readFile(f.settings, 'utf8');

  const originalLink = await fs.lstat(path.join(f.target, 'AGENTS.md'));
  const repeatLogs = [];
  const repeat = await f.setup({ log: line => repeatLogs.push(line), ask: async (key, _message, fallback) => { assert.notEqual(key, 'apply'); return fallback; } });
  assert.equal(repeat.applied, false);
  assert.match(repeatLogs.join('\n'), /No changes needed/);
  assert.equal(await fs.readFile(f.settings, 'utf8'), originalSettings);
  assert.equal(await exists(f.backups), false);
  // Local preferences may change independently between installation and update.
  const customized = await readJSON(f.settings);
  customized.theme = 'my-local-theme';
  customized.terminal.showImages = false;
  customized.custom = { preserved: true };
  const customBytes = JSON.stringify(customized, null, 1) + '\n\n';
  await fs.writeFile(f.settings, customBytes);
  await fs.mkdir(path.join(f.target, 'extensions/local-only'));
  await fs.writeFile(path.join(f.target, 'extensions/local-only/index.ts'), 'local extension');
  const manifestFile = path.join(publisher, 'manifests/resources.json');
  const manifest = await readJSON(manifestFile);
  manifest.extensions.push('agent/extensions/new-resource');
  await fs.mkdir(path.join(publisher, 'agent/extensions/new-resource'));
  await fs.writeFile(path.join(publisher, 'agent/extensions/new-resource/index.ts'), 'export default function () {}\n');
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const baseFile = path.join(publisher, 'agent/settings.base.json');
  const base = await readJSON(baseFile);
  base.terminal.newPreference = true;
  await fs.writeFile(baseFile, JSON.stringify(base));
  git(publisher, 'add', '.');
  git(publisher, 'commit', '-m', 'Add resource and preference');
  git(publisher, 'push');
  const beforeUpdate = git(f.root, 'rev-parse', '--short', 'HEAD');
  update();
  assert.ok(updateLogs.includes(`  Updated: ${beforeUpdate} → ${git(publisher, 'rev-parse', '--short', 'HEAD')}.`));
  assert.match(updateLogs.join('\n'), /Cancelling setup does not undo the pull/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), git(publisher, 'rev-parse', 'HEAD'));
  assert.equal((await readJSON(path.join(f.root, 'agent/settings.base.json'))).terminal.newPreference, true);
  const added = await f.setup();
  assert.equal(await fs.readlink(path.join(f.target, 'extensions/new-resource')), path.join(f.root, 'agent/extensions/new-resource'));
  assert.equal(await fs.readFile(path.join(added.backup, 'settings.json'), 'utf8'), customBytes);
  const reconciled = await readJSON(f.settings);
  assert.deepEqual(reconciled, { ...customized, terminal: { ...customized.terminal, newPreference: true } });
  const reconciledBytes = await fs.readFile(f.settings, 'utf8');
  assert.equal((await fs.lstat(path.join(f.target, 'AGENTS.md'))).ino, originalLink.ino);
  assert.equal(await exists(f.calls), false);
  assert.equal(await fs.readFile(path.join(f.target, 'extensions/local-only/index.ts'), 'utf8'), 'local extension');
  update();
  assert.ok(updateLogs.includes(`  Already up to date at ${git(f.root, 'rev-parse', '--short', 'HEAD')}.`));
  await f.setup({ ask: async () => { throw new Error('no-op must not prompt'); } });
  assert.equal(await fs.readFile(f.settings, 'utf8'), reconciledBytes);
  assert.equal((await fs.readdir(f.backups)).length, 1);
  const head = git(f.root, 'rev-parse', 'HEAD');
  const tracked = path.join(f.root, 'agent/AGENTS.md');
  const trackedBytes = await fs.readFile(tracked, 'utf8');
  await fs.writeFile(tracked, trackedBytes + '\nlocal edit\n');
  assert.throws(update);
  assert.equal(await fs.readFile(tracked, 'utf8'), trackedBytes + '\nlocal edit\n');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  await fs.writeFile(tracked, trackedBytes);
  const untracked = path.join(f.root, 'untracked-local');
  await fs.writeFile(untracked, 'keep untracked');
  assert.throws(update);
  assert.equal(await fs.readFile(untracked, 'utf8'), 'keep untracked');
  await fs.unlink(untracked);
  await fs.writeFile(path.join(f.root, 'local-commit'), 'keep local history');
  git(f.root, 'add', 'local-commit');
  git(f.root, 'commit', '-m', 'Local-only change');
  const localHead = git(f.root, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(publisher, 'upstream-change'), 'upstream addition');
  git(publisher, 'add', 'upstream-change');
  git(publisher, 'commit', '-m', 'Upstream advances');
  git(publisher, 'push');
  assert.throws(update);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), localHead);
  assert.equal(await fs.readFile(path.join(f.root, 'local-commit'), 'utf8'), 'keep local history');
  assert.equal(await exists(path.join(f.root, 'upstream-change')), false);
  assert.equal(await fs.readFile(f.settings, 'utf8'), reconciledBytes);
  assert.equal((await fs.readdir(f.backups)).length, 1);
});

test('existing agent: preserve conflicts, local settings and runtime data; add missing defaults with private settings backup', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.target, 'extensions/move'), { recursive: true });
  const sentinels = {
    'sessions/a.json': 'session', 'todos/a.json': 'todo', 'tasks/a.json': 'task',
    'auth.json': 'private-auth', 'mcp.json': 'private-mcp', 'extensions/local/index.ts': 'local',
    'extensions/move/config.json': '{"local":true}',
  };
  for (const [name, data] of Object.entries(sentinels)) {
    await fs.mkdir(path.dirname(path.join(f.target, name)), { recursive: true });
    await fs.writeFile(path.join(f.target, name), data);
  }
  const local = { theme: 'local', terminal: { showImages: false, localNested: 'keep' }, markdown: ['local override'], defaultTools: ['local-tool'], custom: { keep: true }, extensions: ['local'],
    packages: [{ source: 'npm:pi-updater@1.2.3', extensions: ['!blocked.ts'], skills: [] }], mcpServers: { private: true } };
  const original = JSON.stringify(local, null, 1) + '\n';
  await fs.writeFile(f.settings, '{broken');
  await assert.rejects(f.setup(), /JSON/);
  await fs.writeFile(f.settings, '[]');
  await assert.rejects(f.setup(), /JSON object/);
  await fs.writeFile(f.settings, JSON.stringify({ packages: { ownedElsewhere: true } }));
  assert.deepEqual((await inspectSetup({ root: f.root, env: f.env })).settings.packages, { ownedElsewhere: true });
  await fs.writeFile(f.settings, original);
  const outside = path.join(f.temp, 'original-settings');
  await fs.rename(f.settings, outside);
  await fs.symlink(outside, f.settings);
  await assert.rejects(f.setup(), /settings.json is a symlink/);
  await fs.unlink(f.settings);
  await fs.rename(outside, f.settings);
  await fs.symlink(path.join(f.root, 'agent/extensions/lib'), path.join(f.target, 'extensions/lib'));
  await assert.rejects(f.setup(), /destination resolves into checkout/);
  await fs.unlink(path.join(f.target, 'extensions/lib'));
  await assert.rejects(f.setup({ env: { ...f.env, PI_CODING_AGENT_DIR: f.root } }), /Unsafe layout/);
  assert.equal(await exists(f.backups), false);
  assert.equal(await exists(f.calls), false);
  await fs.writeFile(path.join(f.target, 'AGENTS.md'), 'original instructions');
  await fs.symlink('/nonexistent/pi-setup-old', path.join(f.target, 'extensions/continue'));
  await fs.mkdir(path.join(f.target, 'extensions/task'));
  await fs.writeFile(path.join(f.target, 'extensions/task/local-data'), 'original task data');
  const before = await fs.readFile(f.settings, 'utf8');
  await f.setup({ dryRun: true, ask: async () => { throw new Error('dry run must not prompt'); } });
  await f.setup({ ask: async () => false });
  assert.equal(await fs.readFile(f.settings, 'utf8'), before);
  assert.equal(await exists(f.backups), false);
  const approved = await f.setup();
  assert.equal(await fs.readFile(path.join(f.target, 'AGENTS.md'), 'utf8'), 'original instructions');
  assert.equal(await fs.readlink(path.join(f.target, 'extensions/continue')), '/nonexistent/pi-setup-old');
  assert.equal(await fs.readFile(path.join(f.target, 'extensions/task/local-data'), 'utf8'), 'original task data');
  assert.deepEqual(await fs.readdir(approved.backup), ['settings.json']);
  assert.equal(await fs.readFile(path.join(approved.backup, 'settings.json'), 'utf8'), original);
  assert.equal((await fs.stat(approved.backup)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(approved.backup, 'settings.json'))).mode & 0o777, 0o600);
  const settings = await readJSON(f.settings);
  const base = await readJSON(path.join(f.root, 'agent/settings.base.json'));
  assert.deepEqual(settings, { ...base, ...local, terminal: { ...base.terminal, ...local.terminal } });
  assert.equal(await exists(f.calls), false);
  assert.equal((await fs.lstat(path.join(f.target, 'extensions/move'))).isDirectory(), true);
  const inspection = await inspectSetup({ root: f.root, env: f.env });
  assert.equal(Object.hasOwn(inspection, 'packages'), false);
  assert.ok(inspection.preferences.every(change => change.conflict));
  const savedBytes = await fs.readFile(f.settings, 'utf8');
  await f.setup({ ask: async () => { throw new Error('no-op must not prompt'); } });
  assert.equal(await fs.readFile(f.settings, 'utf8'), savedBytes);
  assert.equal((await fs.readdir(f.backups)).length, 1);
  for (const [name, data] of Object.entries(sentinels)) assert.equal(await fs.readFile(path.join(f.target, name), 'utf8'), data);
});
