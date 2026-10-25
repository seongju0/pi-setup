import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runSetup } from '../scripts/setup.mjs';
import { checkSetup } from '../scripts/check.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = async file => { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const read = file => fs.readFile(file, 'utf8');
async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-tools-test-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'checkout');
  const home = path.join(temp, 'home');
  const bin = path.join(temp, 'bin');
  const target = path.join(home, 'custom agent');
  for (const directory of [path.join(root, 'manifests'), path.join(root, 'agent'), bin, path.join(target, 'extensions/local')]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, 'manifests/resources.json'), JSON.stringify({ instructions: [], extensions: [], support: [], skills: [] }));
  await fs.writeFile(path.join(root, 'manifests/packages.json'), '[]');
  await fs.writeFile(path.join(root, 'agent/settings.base.json'), '{}');
  const catalog = path.join(root, 'manifests/tools.json');
  await fs.copyFile(path.join(source, 'manifests/tools.json'), catalog);
  const settings = path.join(target, 'settings.json');
  const settingsBytes = '{ "theme": "local", "packages": [{"source":"npm:local", "extensions":["!blocked"], "skills":[]}] }\n\n';
  await fs.writeFile(settings, settingsBytes);
  const sentinel = path.join(target, 'extensions/local/index.ts');
  await fs.writeFile(sentinel, 'local-only');
  const history = path.join(home, '.local/state/pi-setup/tools.json');
  const calls = path.join(temp, 'calls.jsonl');
  const env = { ...process.env, HOME: home, PATH: bin, PI_CODING_AGENT_DIR: target, TOOL_CALLS: calls, TOOL_BIN: bin };
  const executable = async (name, code) => fs.writeFile(path.join(bin, name), `#!${process.execPath}\n${code}\n`, { mode: 0o755 });
  await executable('pi', 'throw new Error("Pi install was not selected");');
  // Only owner-native executable boundaries are synthetic. Real subprocesses
  // record their input and materialize the executable as a native install does.
  const ghCode = `const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2), installed=path.join(process.env.TOOL_BIN,'gh-stack-installed');
if(args[0]==='extension' && args[1]==='list') { if(fs.existsSync(installed)) console.log('gh stack\\tgithub/gh-stack\\tv0.2.0'); process.exit(0); }
if(args.join(' ')==='skill install --help') process.exit(process.env.GH_NO_SKILLS ? 1 : 0);
fs.appendFileSync(process.env.TOOL_CALLS,JSON.stringify({owner:'gh',args})+'\\n');
if(process.env.TOOL_FAIL){fs.writeFileSync(path.join(process.env.TOOL_BIN,'partial'),'approved partial');process.exit(9);}
if(args[0]==='extension') fs.writeFileSync(installed,'installed');
else { const destination=path.join(args[args.indexOf('--dir')+1],args[3]); fs.mkdirSync(destination,{recursive:true}); fs.writeFileSync(path.join(destination,'SKILL.md'),'synthetic upstream skill'); }
`;
  const ownerCode = `const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.TOOL_CALLS,JSON.stringify({owner:path.basename(process.argv[1]),args})+'\\n');
if(process.env.TOOL_FAIL){fs.writeFileSync(path.join(process.env.TOOL_BIN,'partial'),'approved partial');process.exit(9);}
const name=args.at(-1);
fs.writeFileSync(path.join(process.env.TOOL_BIN,name),name==='gh' ? ${JSON.stringify(`#!${process.execPath}\n`)}+${JSON.stringify(ghCode)} : ${JSON.stringify(`#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.TOOL_CALLS,JSON.stringify({owner:'agent-browser',args:process.argv.slice(2)})+'\\n');\n`)},{mode:0o755});`;
  await executable('brew', ownerCode);
  await executable('npm', ownerCode);
  const logs = [];
  const ask = async (key, _message, fallback) => key === 'apply' ? true : key.startsWith('group:') ? false : fallback;
  const setup = options => runSetup({ root, env, toolsMode: 'all', ask, log: line => logs.push(line), ...options });
  const ids = JSON.parse(await read(catalog)).map(tool => tool.id);
  return { root, home, target, bin, env, catalog, ids, history, calls, settings, settingsBytes, sentinel, executable, ownerCode, ghCode, logs, setup, ask };
}

test('tool offers: approved install, update discovery/history, install revisits and local-data-preserving reruns', async t => {
  const f = await fixture(t);
  let selectionCalls = 0;
  const installed = await f.setup({ selectTools: async offers => {
    selectionCalls++;
    assert.ok(offers.every(tool => tool.selected === false));
    assert.deepEqual(offers.map(tool => tool.id), f.ids);
    assert.equal(await exists(f.history), false);
    assert.equal(await exists(f.calls), false);
    return ['herdr'];
  }, ask: async (key, message, fallback) => {
    if (key === 'apply') {
      assert.equal(fallback, false);
      assert.ok(f.logs.some(line => line === 'COMMAND brew install herdr'));
      assert.ok(f.logs.some(line => line.includes('REMEMBER')));
      assert.equal(await exists(f.history), false);
      assert.equal(await exists(f.calls), false);
    }
    return f.ask(key, message, fallback);
  } });
  assert.equal(installed.applied, true);
  assert.deepEqual(JSON.parse((await read(f.calls)).trim()), { owner: 'brew', args: ['install', 'herdr'] });
  assert.deepEqual(JSON.parse(await read(f.history)).seen, f.ids);
  assert.equal((await fs.stat(f.history)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(f.history))).mode & 0o777, 0o700);
  const beforeHistory = await read(f.history);
  const beforeCalls = await read(f.calls);
  const noOffers = await f.setup({ toolsMode: 'new', selectTools: async () => assert.fail('seen declines/installed tools must not be reoffered'), ask: async (key, message, fallback) => { assert.notEqual(key, 'apply'); return f.ask(key, message, fallback); } });
  assert.equal(noOffers.applied, false);
  assert.equal(await read(f.history), beforeHistory);
  // A later pushed catalog is read by a fresh run, without schema/version machinery.
  const catalog = JSON.parse(await read(f.catalog));
  catalog.push({ id: 'new-tool', name: 'New tool', executable: 'new-tool', prerequisite: 'brew', commands: [{ executable: 'brew', args: ['install', 'new-tool'] }] });
  await fs.writeFile(f.catalog, JSON.stringify(catalog));
  let confirmedEmpty = false;
  await f.setup({ toolsMode: 'new', selectTools: async offers => {
    assert.deepEqual(offers.map(tool => tool.id), ['new-tool']);
    assert.equal(offers[0].selected, false);
    return [];
  }, ask: async (key, message, fallback) => {
    if (key === 'apply') { confirmedEmpty = true; assert.equal(fallback, false); }
    return f.ask(key, message, fallback);
  } });
  assert.equal(confirmedEmpty, true);
  assert.ok(JSON.parse(await read(f.history)).seen.includes('new-tool'));
  await f.setup({ selectTools: async offers => {
    selectionCalls++;
    assert.deepEqual(offers.map(tool => tool.id), [...f.ids.filter(id => id !== 'herdr'), 'new-tool']);
    assert.ok(offers.every(tool => !tool.selected));
    return [];
  } });
  assert.equal(selectionCalls, 2);
  await f.setup({ toolsMode: 'new', selectTools: async () => assert.fail('idempotent rerun'), ask: async (key, message, fallback) => { assert.notEqual(key, 'apply'); return f.ask(key, message, fallback); } });
  assert.equal(await read(f.calls), beforeCalls);
  assert.equal(await read(f.settings), f.settingsBytes);
  assert.equal(await read(f.sentinel), 'local-only');
  const check = await checkSetup({ root: f.root, env: f.env });
  assert.ok(check.some(line => line.startsWith('optional tool installed: Herdr')));
  assert.ok(check.some(line => line.includes('agent-browser') && line.includes('previously offered')));

  // A fresh consumer can explicitly select gh and its dependent extension/skills
  // in one run. Existing CLIs do not hide missing companion skill offers.
  const fresh = await fixture(t);
  for (const name of ['herdr', 'agent-browser']) await fresh.executable(name, 'process.exit(0);');
  await fs.mkdir(path.dirname(fresh.history), { recursive: true });
  await fs.writeFile(fresh.history, JSON.stringify({ seen: ['herdr', 'agent-browser'] }));
  await fresh.setup({ toolsMode: 'new', selectTools: async offers => {
    assert.ok(!offers.some(tool => ['herdr', 'agent-browser'].includes(tool.id)));
    assert.ok(offers.some(tool => tool.id === 'herdr-skill'));
    assert.deepEqual(offers.find(tool => tool.id === 'gh-stack').requires, ['gh']);
    return ['gh', 'gh-stack', 'gh-stack-skill', 'herdr-skill', 'agent-browser-skill'];
  } });
  const skillArgs = (repository, name) => ['skill', 'install', repository, name, '--dir', path.join(fresh.target, 'skills')];
  const nativeCalls = (await read(fresh.calls)).trim().split('\n').map(JSON.parse);
  assert.deepEqual(nativeCalls, [
    { owner: 'brew', args: ['install', 'gh'] },
    { owner: 'gh', args: ['extension', 'install', 'github/gh-stack'] },
    { owner: 'gh', args: skillArgs('github/gh-stack', 'gh-stack') },
    { owner: 'gh', args: skillArgs('herdrdev/herdr', 'herdr') },
    { owner: 'gh', args: skillArgs('vercel-labs/agent-browser', 'agent-browser') },
  ]);
  for (const name of ['gh-stack', 'herdr', 'agent-browser']) assert.equal(await read(path.join(fresh.target, 'skills', name, 'SKILL.md')), 'synthetic upstream skill');
  assert.equal(await exists(path.join(fresh.home, '.pi/agent/skills')), false);
  await fresh.setup({ selectTools: () => assert.fail('all selected choices already present') });
  assert.equal(await read(fresh.calls), nativeCalls.map(call => JSON.stringify(call)).join('\n') + '\n');
  assert.equal(await read(fresh.settings), fresh.settingsBytes);
});

test('tool boundaries: dry run/cancel/prerequisites stay read-only and failed approved native install remains retryable', async t => {
  const f = await fixture(t);
  await f.setup({ dryRun: true, ask: () => assert.fail('dry run prompt'), selectTools: () => assert.fail('dry run checklist') });
  assert.ok(f.logs.some(line => line === 'OPTIONAL COMMAND npm install -g agent-browser'));
  assert.ok(f.logs.some(line => line === 'OPTIONAL COMMAND agent-browser install'));
  assert.equal(await exists(f.history), false);
  await assert.rejects(f.setup({ selectTools: async () => null }), /Cancelled/);
  await assert.rejects(f.setup({ selectTools: async () => ['not-a-tool'] }), /Invalid optional-tool selection/);
  await assert.rejects(f.setup({ selectTools: async () => ['herdr-skill'] }), /requires selecting GitHub CLI.*nothing changed/);
  await f.setup({ selectTools: async () => ['herdr'], ask: async (key, _message, fallback) => key === 'apply' ? false : fallback });
  await fs.unlink(path.join(f.bin, 'brew'));
  await f.setup({ selectTools: async offers => {
    const herdr = offers.find(tool => tool.id === 'herdr');
    assert.equal(herdr.available, false);
    assert.match(herdr.reason, /Missing brew.*Install Homebrew yourself/);
    return [];
  }, ask: async () => false });
  await assert.rejects(f.setup({ selectTools: async () => ['herdr'] }), /Invalid optional-tool selection/);
  assert.equal(await exists(f.history), false);
  assert.equal(await exists(f.calls), false);
  assert.equal(await exists(path.dirname(f.history)), false);
  await f.executable('brew', f.ownerCode);
  await assert.rejects(f.setup({ env: { ...f.env, TOOL_FAIL: '1' }, selectTools: async () => ['herdr'] }), /Setup stopped:.*failed.*Approved earlier changes may remain.*No rollback/);
  assert.equal(await read(path.join(f.bin, 'partial')), 'approved partial');
  assert.equal(await exists(f.history), false);
  assert.equal(await read(f.settings), f.settingsBytes);
  assert.equal(await read(f.sentinel), 'local-only');
  // Retry still offers the failed choice. One browser selection runs both
  // approved official steps in order, never a real install or download.
  await f.setup({ selectTools: async offers => {
    assert.equal(offers.find(tool => tool.id === 'herdr').seen, false);
    return ['agent-browser'];
  } });
  const calls = (await read(f.calls)).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.slice(1), [
    { owner: 'npm', args: ['install', '-g', 'agent-browser'] },
    { owner: 'agent-browser', args: ['install'] },
  ]);
  await f.setup({ selectTools: async offers => {
    assert.deepEqual(offers.map(tool => tool.id), f.ids.filter(id => id !== 'agent-browser'));
    return [];
  } });
  assert.equal((await read(f.calls)).trim().split('\n').length, 3);
  // Existing directories and even broken links belong to the client. A missing
  // companion can be installed independently; no extension reinstall is needed.
  await f.executable('gh', f.ghCode);
  await fs.writeFile(path.join(f.bin, 'gh-stack-installed'), 'already installed');
  await fs.mkdir(path.join(f.target, 'skills/gh-stack'), { recursive: true });
  await fs.writeFile(path.join(f.target, 'skills/gh-stack/SKILL.md'), 'client-owned');
  await fs.symlink(path.join(f.home, 'missing-owner-content'), path.join(f.target, 'skills/agent-browser'));
  await f.setup({ env: { ...f.env, GH_NO_SKILLS: '1' }, selectTools: async offers => {
    assert.ok(!offers.some(tool => ['gh', 'gh-stack', 'gh-stack-skill', 'agent-browser-skill'].includes(tool.id)));
    const herdr = offers.find(tool => tool.id === 'herdr-skill');
    assert.equal(herdr.available, false);
    assert.match(herdr.reason, /no gh skill support/);
    return [];
  }, ask: async () => false });
  await f.setup({ selectTools: async offers => {
    assert.ok(!offers.some(tool => ['gh', 'gh-stack', 'gh-stack-skill', 'agent-browser-skill'].includes(tool.id)));
    return ['herdr-skill'];
  } });
  assert.equal(await read(path.join(f.target, 'skills/gh-stack/SKILL.md')), 'client-owned');
  assert.equal(await fs.readlink(path.join(f.target, 'skills/agent-browser')), path.join(f.home, 'missing-owner-content'));
  assert.equal(await read(path.join(f.target, 'skills/herdr/SKILL.md')), 'synthetic upstream skill');
  assert.deepEqual(JSON.parse((await read(f.calls)).trim().split('\n').at(-1)), {
    owner: 'gh', args: ['skill', 'install', 'herdrdev/herdr', 'herdr', '--dir', path.join(f.target, 'skills')],
  });
  assert.equal(await read(f.settings), f.settingsBytes);
  const badHistory = '{bad';
  await fs.writeFile(f.history, badHistory);
  await assert.rejects(f.setup({ selectTools: () => assert.fail('invalid state must stop before selection') }), /Repair optional-tool history at/);
  assert.equal(await read(f.history), badHistory);
});
