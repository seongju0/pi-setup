import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.HERDR_ENV, '1', 'Run this opt-in smoke test inside Herdr');
const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const cwd = await mkdtemp(join(tmpdir(), 'herdr-launch-smoke-'));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = cwd;
try {
const handoff = join(cwd, 'brief.md');
const marker = 'HERDR_NATIVE_HANDOFF_SMOKE_OK';
await writeFile(handoff, `Reply with exactly ${marker}. No other work: do not modify files, execute commands, inspect repositories, call external tools, or spawn agents.`, { mode: 0o600 });
const runtime = createExtensionRuntime();
const path = join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.ts');
const loaded = await loadExtensions([path], cwd, undefined, runtime);
assert.deepEqual(loaded.errors, []);
const ctx = { cwd, mode: 'tui' };
const result = await loaded.extensions[0].tools.get('herdr_new_session').definition.execute('live-smoke', {
  label: 'Herdr native handoff smoke', cwd, handoff,
}, undefined, undefined, ctx);
console.log(JSON.stringify(result.details));
assert.notEqual(result.isError, true, 'Live launch failed; inspect the reported existing session, do not relaunch blindly');
assert.equal(result.details.deliveryState, 'accepted');
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const entries = (await readFile(result.details.sessionPath, 'utf8')).split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  if (entries.some(entry => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.content?.some(item => item.type === 'text' && item.text.trim() === marker))) {
    console.log(`PASS: native startup handoff accepted by ${result.details.sessionId}; child replied ${marker}. Test tab retained for inspection.`);
    break;
  }
  await delay(250);
}
if (Date.now() >= deadline) throw new Error(`Handoff accepted but smoke response not observed within 60s. Inspect ${result.details.tabId}; do not resend.`);
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
}
