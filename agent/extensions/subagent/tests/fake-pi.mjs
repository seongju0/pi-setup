// Deterministic RPC fixture, never calls a provider or loads user resources.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const id = value('--session-id');
const directory = value('--session-dir');
const file = join(directory, `${id}.jsonl`);
mkdirSync(directory, { recursive: true });
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: 'session', id }) + '\n', { mode: 0o600 });
const log = (record) => appendFileSync(process.env.TEST_SUBAGENT_LOG, JSON.stringify({ child: id, pid: process.pid, ...record }) + '\n');
const output = (record) => process.stdout.write(JSON.stringify(record) + '\n');
const response = (command, data) => output({ type: 'response', id: command.id, command: command.type, success: true, data });
log({ type: 'launch', args, cwd: process.cwd(), subagent: process.env.PI_SUBAGENT });
let active;
let retry = false;
let time = Date.now();
let contextTokens = 0;
let compacted = false;
function answer(text, stopReason = 'stop') {
  const message = { role: 'assistant', content: [{ type: 'text', text }], stopReason, errorMessage: stopReason === 'error' ? 'Provider failed' : undefined, model: value('--model'), provider: value('--provider'), timestamp: ++time, usage: { totalTokens: 12, cost: { total: value('--model') === 'unpriced' ? 0 : 0.02 } } };
  contextTokens = 5000;
  appendFileSync(file, JSON.stringify({ type: 'message', message }) + '\n');
  output({ type: 'message_end', message });
}
function complete(text = 'Answer from child') {
  answer(text);
  output({ type: 'agent_end', willRetry: false, messages: [] });
  output({ type: 'agent_settled', aborted: false });
  output({ type: 'agent_settled', aborted: false }); // Duplicate settlement must not duplicate reporting.
  active = undefined;
}
process.on('SIGUSR1', () => {
  if (!active) return;
  log({ type: 'released' });
  complete(retry ? 'Recovered after retry' : 'Released answer');
});
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const command = JSON.parse(line);
  log({ type: 'command', command });
  if (command.type === 'extension_ui_response') { complete(`Approval denied: ${command.confirmed === false && command.cancelled === true}`); return; }
  if (command.type === 'get_state') {
    response(command, { sessionId: id, sessionFile: file, model: { provider: value('--provider'), id: value('--model') === 'mismatch' ? 'wrong' : value('--model'), contextWindow: 100000 }, thinkingLevel: args.includes('--thinking') ? value('--thinking') : 'off' });
  } else if (command.type === 'get_session_stats') {
    const cost = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).reduce((total, entry) => total + (entry.message?.usage?.cost?.total ?? 0), 0);
    if (active?.message.includes('stale-stat') && !compacted) {
      compacted = true;
      const staleTokens = contextTokens;
      output({ type: 'compaction_start', reason: 'threshold' });
      contextTokens = null;
      output({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
      response(command, { cost, contextUsage: { tokens: staleTokens, contextWindow: 100000, percent: staleTokens / 1000 } });
      log({ type: 'stale-stats-replied' });
      return;
    }
    if (active?.message.includes('stats-error')) output({ type: 'response', id: command.id, command: command.type, success: false, error: 'Stats unavailable' });
    else response(command, { cost, contextUsage: { tokens: contextTokens, contextWindow: 100000, percent: contextTokens === null ? null : contextTokens / 1000 } });
  } else if (command.type === 'prompt') {
    active = command;
    contextTokens = 2500;
    const message = { role: 'user', content: command.message };
    appendFileSync(file, JSON.stringify({ type: 'message', message }) + '\n');
    output({ type: 'message_end', message });
    if (command.message.includes('handled')) { response(command, { disposition: 'handled' }); return; }
    if (command.message.includes('before-acceptance')) { complete('Fast answer before prompt response'); response(command, { disposition: 'started' }); return; }
    response(command, { disposition: 'started' });
    if (command.message.includes('compact')) {
      contextTokens = null;
      output({ type: 'compaction_start', reason: 'threshold' });
      output({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
    }
    if (command.message.includes('artifact-hold')) {
      writeFileSync(join(directory, 'requested-report.md'), 'Deliverable written before settlement');
      log({ type: 'artifact-written' });
    }
    if (command.message.includes('hold')) return;
    if (command.message.includes('retry')) {
      answer('', 'error');
      output({ type: 'agent_end', willRetry: true, messages: [] });
      log({ type: 'waiting-for-retry' });
      retry = true;
      return;
    }
    if (command.message.includes('crash')) { process.exit(2); }
    if (command.message.includes('malformed')) { process.stdout.write('not-json\n'); return; }
    if (command.message.includes('approval')) { output({ type: 'extension_ui_request', id: 'approval', method: 'confirm', title: 'Permission?', message: 'Allow?' }); return; }
    if (command.message.includes('error')) {
      answer('', 'error');
      output({ type: 'agent_settled', aborted: false });
      return;
    }
    if (command.message.includes('unicode')) {
      const message = { role: 'assistant', content: [{ type: 'text', text: '雪☃️\u2028line\u2029paragraph' }], stopReason: 'stop', timestamp: ++time };
      const bytes = Buffer.from(JSON.stringify({ type: 'message_end', message }) + '\r\n');
      for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
      output({ type: 'agent_settled', aborted: false });
      return;
    }
    const assignments = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((entry) => entry.message?.role === 'user').length;
    complete(command.message.includes('large') ? 'X'.repeat(12000) : `Assignment ${assignments}: Answer from child`);
  } else if (command.type === 'abort') {
    if (active) { output({ type: 'agent_settled', aborted: true }); active = undefined; }
    response(command);
  } else if (command.type === 'clear_queue') response(command, { steering: [], followUp: [] });
  else response(command);
});
lines.on('close', () => { log({ type: 'shutdown' }); process.exit(0); });
