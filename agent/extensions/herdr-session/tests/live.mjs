import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.ok(process.env.HC_TERMINAL_ID, 'Run this opt-in smoke test inside an hc-managed interactive Pi terminal');
const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const { SessionManager } = await import(pathToFileURL(join(root, 'dist/core/session-manager.js')));
const cwd = await mkdtemp(join(tmpdir(), 'hc-launch-smoke-'));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let loaded;
process.env.PI_CODING_AGENT_DIR = cwd;
try {
  const runtime = createExtensionRuntime();
  const path = join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.ts');
  loaded = await loadExtensions([path], cwd, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
}
const handoff = join(cwd, 'brief.md');
const marker = 'HERDR_NATIVE_HANDOFF_SMOKE_OK';
await writeFile(handoff, `Reply with exactly ${marker}. No other work: do not modify files, execute commands, inspect repositories, call external tools, or spawn agents.`, { mode: 0o600 });
const ctx = { cwd, mode: 'tui', sessionManager: SessionManager.create(cwd, join(cwd, 'parent-sessions')) };
const result = await loaded.extensions[0].tools.get('herdr_new_session').definition.execute('live-smoke', {
  label: 'Pi hc handoff smoke', cwd, handoff,
}, undefined, undefined, ctx);
console.log(JSON.stringify(result.details));
assert.notEqual(result.isError, true, 'Live launch failed; inspect the reported existing session, do not relaunch blindly');
assert.equal(result.details.backend, 'hc');
assert.equal(result.details.deliveryState, 'accepted');
assert.ok(result.details.terminalId);
assert.ok(result.details.sessionId);
assert.ok(result.details.sessionPath);
const waited = execFileSync('hc', ['wait', result.details.terminalId, '--timeout', '60', '--json'], { encoding: 'utf8', timeout: 75000 });
console.log(waited.trim());
const entries = (await readFile(result.details.sessionPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.equal(entries.find(entry => entry.type === 'session')?.id, result.details.sessionId);
assert.ok(entries.some(entry => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.content?.some(item => item.type === 'text' && item.text.trim() === marker)), `Smoke response not observed after hc wait. Inspect ${result.details.terminalId} and ${result.details.sessionPath}; do not relaunch or resend.`);
console.log(`PASS: hc startup handoff accepted by ${result.details.sessionId}; child replied ${marker}. Test tab retained for inspection.`);
