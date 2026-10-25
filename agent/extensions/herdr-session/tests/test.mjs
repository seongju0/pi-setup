// Run: node agent/extensions/herdr-session/tests/test.mjs
// Uses Pi's actual extension loader and a fake Herdr CLI; no Herdr agents or provider calls.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scratch = await mkdtemp(join(tmpdir(), 'herdr-research-test-'));
const environment = { ...process.env };
process.env.PI_CODING_AGENT_DIR = scratch;
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, 'dist/core/extensions/loader.js')));
const extensionsDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const extensionPath = join(extensionsDir, 'herdr-session/index.ts');
const skillsDir = join(dirname(extensionsDir), 'skills');
const handoffPath = join(skillsDir, 'handoff/SKILL.md');
const handoffBefore = await readFile(handoffPath, 'utf8');
const adapterPath = join(scratch, 'local-workflow.ts');
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const timers = new Set();
const instances = [];
const runDirs = [];
global.setInterval = (callback) => { const timer = { callback, unref() {} }; timers.add(timer); return timer; };
global.clearInterval = (timer) => timers.delete(timer);

async function instance(id, branch = [], worker) {
  process.env.HERDR_RESEARCH_DIR = worker?.run ?? '';
  process.env.HERDR_RESEARCH_WORKER = worker?.id ?? '';
  const runtime = createExtensionRuntime();
  const state = { branch: structuredClone(branch), messages: [], queued: [], warnings: [], busy: false };
  runtime.appendEntry = (customType, data) => state.branch.push({ type: 'custom', customType, data: structuredClone(data) });
  runtime.sendMessage = (message, options) => {
    state.messages.push({ message, options, busy: state.busy });
    if (state.busy) state.queued.push(message);
    else state.branch.push({ type: 'custom_message', ...structuredClone(message) });
  };
  const loaded = await loadExtensions([extensionPath, adapterPath], scratch, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const tools = new Map(loaded.extensions.flatMap(extension => [...extension.tools]));
  assert.equal(runtime.pendingVirtualModelRegistrations.length, 0);
  const models = [{ provider: 'test', id: 'chosen' }, { provider: 'anthropic', id: 'claude-sonnet-5-5' }, { provider: 'anthropic', id: 'claude-opus-5-5' }, { provider: 'openai', id: 'gpt-6.1-sol' }, { provider: 'openai', id: 'gpt-6-luna' }, { provider: 'anthropic', id: 'unsafe-router', api: 'pi-virtual' }];
  const ctx = {
    cwd: scratch, mode: 'tui', model: models.find(model => model.provider === 'openai'),
    sessionManager: { getSessionId: () => id, getBranch: () => state.branch },
    modelRegistry: { find: (provider, name) => models.find(model => provider === model.provider && name === model.id), getAvailable: () => models },
    ui: { notify: (message) => state.warnings.push(message) },
    hasPendingMessages: () => state.queued.length > 0,
  };
  const emit = async (event) => { for (const extension of loaded.extensions) for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, ctx); };
  const call = (name, params, signal) => tools.get(name).definition.execute('test', params, signal, undefined, ctx);
  ctx.executeTool = async (name, args, options) => {
    const toolCall = { id: 'local-call', name, arguments: args };
    const result = await call(name, args, options?.signal);
    return { toolCall, result, isError: result.isError === true };
  };
  runtime.createContext = () => ctx;
  const item = { ...state, state, ctx, call, emit, extension };
  instances.push(item);
  await emit({ type: 'session_start', reason: 'startup' });
  return item;
}
async function tick() { for (const timer of [...timers]) await timer.callback(); }
async function calls() { return (await readFile(join(scratch, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }

try {
  // A synthetic LOCAL extension owns workflow guidance and model choice, not the foundation.
  await writeFile(adapterPath, `import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export default function (pi) {
  pi.registerTool({
    name: "local_workflow_start", label: "Synthetic local workflow",
    description: "Test-only composition of public Herdr tools",
    parameters: { type: "object", properties: {} },
    async execute(_id, params, signal, _update, ctx) {
      const dir = await mkdtemp(join(ctx.cwd, "local-workflow-"));
      const guidance = join(dir, "guidance.md");
      await mkdir(join(dir, "private"));
      const reportDirectory = join(dir, "shareable");
      await mkdir(reportDirectory);
      await writeFile(guidance, "# Synthetic local guidance\\nRead-only synthetic investigation; write reviewed artifacts in " + reportDirectory + ".\\n" + (params.context ?? "") + "\\n" + (params.reportBack ? "Explicit report back" : "Independent handoff"), { mode: 0o600 });
      const model = params.model ?? "test/chosen";
      const name = params.reportBack ? "herdr_research_start" : "herdr_new_session";
      const args = params.reportBack
        ? { tasks: [{ label: "Synthetic local task", brief: params.question }], model, appendSystemPrompt: guidance, reportDirectory: reportDirectory.slice(ctx.cwd.length + 1), workspace: params.workspace, cwd: params.cwd }
        : { handoff: guidance, model, appendSystemPrompt: guidance, workspace: params.workspace, cwd: params.cwd };
      const response = await ctx.executeTool(name, args, { signal });
      return { ...response.result, isError: response.isError, details: { ...(params.reportBack ? response.result.details : { session: response.result.details.session ?? response.result.details }), model, guidance, reportDirectory, reportBack: params.reportBack === true } };
    }
  });
}`);
  await writeFile(join(scratch, 'herdr'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_HERDR_LOG, JSON.stringify(args) + '\\n');
let result = {};
if (args[0] === 'workspace') result = { workspaces: [{ workspace_id: 'test-w', label: 'test' }] };
if (args[0] === 'tab') { const n = fs.readFileSync(process.env.TEST_HERDR_LOG, 'utf8').split('\\n').length; result = { root_pane: { pane_id: 'test-w:p' + n }, tab: { tab_id: 'test-w:t' + n } }; }
if (args[0] === 'agent' && args[1] === 'start' && process.env.TEST_BUSY_START === '1' && !fs.existsSync(process.env.TEST_HERDR_LOG + '.busy')) { fs.writeFileSync(process.env.TEST_HERDR_LOG + '.busy', '1'); console.error(JSON.stringify({ error: { code: 'agent_pane_busy' } })); process.exit(1); }
if (args[0] === 'agent' && args[1] === 'start' && process.env.TEST_FAIL_ONCE === '1' && !fs.existsSync(process.env.TEST_HERDR_LOG + '.failed-once')) { fs.writeFileSync(process.env.TEST_HERDR_LOG + '.failed-once', '1'); console.error('simulated startup failure'); process.exit(1); }
if (args[0] === 'agent' && args[1] === 'start' && process.env.TEST_FAIL_START === '1') { console.error('simulated startup failure'); process.exit(1); }
if (args[0] === 'agent' && args[1] === 'start') {
  const file = process.env.TEST_HERDR_LOG + '.' + args[2] + '.session';
  const id = args[args.indexOf('--session-id') + 1];
  const prompt = args.at(-1).startsWith('Read and follow') ? args.at(-1) : undefined;
  const entries = [{ type: 'session', id: process.env.TEST_WRONG_SESSION === '1' ? 'wrong' : id }];
  if (prompt && process.env.TEST_NO_ACCEPT !== '1') entries.push({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  fs.writeFileSync(file + '.' + id, entries.map(JSON.stringify).join('\\n'));
  fs.writeFileSync(file, file + '.' + id);
  if (process.env.TEST_NOT_READY === '1') { console.error(JSON.stringify({ error: { code: 'agent_not_ready' } })); process.exit(1); }
  if (process.env.TEST_START_TIMEOUT === '1') { console.error(JSON.stringify({ error: { code: 'timeout', message: 'timed out waiting for agent startup' } })); process.exit(1); }
}
if (args[0] === 'agent' && args[1] === 'get') {
  const file = process.env.TEST_HERDR_LOG + '.' + args[2] + '.session';
  if (process.env.TEST_DELAYED_ACCEPT === '1' && !fs.existsSync(file + '.seen')) { fs.writeFileSync(file + '.seen', '1'); result = { agent: { agent_status: 'unknown' } }; }
  else result = { agent: { agent_status: 'working', agent_session: { kind: 'path', value: fs.readFileSync(file, 'utf8') } } };
}
console.log(JSON.stringify({ result }));
`, { mode: 0o700 });
  process.env.PATH = `${scratch}:${process.env.PATH}`;
  process.env.HERDR_ENV = '1';
  process.env.HERDR_WORKSPACE_ID = 'test-w';
  process.env.TEST_HERDR_LOG = join(scratch, 'calls.jsonl');
  await writeFile(process.env.TEST_HERDR_LOG, '');

  await mkdir(join(scratch, 'nested'));
  for (const file of ['brief with spaces.md', 'engineering.md', 'independent.md']) await writeFile(join(scratch, file), '# Synthetic handoff');
  const parent = await instance('parent');
  assert.equal(timers.size, 0, 'ordinary sessions must not watch research');
  process.env.TEST_BUSY_START = '1';
  await parent.call('herdr_new_session', { handoff: 'brief with spaces.md' });
  delete process.env.TEST_BUSY_START;
  assert.equal((await calls()).filter((args) => args[1] === 'start').length, 2, 'retry only pre-start shell readiness errors');
  let history = await calls();
  assert(history.find((args) => args[0] === 'tab').includes('--no-focus'));
  assert(!history.find((args) => args[1] === 'start').includes('--model'), 'default launch must use Pi defaults');
  assert(!history.find((args) => args[1] === 'start').includes('--append-system-prompt'), 'ordinary handoffs must not inject guidance');
  assert(history.filter((args) => args[1] === 'start').at(-1).at(-1).includes('brief with spaces.md'));
  assert(!history.some((args) => args[1] === 'prompt'), 'handoff must use native initial prompt, not terminal input');
  const beforeBadPaths = (await calls()).length;
  await assert.rejects(parent.call('herdr_new_session', { handoff: 'missing-brief.md' }), /ENOENT/);
  await writeFile(join(scratch, 'empty-brief.md'), ' ');
  await assert.rejects(parent.call('herdr_new_session', { handoff: 'empty-brief.md' }), /is empty/);
  await assert.rejects(parent.call('herdr_new_session', { cwd: 'missing-directory' }), /ENOENT/);
  await assert.rejects(parent.call('herdr_new_session', { cwd: 'brief with spaces.md' }), /not a directory/);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(parent.call('herdr_new_session', {}, cancelled.signal), /abort/i);
  assert.equal((await calls()).length, beforeBadPaths, 'preflight/cancellation must create no tabs');
  process.env.TEST_DELAYED_ACCEPT = '1';
  const delayed = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_DELAYED_ACCEPT;
  assert.equal(delayed.details.deliveryState, 'accepted');
  process.env.TEST_NOT_READY = '1';
  const workingAtStartup = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_NOT_READY;
  assert.equal(workingAtStartup.details.deliveryState, 'accepted', 'native prompt acceptance survives readiness failure without restarting');
  process.env.TEST_START_TIMEOUT = '1';
  const beforeTimeout = (await calls()).filter(args => args[1] === 'start').length;
  const acceptedAfterTimeout = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  assert.equal(acceptedAfterTimeout.details.launchState, 'started');
  assert.equal(acceptedAfterTimeout.details.deliveryState, 'accepted');
  assert.equal((await calls()).filter(args => args[1] === 'start').length, beforeTimeout + 1, 'timeout recovery must not relaunch');
  process.env.TEST_NO_ACCEPT = '1';
  const timeoutAbort = new AbortController();
  const timeoutAbortTimer = setTimeout(() => timeoutAbort.abort(), 500);
  const unacceptedAfterTimeout = await parent.call('herdr_new_session', { handoff: 'engineering.md' }, timeoutAbort.signal);
  clearTimeout(timeoutAbortTimer);
  delete process.env.TEST_NO_ACCEPT;
  delete process.env.TEST_START_TIMEOUT;
  assert.equal(unacceptedAfterTimeout.isError, true, 'timeout without prompt acceptance must remain a failure');
  assert.equal(unacceptedAfterTimeout.details.session.deliveryState, 'unconfirmed');
  assert(unacceptedAfterTimeout.details.session.tabId && unacceptedAfterTimeout.details.session.paneId);
  assert.equal((await calls()).filter(args => args[1] === 'start').length, beforeTimeout + 2, 'unaccepted timeout must not relaunch either');
  process.env.TEST_WRONG_SESSION = '1';
  const wrongSession = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_WRONG_SESSION;
  assert.equal(wrongSession.isError, true);
  assert.equal(wrongSession.details.session.deliveryState, 'unconfirmed');
  assert.match(wrongSession.details.message, /switched sessions/);
  process.env.TEST_NO_ACCEPT = '1';
  const beforeStalled = (await calls()).filter(args => args[1] === 'start').length;
  const noReceipt = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  assert.equal(noReceipt.isError, true, 'CLI success without accepted prompt must not report launch success');
  assert.equal(noReceipt.details.session.launchState, 'started');
  assert.equal(noReceipt.details.session.deliveryState, 'unconfirmed');
  assert.equal((await calls()).filter(args => args[1] === 'start').length, beforeStalled + 1, 'never relaunch or resend a stalled handoff');
  const stopDelivery = new AbortController();
  const stopTimer = setTimeout(() => stopDelivery.abort(), 500);
  const stopped = await parent.call('herdr_new_session', { handoff: 'engineering.md' }, stopDelivery.signal);
  clearTimeout(stopTimer);
  delete process.env.TEST_NO_ACCEPT;
  assert.equal(stopped.isError, true);
  assert(stopped.details.session.tabId && stopped.details.session.paneId, 'cancelled launch retains recovery identifiers');
  assert.equal(parent.state.branch.length, 0, 'handoff must not register research');
  assert.equal(timers.size, 0);
  await parent.call('herdr_new_session', { model: 'test/chosen', cwd: 'nested', workspace: 'test', label: 'handoff' });
  history = await calls();
  assert.deepEqual(history.filter((args) => args[1] === 'start').at(-1).slice(-2), ['--model', 'test/chosen']);
  assert(history.filter((args) => args[0] === 'tab').at(-1).includes(join(scratch, 'nested')));

  const engineering = (await parent.call('herdr_new_session', { model: 'openai/gpt-6.1-sol', handoff: 'engineering.md' })).details;
  assert.equal(engineering.model, 'openai/gpt-6.1-sol');
  assert.equal(parent.state.branch.length, 0, 'physical-model handoff remains independent');
  assert.equal(engineering.deliveryState, 'accepted');
  assert((await calls()).filter(args => args[1] === 'start').at(-1).includes('openai/gpt-6.1-sol'));

  const guidance = join(scratch, 'guidance with spaces.md');
  await writeFile(guidance, '# Analyst guidance\nDo not spawn agents; share files only.');
  await writeFile(join(scratch, 'empty-guidance.md'), '  \n');
  const beforeInvalid = (await calls()).length;
  await assert.rejects(parent.call('herdr_new_session', { appendSystemPrompt: 'missing-guidance.md' }), /ENOENT/);
  await assert.rejects(parent.call('herdr_new_session', { appendSystemPrompt: 'empty-guidance.md' }), /is empty/);
  assert.equal((await calls()).length, beforeInvalid, 'invalid guidance must fail before contacting Herdr');
  const injected = (await parent.call('herdr_new_session', { appendSystemPrompt: 'guidance with spaces.md', cwd: 'nested' })).details;
  assert.equal(injected.appendSystemPrompt, guidance, 'relative guidance resolves against caller, not destination cwd');
  assert.deepEqual((await calls()).filter((args) => args[1] === 'start').at(-1).slice(-2), ['--append-system-prompt', guidance]);
  await parent.extension.commands.get('herdr').handler('--model test/chosen --append-system-prompt "guidance with spaces.md"', parent.ctx);
  assert.deepEqual((await calls()).filter((args) => args[1] === 'start').at(-1).slice(-4), ['--model', 'test/chosen', '--append-system-prompt', guidance]);

  assert(!parent.extension.tools.has('herdr_analysis_start'), 'foundation must not register local workflow policy');
  assert(!parent.extension.tools.has('local_workflow_start'));
  const beforeModelFailure = (await calls()).length;
  const available = parent.ctx.modelRegistry.getAvailable;
  parent.ctx.modelRegistry.getAvailable = () => available().filter(model => model.id !== 'gpt-6.1-sol');
  await assert.rejects(parent.call('herdr_research_start', { tasks: [{ label: 'Synthetic', brief: 'Inspect code.' }] }), /gpt-6.1-sol is unavailable/);
  await assert.rejects(parent.call('herdr_new_session', { model: 'openai/gpt-6.1-sol' }), /gpt-6.1-sol is unavailable/);
  parent.ctx.modelRegistry.getAvailable = available;
  for (const model of ['anthropic/unsafe-router', 'missing/model']) {
    await assert.rejects(parent.call('herdr_new_session', { model }), /physical model|unavailable/);
    await assert.rejects(parent.call('herdr_research_start', { tasks: [{ label: 'Synthetic', brief: 'Inspect code.' }], model }), /physical model|unavailable/);
  }
  assert.equal((await calls()).length, beforeModelFailure, 'model validation must not contact Herdr or fall back');

  const localHandoff = (await parent.call('local_workflow_start', { question: 'Compare synthetic fixture counts.', context: 'Use synthetic fixtures only.' })).details;
  assert.equal(localHandoff.model, 'test/chosen');
  assert.equal(localHandoff.reportBack, false);
  assert.equal(parent.state.branch.length, 0, 'local workflow defaults to independent handoff');
  assert.equal(timers.size, 0);
  assert.equal((await stat(localHandoff.guidance)).mode & 0o777, 0o600);
  const localGuidance = await readFile(localHandoff.guidance, 'utf8');
  assert(localGuidance.includes('Use synthetic fixtures only.') && localGuidance.includes('Independent handoff'));
  assert((await calls()).filter(args => args[1] === 'start').at(-1).includes(localHandoff.guidance));
  assert.equal(localHandoff.session.deliveryState, 'accepted');

  const explicitLocal = (await parent.call('local_workflow_start', { question: 'Synthetic task.', model: 'openai/gpt-6.1-sol', workspace: 'test', cwd: 'nested' })).details;
  assert.equal(explicitLocal.model, 'openai/gpt-6.1-sol');
  assert.equal(explicitLocal.session.cwd, join(scratch, 'nested'));

  const localReport = (await parent.call('local_workflow_start', { question: 'Synthetic task; report back.', reportBack: true, workspace: 'test', cwd: 'nested' })).details;
  runDirs.push(localReport.run);
  assert.equal(localReport.workers.length, 1);
  assert.equal(localReport.reportBack, true);
  assert.equal(localReport.workers[0].session.cwd, join(scratch, 'nested'));
  const filePrompt = await readFile(localReport.workers[0].session.appendSystemPrompt, 'utf8');
  assert(filePrompt.includes('Synthetic local guidance') && filePrompt.includes('Mandatory research boundaries') && filePrompt.includes('never inline findings'));
  const localWorker = await instance('local-worker', [], { run: localReport.run, id: 'worker-1' });
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY_MARKER', report: 'INLINE_FINDINGS_MARKER' }), /existing shareable file path/);
  const privateReport = join(dirname(localReport.guidance), 'private', 'raw.md');
  await writeFile(privateReport, 'PRIVATE_ARTIFACT_MARKER');
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY_MARKER', report: privateReport }), /assigned shareable directory/);
  const escaped = join(localReport.reportDirectory, 'symlink.md');
  await symlink(privateReport, escaped);
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY_MARKER', report: escaped }), /assigned shareable directory/);
  const safeReport = join(localReport.reportDirectory, 'report.md');
  await writeFile(safeReport, 'SYNTHETIC_AGGREGATE_MARKER', { mode: 0o600 });
  const published = await localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY_MARKER', report: safeReport });
  assert.equal(published.details.report, safeReport);
  await tick();
  const delivered = parent.state.messages.at(-1).message.content;
  assert(delivered.includes(`Shareable report: ${safeReport}`));
  assert(!delivered.includes('PRIVATE_SUMMARY_MARKER') && !delivered.includes('SYNTHETIC_AGGREGATE_MARKER'), 'file-only transport sends paths, not summaries or file contents');
  await localWorker.emit({ type: 'session_shutdown', reason: 'quit' });
  const recoveredLocalWorker = await instance('local-worker', [], { run: localReport.run, id: 'worker-1' });
  await assert.rejects(recoveredLocalWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY_MARKER', report: 'INLINE_AFTER_RELOAD' }), /existing shareable file path/);
  await recoveredLocalWorker.emit({ type: 'session_shutdown', reason: 'quit' });
  parent.state.branch = [];
  parent.state.messages = [];
  await parent.emit({ type: 'session_start', reason: 'reload' });

  const tasks = [{ label: 'Code flow', brief: 'Trace the flow.' }, { label: 'Constraints', brief: 'Inspect constraints.' }];
  const beforeInvalidResearch = (await calls()).length;
  await assert.rejects(parent.call('herdr_research_start', { tasks, appendSystemPrompt: 'missing-guidance.md' }), /ENOENT/);
  await assert.rejects(parent.call('herdr_research_start', { tasks, appendSystemPrompt: 'empty-guidance.md' }), /is empty/);
  assert.equal((await calls()).length, beforeInvalidResearch);
  await assert.rejects(parent.call('herdr_research_start', { tasks: Array(5).fill(tasks[0]) }), /1–4/);
  await assert.rejects(parent.call('herdr_research_start', { tasks, model: 'missing/model' }), /unavailable/);
  const result = (await parent.call('herdr_research_start', { tasks, model: 'test/chosen', appendSystemPrompt: 'guidance with spaces.md' })).details;
  runDirs.push(result.run);
  assert.equal(result.workers.length, 2);
  assert(result.workers.every((w) => w.session && !w.error && w.session.appendSystemPrompt.endsWith(`${w.id}.system.md`)));
  const researchPrompt = await readFile(result.workers[0].session.appendSystemPrompt, 'utf8');
  assert(researchPrompt.includes('Do not spawn agents; share files only.') && researchPrompt.includes('Mandatory research boundaries') && researchPrompt.includes('Research source boundary') && researchPrompt.includes('Do not query operational or patient-bearing datasets'));
  assert(!/Healthie|Datadog|Iterable|Mixpanel|BigQuery|skill:analysis/.test(researchPrompt), 'generic boundaries must not embed local vendors or skills'); 
  const researchStarts = (await calls()).filter((args) => args[1] === 'start').slice(-2);
  assert(researchStarts.every((args) => args[args.indexOf('--append-system-prompt') + 1].endsWith('.system.md') && args.at(-1).startsWith('Read and follow')));
  assert.equal(timers.size, 1);
  const worker = await instance(result.workers[0].session.sessionId, [], { run: result.run, id: 'worker-1' });
  await assert.rejects(worker.call('herdr_research_start', { tasks }), /cannot spawn/);
  await assert.rejects(parent.call('herdr_research_report', { summary: 'No', report: 'No' }), /Only research workers/);
  parent.state.busy = true;
  await writeFile(join(result.run, '000-invalid.mail.json'), '{broken');
  await writeFile(join(result.run, '001-invalid-shape.mail.json'), JSON.stringify({ id: 'bad' }));
  const report = await worker.call('herdr_research_report', { summary: 'Verified flow.', report: '# Findings\nEvidence: src/example.ts:10' });
  assert.match(await readFile(report.details.report, 'utf8'), /Evidence/);
  await tick();
  assert.equal(parent.state.messages.length, 1);
  assert.deepEqual(parent.state.messages[0].options, { triggerTurn: true, deliverAs: 'followUp' });
  await tick();
  assert.equal(parent.state.messages.length, 1, 'queued report must not duplicate');
  assert.equal(parent.state.warnings.filter(warning => warning.includes('invalid')).length, 2, 'poison mail is warned once and never blocks valid reports');

  // Reload before queue delivery: no durable receipt exists, so replay the pending report.
  await parent.emit({ type: 'session_shutdown', reason: 'reload' });
  const reloaded = await instance('parent', parent.state.branch);
  await tick();
  assert.equal(reloaded.state.messages.length, 1);
  await reloaded.emit({ type: 'session_shutdown', reason: 'reload' });
  const restored = await instance('parent', reloaded.state.branch);
  await tick();
  assert.equal(restored.state.messages.length, 0, 'persisted report must not duplicate after reload');

  worker.state.busy = true;
  await restored.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'Also check compatibility.' });
  await tick();
  assert.equal(worker.state.messages.length, 1);
  assert.equal(worker.state.messages[0].options.deliverAs, 'followUp');
  assert.match(worker.state.messages[0].message.content, /compatibility/);
  await assert.rejects(restored.call('herdr_research_guide', { run: '/unowned', worker: 'worker-1', guidance: 'No' }), /does not own/);

  // Aborted queue: replay, rather than silently dropping the guidance forever.
  worker.state.queued = [];
  await worker.emit({ type: 'agent_settled' });
  await tick();
  assert.equal(worker.state.messages.length, 2);

  const other = await instance('forked-parent', restored.state.branch);
  const changedWorker = await instance('forked-worker', [], { run: result.run, id: 'worker-1' });
  await assert.rejects(other.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /does not own/);
  await assert.rejects(changedWorker.call('herdr_research_report', { summary: 'No', report: 'No' }), /different Pi session/);
  await tick();
  assert.equal(other.state.messages.length, 0, 'fork must not inherit parent reports');
  assert.equal(changedWorker.state.messages.length, 0, 'new worker session must not inherit guidance');
  const tree = await instance('parent', restored.state.branch);
  tree.state.branch = [];
  await tree.emit({ type: 'session_tree' });
  await tick();
  assert.equal(tree.state.messages.length, 0, 'tree navigation must drop research absent from the active branch');
  await assert.rejects(tree.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /does not own/);

  const beforeHandoff = restored.state.branch.length;
  await restored.call('herdr_new_session', { handoff: 'independent.md' });
  assert.equal(restored.state.branch.length, beforeHandoff);
  const mixedLocal = (await restored.call('local_workflow_start', { question: 'Independent synthetic task while research is registered.' })).details;
  assert.equal(mixedLocal.reportBack, false);
  assert.equal(restored.state.branch.length, beforeHandoff, 'local independent handoff must not disturb existing research');
  const mixedTab = (await calls()).filter(args => args[0] === 'tab').at(-1);
  assert(mixedTab.includes('HERDR_RESEARCH_DIR=') && mixedTab.includes('HERDR_RESEARCH_WORKER='));
  const ordinary = await instance('ordinary-handoff');
  await tick();
  assert.equal(ordinary.state.messages.length, 0);
  // Even a handoff launched by a worker explicitly clears the worker environment.
  await worker.call('herdr_new_session', {});
  const tab = (await calls()).filter((args) => args[0] === 'tab').at(-1);
  assert(tab.includes('HERDR_RESEARCH_DIR=') && tab.includes('HERDR_RESEARCH_WORKER='));

  const defaultResearch = (await restored.call('herdr_research_start', { tasks: [tasks[0]] })).details;
  runDirs.push(defaultResearch.run);
  assert(defaultResearch.workers[0].session && !defaultResearch.workers[0].error);
  assert.equal(defaultResearch.model, 'openai/gpt-6.1-sol');
  const defaultStart = (await calls()).filter(args => args[1] === 'start').at(-1);
  assert.equal(defaultStart[defaultStart.indexOf('--model') + 1], 'openai/gpt-6.1-sol', 'legacy Herdr research defaults to its parent physical model');
  assert.equal(JSON.parse(await readFile(join(defaultResearch.run, 'run.json'), 'utf8')).reportDirectory, undefined, 'ordinary research must not inherit the local file-only contract');

  const standaloneDirectory = join(scratch, 'standalone-reports');
  await mkdir(standaloneDirectory);
  const standalone = (await restored.call('herdr_research_start', { tasks: [tasks[0]], reportDirectory: standaloneDirectory })).details;
  runDirs.push(standalone.run);
  const standalonePrompt = await readFile(standalone.workers[0].session.appendSystemPrompt, 'utf8');
  const writeBoundary = standalonePrompt.split('# Mandatory research boundaries')[1].split('# Reporting and follow-up')[0];
  assert(writeBoundary.includes(standaloneDirectory), 'file-only reporting without appended guidance must explicitly permit writes to the report directory');

  process.env.HERDR_ENV = '0';
  await assert.rejects(restored.call('herdr_research_start', { tasks }), /inside Herdr/);
  await assert.rejects(restored.call('herdr_new_session', {}), /not running inside Herdr/);
  process.env.HERDR_ENV = '1';
  process.env.TEST_FAIL_ONCE = '1';
  const partial = await restored.call('herdr_research_start', { tasks });
  delete process.env.TEST_FAIL_ONCE;
  runDirs.push(partial.details.run);
  assert.equal(partial.details.status, 'partial');
  assert.match(partial.details.message, /1\/2 worker handoffs accepted/);
  assert(partial.details.workers[0].error && partial.details.workers[1].session.deliveryState === 'accepted');
  process.env.TEST_FAIL_START = '1';
  const failed = (await restored.call('herdr_research_start', { tasks: [tasks[0]] })).details;
  runDirs.push(failed.run);
  assert((await calls()).filter((args) => args[1] === 'start').at(-1).includes('--append-system-prompt'), 'research always appends persistent task/source boundaries');
  assert.equal(failed.status, 'failed');
  assert.match(failed.workers[0].error, /launch\/delivery failed/);
  assert(failed.workers[0].session.tabId && failed.workers[0].session.name, 'partial failure must retain launch IDs');
  await assert.rejects(restored.call('herdr_research_guide', { run: failed.run, worker: 'worker-1', guidance: 'No' }), /did not launch/);
  const failedLocal = await restored.call('local_workflow_start', { question: 'Synthetic task.', reportBack: true });
  runDirs.push(failedLocal.details.run);
  assert.equal(failedLocal.isError, true, 'local composition preserves generic launch failure');
  assert.equal(failedLocal.details.status, 'failed');
  assert(failedLocal.details.workers[0].session.tabId && failedLocal.details.workers[0].session.name);
  const independentFailure = await restored.call('local_workflow_start', { question: 'Synthetic independent launch failure.' });
  assert.equal(independentFailure.isError, true);
  assert(independentFailure.details.session.tabId && independentFailure.details.session.deliveryState === 'unconfirmed');
  assert.equal(await readFile(handoffPath, 'utf8'), handoffBefore);

  // Exercise Pi's real file-to-system-prompt loading and post-compaction context reconstruction.
  // Synthetic in-process responses only: the compacted summary omits the guidance deliberately.
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', compaction: { enabled: false }, retry: { enabled: false } });
  const skillRoutes = [['handoff', 'herdr_new_session'], ['research', 'subagent']];
  const skillPaths = skillRoutes.map(([name]) => join(skillsDir, name, 'SKILL.md'));
  const resourceLoader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager, appendSystemPrompt: [guidance], additionalSkillPaths: skillPaths, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  // Synthetic OAuth metadata only; no login, token refresh, or provider requests.
  const access = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.synthetic`;
  await writeFile(join(scratch, 'auth.json'), JSON.stringify({ 'openai': { type: 'oauth', access, refresh: 'synthetic', expires: Date.now() + 3600000, accountId: 'synthetic-account' } }), { mode: 0o600 });
  const modelRuntime = await ModelRuntime.create({ authPath: join(scratch, 'auth.json'), modelsPath: null, modelsStorePath: join(scratch, 'models-store.json'), allowModelNetwork: false });
  await modelRuntime.setRuntimeApiKey('anthropic', 'synthetic-test-key');
  const sessionManager = SessionManager.inMemory(scratch);
  sessionManager.appendMessage({ role: 'user', content: 'Old conversation content.', timestamp: Date.now() });
  const { session } = await createAgentSession({ cwd: scratch, agentDir: scratch, model: modelRuntime.getModels('anthropic')[0], modelRuntime, settingsManager, sessionManager, resourceLoader, tools: [] });
  try {
    const { AssistantMessageEventStream } = await import(pathToFileURL(join(packageRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js')));
    const requests = [];
    session.agent.streamFunction = (model, context) => {
      requests.push(structuredClone(context));
      const stream = new AssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: 'Synthetic response.' }], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
      return stream;
    };
    const marker = 'Do not spawn agents; share files only.';
    assert(session.systemPrompt.includes(marker));
    await session.prompt('Synthetic question before compaction.');
    sessionManager.appendCompaction('Summary without analyst instructions.', null, 1000);
    session.refreshContext();
    assert(session.systemPrompt.includes(marker), 'appended guidance survives conversation compaction');
    await session.prompt('Continue after compaction.');
    assert.equal(requests.length, 2);
    assert(requests.every(request => JSON.stringify(request).includes(marker)), 'guidance reaches the model before and after compaction, not merely a file');
    assert(!sessionManager.getBranch().find(entry => entry.type === 'compaction').summary.includes(marker));

    // Real Pi /skill: expansion, not a hand-written approximation of its parser.
    const loadedSkills = resourceLoader.getSkills();
    assert.deepEqual(loadedSkills.diagnostics.filter(diagnostic => skillPaths.includes(diagnostic.path)), []);
    for (const [name, tool] of skillRoutes) {
      const skill = loadedSkills.skills.find(skill => skill.name === name);
      assert(skill && skill.disableModelInvocation, `${name} must load as an explicitly invoked skill`);
      if (name !== 'research') assert(parent.extension.tools.has(tool), `${name}'s launch tool must be registered`);
      await session.prompt(`/skill:${name} SYNTHETIC_REQUEST_${name}`);
      const user = requests.at(-1).messages.filter(message => message.role === 'user').at(-1);
      const expanded = typeof user.content === 'string' ? user.content : user.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      assert(expanded.includes(`<skill name="${name}" location="${skill.filePath}">`), `${name} command must expand through Pi's real skill loader`);
      assert(expanded.includes(tool) && expanded.includes(`SYNTHETIC_REQUEST_${name}`), `${name} must deliver its launch instructions and supplied request to the model`);
    }
    assert.equal(requests.length, 4);

    // An explicitly selected physical model remains selected across compaction.
    await session.setModel(modelRuntime.getModel('openai', 'gpt-6.1-sol'));
    await session.prompt('Synthetic physical-model turn.');
    const beforeCompaction = session.messages.filter(message => message.role === 'assistant').at(-1);
    assert(beforeCompaction?.provider === 'openai' && beforeCompaction.model === 'gpt-6.1-sol');
    sessionManager.appendCompaction('Summary without model guidance.', null, 1000);
    session.refreshContext();
    await session.prompt('Synthetic physical-model turn after compaction.');
    assert.equal(session.model.provider, 'openai');
    assert.equal(session.model.id, 'gpt-6.1-sol');
    const responses = session.messages.filter(message => message.role === 'assistant').slice(-2);
    assert(responses.length > 0);
    assert(responses.every(message => message.provider === 'openai' && message.model === 'gpt-6.1-sol'), 'actual agent dispatch retains the explicitly selected physical model across compaction');
  } finally {
    session.dispose();
  }
  console.log('PASS: native handoff acknowledgement, delayed/working startup, preflight, silent delivery failure, cancellation, recovery identifiers, poison-mail isolation; no virtual model registration; explicit physical-model dispatch across compaction; physical model preflight and virtual-router rejection; skill expansion, handoff/report-back isolation, persistent research boundaries, file-only generic transport and local adapter composition, compaction, reload, and failures. Herdr/provider calls are mocked.');
} finally {
  for (const instance of instances) await instance.emit({ type: 'session_shutdown', reason: 'quit' });
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
  for (const dir of [scratch, ...runDirs]) await rm(dir, { recursive: true, force: true });
}
