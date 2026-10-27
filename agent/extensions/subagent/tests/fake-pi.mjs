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
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id, cwd: process.cwd(), timestamp: new Date().toISOString() }) + '\n', { mode: 0o600 });
const log = (record) => appendFileSync(process.env.TEST_SUBAGENT_LOG, JSON.stringify({ child: id, pid: process.pid, ...record }) + '\n');
const output = (record) => process.stdout.write(JSON.stringify(record) + '\n');
const response = (command, data) => output({ type: 'response', id: command.id, command: command.type, success: true, data });
log({ type: 'launch', args, cwd: process.cwd(), subagent: process.env.PI_SUBAGENT });
let active;
let retry = false;
const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(entry => entry.type !== 'session');
let leafId = entries.at(-1)?.id ?? null;
let time = Math.max(Date.now(), ...entries.map(entry => entry.message?.timestamp ?? 0));
function append(entry) {
  const saved = { id: `native-${entries.length + 1}`, parentId: leafId, timestamp: new Date(++time).toISOString(), ...entry };
  entries.push(saved);
  leafId = saved.id;
  appendFileSync(file, JSON.stringify(saved) + '\n');
  return saved;
}
let contextTokens = 0;
let compacted = false;
function answer(text, stopReason = 'stop') {
  const message = { role: 'assistant', content: [{ type: 'text', text }], stopReason, errorMessage: stopReason === 'error' ? 'Provider failed' : undefined, model: value('--model'), provider: value('--provider'), timestamp: ++time, usage: { totalTokens: 12, cost: { total: value('--model') === 'unpriced' ? 0 : 0.02 } } };
  contextTokens = 5000;
  append({ type: 'message', message });
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
// Staged, delta-only stream lets the real command open in the middle of a
// response. Native entries intentionally lag one message_end read.
let stream;
let deferred;
let historyError = false;
function delta(update) { output({ type: 'message_update', usage: { totalTokens: 1 }, assistantMessageEvent: update }); }
function startStream() {
  const root = leafId;
  answer('Abandoned branch must not appear');
  leafId = root;
  const prelude = ['PRELUDE 雪🙂', ...Array.from({ length: 24 }, (_, index) => `Earlier line ${index}`)].join('\n');
  stream = { stage: 0, message: { role: 'assistant', content: [], timestamp: ++time, usage: { totalTokens: 12, cost: { total: 0.02 } }, stopReason: 'toolUse', model: value('--model'), provider: value('--provider') }, prelude };
  output({ type: 'message_start', message: stream.message });
  delta({ type: 'text_start', contentIndex: 0 });
  delta({ type: 'text_delta', contentIndex: 0, delta: prelude });
  delta({ type: 'thinking_start', contentIndex: 1 });
  delta({ type: 'thinking_delta', contentIndex: 1, delta: 'PRIVATE_THINKING_BODY' });
  delta({ type: 'toolcall_start', contentIndex: 2, id: 'tool-a', toolName: 'lookup' });
  delta({ type: 'toolcall_delta', contentIndex: 2, delta: '{"incomplete":' });
  delta({ type: 'text_start', contentIndex: 3 });
  delta({ type: 'text_delta', contentIndex: 3, delta: 'INDEXED_TEXT' });
  delta({ type: 'toolcall_start', contentIndex: 4, id: 'tool-b', toolName: 'check' });
  delta({ type: 'toolcall_delta', contentIndex: 4, delta: '{"incomplete":' });
  log({ type: 'transcript-stage', stage: 0 });
}
process.on('SIGUSR2', () => {
  if (!stream) return;
  const stage = ++stream.stage;
  if (stage === 1) {
    delta({ type: 'text_delta', contentIndex: 0, delta: '\nLIVE_DELTA' });
    delta({ type: 'text_end', contentIndex: 3, content: 'INDEXED_TEXT AUTHORITATIVE_BLOCK' });
  }
  if (stage === 2) {
    delta({ type: 'text_end', contentIndex: 0, content: `${stream.prelude}\nLIVE_DELTA\nAUTHORITATIVE_END` });
    delta({ type: 'thinking_end', contentIndex: 1, content: 'PRIVATE_THINKING_BODY' });
    const calls = [{ type: 'toolCall', id: 'tool-a', name: 'lookup', arguments: { path: 'complete-arguments' } }, { type: 'toolCall', id: 'tool-b', name: 'check', arguments: { command: 'exit 1' } }];
    for (const [index, toolCall] of calls.entries()) delta({ type: 'toolcall_end', contentIndex: index === 0 ? 2 : 4, toolCall });
    stream.message.content = [{ type: 'text', text: `${stream.prelude}\nLIVE_DELTA\nAUTHORITATIVE_END` }, { type: 'thinking', thinking: 'PRIVATE_THINKING_BODY' }, calls[0], { type: 'text', text: 'INDEXED_TEXT AUTHORITATIVE_MESSAGE' }, calls[1]];
    deferred = stream.message;
    output({ type: 'message_end', message: stream.message });
    for (const call of calls) output({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments });
    for (const text of ['obsolete partial', 'replacement partial']) output({ type: 'tool_execution_update', toolCallId: 'tool-a', toolName: 'lookup', partialResult: { content: [{ type: 'text', text }] } });
  }
  if (stage === 3) {
    historyError = true;
    if (deferred) { append({ type: 'message', message: deferred }); deferred = undefined; }
    for (const [toolCallId, toolName, isError, text] of [['tool-a', 'lookup', false, 'FINAL_TOOL_OUTPUT'], ['tool-b', 'check', true, 'FAILED_TOOL_OUTPUT']]) {
      const content = [{ type: 'text', text }, { type: 'image', data: 'omitted-base64', mimeType: 'image/png' }];
      output({ type: 'tool_execution_end', toolCallId, toolName, result: { content }, isError, durationMs: 100 });
      const message = { role: 'toolResult', toolCallId, toolName, content, isError, timestamp: ++time };
      output({ type: 'message_end', message });
      append({ type: 'message', message });
    }
    output({ type: 'compaction_start', reason: 'threshold' });
    append({ type: 'compaction', summary: 'Earlier context compacted', firstKeptEntryId: leafId, tokensBefore: 50000 });
    output({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
  }
  if (stage === 4) { historyError = false; complete('Transcript final'); }
  log({ type: 'transcript-stage', stage });
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
  } else if (command.type === 'get_entries') {
    if (historyError) { output({ type: 'response', id: command.id, command: command.type, success: false, error: 'Synthetic history failure' }); return; }
    response(command, { entries, leafId });
    if (deferred) { append({ type: 'message', message: deferred }); deferred = undefined; }
  } else if (command.type === 'prompt') {
    active = command;
    contextTokens = 2500;
    const message = { role: 'user', content: command.message, timestamp: ++time };
    append({ type: 'message', message });
    output({ type: 'message_end', message });
    if (command.message.includes('handled')) { response(command, { disposition: 'handled' }); return; }
    if (command.message.includes('before-acceptance')) { complete('Fast answer before prompt response'); response(command, { disposition: 'started' }); return; }
    response(command, { disposition: 'started' });
    if (command.message.includes('transcript-hold')) { startStream(); return; }
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
