// Run from the repository root: npm test. Direct: node agent/extensions/update-skills/tests/test.mjs
// Real extension loader; temporary skill roots only, no network or update subprocesses.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const scratch = await mkdtemp(join(tmpdir(), 'skills-inventory-test-'));
const agent = join(scratch, 'agent');
const ext = join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.ts');
const original = process.env.PI_CODING_AGENT_DIR;
async function skill(name, body) { const dir = join(agent, 'skills', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), body); return dir; }
try {
  process.env.PI_CODING_AGENT_DIR = agent;
  await skill('remote', '---\nname: remote\ndescription: remote\nmetadata:\n  github-repo: https://github.com/acme/remote\n---\n');
  await skill('local', '---\nname: local\ndescription: local\n---\n');
  await skill('gws-docs', '---\nname: gws-docs\ndescription: generated\nmetadata:\n  version: 1\n---\n');
  const owner = join(scratch, 'terminal-browser-owner');
  await mkdir(owner); await writeFile(join(owner, 'SKILL.md'), '---\nname: terminal-browser\ndescription: owner\n---\n');
  await symlink(owner, join(agent, 'skills', 'terminal-browser'));
  await symlink(join(dirname(ext), '../../skills/build'), join(agent, 'skills', 'build'));
  await mkdir(join(agent, 'extensions'));
  await symlink(dirname(ext), join(agent, 'extensions', 'update-skills'));
  const runtime = createExtensionRuntime();
  const loaded = await loadExtensions([join(agent, 'extensions/update-skills/index.ts')], scratch, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
  const command = loaded.extensions[0].commands.get('skills');
  assert(command, 'registers /skills, replacing the narrow /update-skills command');
  const notices = [];
  const ctx = { cwd: scratch, ui: { notify: (message, type) => notices.push({ message, type }), setStatus() {} }, waitForIdle: async () => {}, reload: async () => {} };
  await command.handler('', ctx);
  const list = notices.at(-1).message;
  assert.match(list, /remote.*github.*acme\/remote/);
  assert.match(list, /local.*personal.*local/);
  assert.match(list, /gws-docs.*tool.*googleworkspace\/cli/);
  assert.match(list, /terminal-browser.*symlink/);
  assert.match(list, /build.*repository.*pi-setup checkout/);
  await command.handler('details build', ctx);
  assert.match(notices.at(-1).message, /Edit in pi-setup, run \.\/setup\.sh, then \/reload when ready/);
  await command.handler('details gws-docs', ctx);
  assert.match(notices.at(-1).message, /Update gws, then regenerate selected skills deliberately/);
  await command.handler('update nope', ctx);
  assert.match(notices.at(-1).message, /Usage:/);
  console.log('PASS: /skills inventory classifies repository, GitHub, personal, GWS-generated, and tool-symlink skills; details and command validation.');
} finally { if (original === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = original; await rm(scratch, { recursive: true, force: true }); }
