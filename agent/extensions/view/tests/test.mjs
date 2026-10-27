// Real Pi command loader and subprocesses; only the external GUI editor is synthetic.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.env.PI_TEST_PACKAGE_ROOT || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'pi-view-test-')));
const originalEnv = { ...process.env };
const agent = join(scratch, 'personal agent');
const cwd = join(scratch, 'workspace with spaces');
const bin = join(scratch, 'bin');
const log = join(scratch, 'editor.jsonl');
const settingsPath = join(agent, 'settings.json');
const notices = [];
async function calls() {
  try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function until(check) {
  for (let count = 0; count < 200; count++) { if (await check()) return; await delay(10); }
  throw new Error('Timed out waiting for synthetic editor');
}
async function editor(file) {
  await writeFile(file, `#!${process.execPath}\nconst fs = require('node:fs');
fs.appendFileSync(process.env.VIEW_TEST_LOG, JSON.stringify({ editor: process.argv[1], args: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }) + '\\n');
setInterval(() => {}, 1000); // A GUI can outlive the command and the Pi session.
`, { mode: 0o755 });
}

try {
  for (const path of [agent, bin, join(cwd, '.pi')]) await mkdir(path, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.PATH = bin;
  process.env.VIEW_TEST_LOG = log;
  process.env.EDITOR = process.env.VISUAL = 'must-not-inherit-terminal-editor';
  await editor(join(bin, 'zed'));
  await writeFile(join(cwd, '.pi/settings.json'), JSON.stringify({ view: { editor: 'must-not-execute-project-config' } }));
  const loaded = await loadExtensions([join(dirname(fileURLToPath(import.meta.url)), '../index.ts')], cwd, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  const command = loaded.extensions[0].commands.get('view');
  const ctx = { cwd, ui: { notify: (message, level) => notices.push({ message, level }) } };

  // Default /view preserves the current directory and returns before the GUI exits.
  let timer;
  try {
    await Promise.race([
      command.handler('', ctx),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('/view waited for the GUI to exit')), 1500); }),
    ]);
  } finally { clearTimeout(timer); }
  await until(async () => (await calls()).length === 1);
  const first = (await calls())[0];
  assert.deepEqual(first.args, [cwd]);
  assert.equal(first.editor, join(bin, 'zed'));
  assert.equal(first.cwd, cwd);
  assert.equal(notices.at(-1).level, 'info');
  assert.doesNotThrow(() => process.kill(first.pid, 0), 'editor stays open after /view resolves');

  // Arguments stay separate, including spaces and shell metacharacters. Personal
  // configuration is read on every call, never from EDITOR/VISUAL or the project.
  const custom = join(bin, 'custom editor');
  await editor(custom);
  const editorArgs = ['--reuse-window', 'value with spaces', '$(touch SHOULD_NOT_EXIST)'];
  const settings = JSON.stringify({ theme: 'untouched', view: { editor: custom, args: editorArgs } });
  await writeFile(settingsPath, settings);
  const relative = 'folder with spaces/file;literal.txt';
  await command.handler(relative, ctx);
  await until(async () => (await calls()).length === 2);
  const second = (await calls())[1];
  assert.equal(second.editor, custom);
  assert.deepEqual(second.args, [...editorArgs, resolve(cwd, relative)]);
  assert.equal(await readFile(settingsPath, 'utf8'), settings, 'viewing never writes personal settings');
  await assert.rejects(access(join(cwd, 'SHOULD_NOT_EXIST')), { code: 'ENOENT' });
  const absolute = join(scratch, 'absolute file.txt');
  await command.handler(absolute, ctx);
  await until(async () => (await calls()).length === 3);
  assert.deepEqual((await calls())[2].args, [...editorArgs, absolute]);

  // Missing editor and malformed configuration produce errors, never success
  // or an unhandled subprocess error that could crash the Pi process.
  for (const config of [JSON.stringify({ view: { editor: 'not-installed-editor' } }), JSON.stringify({ view: { args: '--new-window' } }), '{bad json']) {
    await writeFile(settingsPath, config);
    const before = notices.length;
    await command.handler('', ctx);
    assert.equal(notices.length, before + 1);
    assert.equal(notices.at(-1).level, 'error');
  }
  assert.equal((await calls()).length, 3);
  console.log('view checks passed: default Zed/cwd, nonblocking GUI launch, personal editor/argv, literal paths, no shell/environment/project overrides, settings preservation, and configuration/launch failures');
} finally {
  for (const call of await calls()) {
    try { process.kill(call.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(scratch, { recursive: true, force: true });
}
