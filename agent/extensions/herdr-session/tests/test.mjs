import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scratch = await mkdtemp(join(tmpdir(), 'hc-research-test-'));
const environment = { ...process.env };
const originalArgv = [...process.argv];
process.env.PI_CODING_AGENT_DIR = scratch;
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, 'dist/core/extensions/loader.js')));
const extensionsDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const extensionPath = join(extensionsDir, 'herdr-session/index.ts');
const skillsDir = join(dirname(extensionsDir), 'skills');

const adapterPath = join(scratch, 'local-workflow.ts');
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const timers = new Set();
const instances = [];
const runDirs = [];
global.setInterval = (callback) => { const timer = { callback, unref() {} }; timers.add(timer); return timer; };
global.clearInterval = (timer) => timers.delete(timer);

async function instance(id, branch = [], worker, catchStartupError = false, options = {}) {
  const coreId = options.terminalId ?? worker?.terminalId ?? 't1';
  function activate() {
    process.env.HC_TERMINAL_ID = coreId;
    process.env.HERDR_RESEARCH_DIR = worker?.run ?? '';
    process.env.HERDR_RESEARCH_WORKER = worker?.id ?? '';
    if (worker) process.env.PI_HERDR_MANAGED = '1';
    else delete process.env.PI_HERDR_MANAGED;
  }
  activate();
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
  const models = [{ provider: 'test', id: 'chosen' }, { provider: 'anthropic', id: 'claude-sonnet-5-5' }, { provider: 'anthropic', id: 'claude-opus-5-5' }, { provider: 'openai', id: 'gpt-6.1-sol' }, { provider: 'anthropic', id: 'unsafe-router', api: 'pi-virtual' }];
  const ctx = {
    cwd: options.cwd ?? scratch, mode: options.mode ?? 'tui', model: models.find(model => model.provider === 'openai'),
    sessionManager: { getSessionId: () => id, getSessionFile: () => join(scratch, `${id}.jsonl`), getBranch: () => state.branch },
    modelRegistry: { find: (provider, name) => models.find(model => provider === model.provider && name === model.id), getAvailable: () => models },
    ui: { notify: (message) => state.warnings.push(message) },
    hasPendingMessages: () => state.queued.length > 0,
  };
  const emit = async (event) => { activate(); for (const extension of loaded.extensions) for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, ctx); };
  const call = (name, params, signal) => { activate(); return tools.get(name).definition.execute('test', params, signal, undefined, ctx); };
  ctx.executeTool = async (name, args, options) => {
    const toolCall = { id: 'local-call', name, arguments: args };
    const result = await call(name, args, options?.signal);
    return { toolCall, result, isError: result.isError === true };
  };
  runtime.createContext = () => ctx;
  const item = { ...state, state, ctx, call, emit, extension, activate };
  instances.push(item);
  try {
    await emit({ type: 'session_start', reason: options.startReason ?? 'startup' });
  } catch (error) {
    if (!catchStartupError) throw error;
    // Pi's ExtensionRunner catches lifecycle errors and leaves tools callable.
    state.warnings.push(error.message);
  }
  return item;
}
async function tick() { for (const timer of [...timers]) await timer.callback(); }
async function calls() { return (await readFile(join(scratch, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
async function launches() { return (await calls()).filter(call => call.method === 'terminal.run').map(call => call.params); }
async function coreState() { return JSON.parse(await readFile(join(scratch, 'state.json'), 'utf8')); }
async function saveState(state) { await writeFile(join(scratch, 'state.json'), JSON.stringify(state)); }

try {
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
  const fake = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TEST_HC_ROOT;
const stateFile = path.join(root, 'state.json');
const args = process.argv.slice(2);
const program = path.basename(process.argv[1]);
function load() { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
function save(state) { fs.writeFileSync(stateFile, JSON.stringify(state)); }
function log(call) { fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(call) + '\n'); }
function terminal(state, address) { return Object.values(state.terminals).find(t => t.address === address || t.name === address); }
if (program === 'hc') {
  if (args[0] !== 'connect') throw new Error('Only hc connect is allowed in this fixture');
  let input = '';
  process.stdin.on('data', data => input += data);
  process.stdin.on('end', () => {
    const request = JSON.parse(input.trim());
    const { method, params } = request;
    log({ program, method, params });
    const state = load();
    let result;
    let error;
    if (method === 'terminal.run') {
      if (!path.isAbsolute(params.argv[0]) || !path.isAbsolute(params.argv[1]) || !fs.existsSync(params.argv[0]) || !fs.existsSync(params.argv[1])) throw new Error('Launch must not depend on the service PATH');
      if (process.env.TEST_SPAWN_FAILURE === '1') {
        console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'cannot start executable', data: { kind: 'spawn_failed' } } }));
        return;
      }
      const file = params.argv[params.argv.indexOf('--session') + 1];
      const entries = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
      const originalId = entries[0].id;
      if (process.env.TEST_WRONG_SESSION === '1') entries[0].id = 'wrong';
      const prompt = params.argv.includes('--') ? params.argv.at(-1) : undefined;
      if (prompt && process.env.TEST_NO_ACCEPT !== '1') entries.push({ type: 'message', id: 'initial-user', parentId: entries.at(-1).id ?? null, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() } });
      fs.writeFileSync(file, entries.map(JSON.stringify).join('\n') + '\n');
      const address = 't' + state.next++;
      result = { address, name: params.name, argv: params.argv, cwd: params.cwd, labels: { ...params.labels, 'pi.session-id': originalId }, parent: params.no_parent ? null : params.parent, keep: params.keep, notify: !params.no_notify, state: 'live', reported: true, status: { app: 'pi', state: 'idle' }, created_ms: Date.now(), screen: 'exact', cols: 100, rows: 40 };
      state.terminals[address] = result;
      if (params.labels?.['herdr.space']) {
        const space = state.spaces.find(s => s.id === params.labels['herdr.space']);
        for (const s of state.spaces) { s.active = false; for (const t of s.tabs) t.active = false; }
        space.active = true;
        const tab = { id: params.labels['herdr.tab'], name: 'new tab', active: true, terminals: [{ terminal: address, pane: 'p' + address, app: 'pi', status: 'idle' }] };
        space.tabs.push(tab);
        state.focus = { space: space.id, tab: tab.id, focused_pane: 'p' + address };
      }
      save(state);
      if (process.env.TEST_LOST_ACK === '1') { console.error('connection lost after launch'); process.exit(1); }
      if (process.env.TEST_FAIL_ONCE === '1' && !state.failedOnce) {
        state.failedOnce = true; save(state); error = { code: -32000, message: 'simulated launch failure', data: { kind: 'spawn_failed' } };
      }
    } else if (method === 'terminal.get') {
      result = terminal(state, params.terminal);
      if (!result) error = { code: -32000, message: 'not found', data: { kind: 'not_found' } };
    } else if (method === 'terminal.wait') {
      result = { terminal: params.terminal, ended: true, reason: 'status', status: 'idle', turn: 0, children: [] };
    } else if (method === 'terminal.label') {
      result = terminal(state, params.terminal);
      if (!result) throw new Error('Unknown label target');
      if (process.env.TEST_LABEL_FAILURE === '1') error = { code: -32000, message: 'simulated label failure' };
      else { Object.assign(result.labels, params.labels); save(state); }
    } else throw new Error('Unsupported method: ' + method);
    console.log(JSON.stringify(error ? { jsonrpc: '2.0', id: request.id, error } : { jsonrpc: '2.0', id: request.id, result }));
  });
} else {
  log({ program, args });
  const state = load();
  if (args[0] === 'ls') console.log(JSON.stringify({ spaces: state.spaces, recent: [] }));
  else if (args[0] === 'status') console.log(JSON.stringify({ ...state.focus, errors: [] }));
  else if (args[0] === 'do') {
    const command = args[1];
    let values;
    if (args[2]?.startsWith('{')) values = JSON.parse(args[2]);
    else { values = {}; for (let i = 2; i < args.length; i += 2) values[args[i].replace(/^--/, '')] = args[i + 1]; }
    if (command === 'tab.rename') {
      if (process.env.TEST_APP_FAILURE === '1') { console.log(JSON.stringify({ error: 'rename failed' })); process.exit(0); }
      const tab = state.spaces.flatMap(s => s.tabs).find(t => t.id === values.id);
      if (!tab) throw new Error('Unknown tab');
      tab.name = values.name;
    } else if (command === 'tab.select') {
      for (const space of state.spaces) {
        space.active = space.tabs.some(tab => tab.id === values.id);
        for (const tab of space.tabs) {
          tab.active = tab.id === values.id;
          if (tab.active) state.focus = { space: space.id, tab: tab.id, focused_pane: tab.terminals[0].pane };
        }
      }
    } else throw new Error('Unexpected app mutation: ' + command);
    save(state); console.log(JSON.stringify({ ok: true }));
  } else throw new Error('Unsupported app command');
}
`;
  for (const name of ['hc', 'herdr-app']) await writeFile(join(scratch, name), fake, { mode: 0o700 });
  await writeFile(join(scratch, 'herdr'), '#!/bin/sh\necho "Legacy Herdr must not be called" >&2\nexit 99\n', { mode: 0o700 });
  process.env.PATH = `${scratch}:${process.env.PATH}`;
  process.env.TEST_HC_ROOT = scratch;
  delete process.env.HERDR_ENV;
  delete process.env.HERDR_WORKSPACE_ID;
  await writeFile(join(scratch, 'calls.jsonl'), '');
  await saveState({ next: 2, terminals: { t1: { address: 't1', name: 'parent', state: 'live', labels: { 'herdr.space': 'test-space' }, status: { app: 'pi', state: 'idle' } } }, spaces: [
    { id: 'test-space', name: 'test', machine: null, active: true, tabs: [{ id: 'parent-tab', name: 'parent', active: true, terminals: [{ terminal: 't1', pane: 'parent-pane' }] }] },
    { id: 'other-space', name: 'other', machine: null, active: false, tabs: [] },
    { id: 'remote/space', name: 'remote', machine: 'remote', active: false, tabs: [] },
  ], focus: { space: 'test-space', tab: 'parent-tab', focused_pane: 'parent-pane' } });
  await mkdir(join(scratch, 'nested'));
  for (const file of ['brief with spaces.md', 'engineering.md', 'independent.md']) await writeFile(join(scratch, file), '# Synthetic handoff');
  const guidance = join(scratch, 'guidance with spaces.md');
  await writeFile(guidance, '# Analyst guidance\nDo not spawn agents; share files only.');
  await writeFile(join(scratch, 'empty-guidance.md'), '  \n');
  // The extension runs in Pi's CLI, not in this test runner.
  process.argv[1] = join(packageRoot, 'dist/cli.js');
  const parent = await instance('parent');
  assert.equal(process.env.PI_HERDR_MANAGED, undefined);
  assert.deepEqual((await calls()).filter(call => call.method === 'terminal.label').map(call => call.params), [
    { terminal: 't1', labels: { 'pi.session-id': 'parent', 'pi.session-cwd': scratch } },
  ]);
  await parent.emit({ type: 'session_shutdown', reason: 'resume' });
  const moved = await instance('moved', [], undefined, false, { cwd: join(scratch, 'nested'), startReason: 'resume' });
  assert.deepEqual((await coreState()).terminals.t1.labels, {
    'herdr.space': 'test-space', 'pi.session-id': 'moved', 'pi.session-cwd': join(scratch, 'nested'),
  });
  assert.equal((await calls()).filter(call => call.method === 'terminal.label').length, 2);
  await moved.emit({ type: 'session_shutdown', reason: 'resume' });
  const beforeNoninteractive = (await calls()).length;
  await instance('rpc', [], undefined, false, { mode: 'rpc' });
  await instance('outside-herdr', [], undefined, false, { terminalId: '' });
  assert.equal((await calls()).length, beforeNoninteractive);
  await parent.emit({ type: 'session_start', reason: 'resume' });
  assert.equal(timers.size, 0);
  const beforePreflight = (await launches()).length;
  await assert.rejects(parent.call('herdr_new_session', { handoff: 'missing.md' }), /ENOENT/);
  await assert.rejects(parent.call('herdr_new_session', { appendSystemPrompt: 'empty-guidance.md' }), /empty/);
  await assert.rejects(parent.call('herdr_new_session', { cwd: 'missing-directory' }), /ENOENT/);
  await assert.rejects(parent.call('herdr_new_session', { cwd: 'engineering.md' }), /not a directory/);
  for (const model of ['anthropic/unsafe-router', 'missing/model']) {
    await assert.rejects(parent.call('herdr_new_session', { model }), /physical model|unavailable/);
    await assert.rejects(parent.call('herdr_research_start', { tasks: [{ label: 'Synthetic', brief: 'Inspect.' }], model }), /physical model|unavailable/);
  }
  await assert.rejects(parent.call('herdr_new_session', { workspace: 'remote' }), /remote|local/i);
  delete process.env.HC_TERMINAL_ID;
  await assert.rejects(parent.extension.tools.get('herdr_new_session').definition.execute('test', {}, undefined, undefined, parent.ctx), /core|HC_TERMINAL_ID/);
  const idCommand = parent.extension.commands.get('herdr-id');
  assert(idCommand, 'the managed extension registers /herdr-id');
  const noticesBeforeId = parent.state.warnings.length;
  await idCommand.handler('', { ...parent.ctx, hasUI: false });
  assert.equal(parent.state.warnings.length, noticesBeforeId);
  await idCommand.handler('', { ...parent.ctx, hasUI: true });
  assert.match(parent.state.warnings.at(-1), /No Herdr terminal ID/);
  parent.activate();
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(parent.call('herdr_new_session', {}, cancelled.signal), /abort/i);
  assert.equal((await launches()).length, beforePreflight);

  const handoff = await parent.call('herdr_new_session', { handoff: 'brief with spaces.md', label: 'Independent' });
  assert.notEqual(handoff.isError, true, JSON.stringify(handoff.details));
  const independent = handoff.details;
  assert.equal(independent.backend, 'hc');
  assert.equal(independent.deliveryState, 'accepted');
  assert(independent.terminalId && independent.tabId && independent.paneId);
  const header = JSON.parse((await readFile(independent.sessionPath, 'utf8')).split('\n')[0]);
  assert.equal(header.id, independent.sessionId);
  assert.equal(header.cwd, scratch);
  assert.equal((await stat(independent.sessionPath)).mode & 0o777, 0o600);
  let started = (await launches()).at(-1);
  assert.deepEqual(started.argv.slice(0, 2), [process.execPath, process.argv[1]]);
  assert.equal(started.no_parent, true);
  assert.equal(started.keep, true);
  assert.equal(started.no_notify, true);
  assert.equal(started.env.PI_CODING_AGENT_DIR, scratch);
  assert.equal(started.env.HERDR_RESEARCH_DIR, '');
  assert.equal(started.env.HERDR_RESEARCH_WORKER, '');
  assert.equal(started.labels['herdr.space'], 'test-space');
  assert(!started.argv.includes('--model'));
  assert(!started.argv.includes('--append-system-prompt'));
  assert.equal(started.argv[started.argv.indexOf('--session') + 1], independent.sessionPath);
  assert.equal((await coreState()).focus.tab, 'parent-tab');
  assert.equal((await coreState()).spaces[0].tabs.find(tab => tab.id === independent.tabId).name, 'Independent');
  assert.equal(parent.state.branch.length, 0);
  assert.equal(timers.size, 0);

  const explicit = await parent.call('herdr_new_session', { model: 'test/chosen', cwd: 'nested', workspace: 'test', appendSystemPrompt: 'guidance with spaces.md' });
  assert.notEqual(explicit.isError, true, JSON.stringify(explicit.details));
  started = (await launches()).at(-1);
  assert.equal(started.cwd, join(scratch, 'nested'));
  assert.equal(started.argv[started.argv.indexOf('--model') + 1], 'test/chosen');
  assert.equal(started.argv[started.argv.indexOf('--append-system-prompt') + 1], guidance);
  parent.activate();
  await parent.extension.commands.get('herdr').handler('--model test/chosen --append-system-prompt "guidance with spaces.md"', parent.ctx);
  assert.equal((await launches()).at(-1).argv[(await launches()).at(-1).argv.indexOf('--append-system-prompt') + 1], guidance);

  process.env.TEST_WRONG_SESSION = '1';
  const switched = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_WRONG_SESSION;
  assert.equal(switched.isError, true);
  assert(switched.details.session.terminalId);
  process.env.TEST_NO_ACCEPT = '1';
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), 1500);
  const beforeUnaccepted = (await launches()).length;
  const unaccepted = await parent.call('herdr_new_session', { handoff: 'engineering.md' }, abort.signal);
  clearTimeout(abortTimer);
  delete process.env.TEST_NO_ACCEPT;
  assert.equal(unaccepted.isError, true);
  assert.equal(unaccepted.details.session.deliveryState, 'unconfirmed');
  assert(unaccepted.details.session.terminalId && unaccepted.details.session.sessionPath);
  assert.equal((await launches()).length, beforeUnaccepted + 1);
  process.env.TEST_LOST_ACK = '1';
  const beforeLost = (await launches()).length;
  const lost = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_LOST_ACK;
  assert.equal(lost.isError, true);
  assert(lost.details.session.name && lost.details.session.sessionPath);
  assert.equal((await launches()).length, beforeLost + 1);
  process.env.TEST_APP_FAILURE = '1';
  const presentation = await parent.call('herdr_new_session', { handoff: 'engineering.md' });
  delete process.env.TEST_APP_FAILURE;
  assert.equal(presentation.isError, true);
  assert(presentation.details.session.terminalId);

  const tasks = [{ label: 'Code flow', brief: 'Trace the flow.' }, { label: 'Constraints', brief: 'Inspect constraints.' }];
  assert(!parent.extension.tools.has('herdr_analysis_start'));
  const localHandoff = (await parent.call('local_workflow_start', { question: 'Compare synthetic counts.' })).details;
  assert.equal(localHandoff.reportBack, false);
  assert.equal(localHandoff.session.deliveryState, 'accepted');
  assert.equal(parent.state.branch.length, 0);
  const beforeCrossSpace = (await launches()).length;
  const crossSpace = (await parent.call('herdr_research_start', { tasks, workspace: 'other' })).details;
  runDirs.push(crossSpace.run);
  assert.equal(crossSpace.status, 'failed');
  assert(crossSpace.workers.every(worker => /space|workspace/i.test(worker.error)));
  assert.equal((await launches()).length, beforeCrossSpace);

  const result = (await parent.call('herdr_research_start', { tasks, appendSystemPrompt: 'guidance with spaces.md' })).details;
  runDirs.push(result.run);
  assert.equal(result.status, 'launched', JSON.stringify(result));
  assert.equal(result.model, 'openai/gpt-6.1-sol');
  assert.equal(result.workers.length, 2);
  for (const launch of (await launches()).slice(-2)) {
    assert.equal(launch.parent, 't1');
    assert.equal(launch.keep, false);
    assert(!launch.labels?.['herdr.space'] && !launch.labels?.['herdr.tab']);
    assert.equal(launch.no_notify, true);
    assert.equal(launch.argv[launch.argv.indexOf('--model') + 1], 'openai/gpt-6.1-sol');
  }
  const researchPrompt = await readFile(result.workers[0].session.appendSystemPrompt, 'utf8');
  assert(researchPrompt.includes('Do not spawn agents; share files only.') && researchPrompt.includes('Do not query operational or patient-bearing datasets'));
  assert(!/Healthie|Datadog|Iterable|Mixpanel|BigQuery|skill:analysis/.test(researchPrompt));
  const workerInput = { run: result.run, id: 'worker-1', terminalId: result.workers[0].session.terminalId };
  const worker = await instance(result.workers[0].session.sessionId, [], workerInput);
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
  assert.equal(parent.state.messages.length, 1);
  assert.equal(parent.state.warnings.filter(warning => warning.includes('invalid')).length, 2);
  await parent.emit({ type: 'session_shutdown', reason: 'reload' });
  process.env.TEST_LABEL_FAILURE = '1';
  const reloaded = await instance('parent', parent.state.branch, undefined, true);
  delete process.env.TEST_LABEL_FAILURE;
  assert(reloaded.state.warnings.some(warning => /simulated label failure/.test(warning)));
  await tick();
  assert.equal(reloaded.state.messages.length, 1, 'research polling restores even when session publication fails');
  await reloaded.emit({ type: 'session_shutdown', reason: 'reload' });
  const restored = await instance('parent', reloaded.state.branch);
  await tick();
  assert.equal(restored.state.messages.length, 0);
  worker.state.busy = true;
  await restored.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'Also check compatibility.' });
  await tick();
  assert.equal(worker.state.messages.length, 1);
  assert.match(worker.state.messages[0].message.content, /compatibility/);
  worker.state.queued = [];
  await worker.emit({ type: 'agent_settled' });
  await tick();
  assert.equal(worker.state.messages.length, 2);
  const fork = await instance('forked-parent', restored.state.branch);
  await assert.rejects(fork.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /does not own/);
  const changedWorker = await instance('forked-worker', [], workerInput);
  await assert.rejects(changedWorker.call('herdr_research_report', { summary: 'No', report: 'No' }), /different Pi session/);
  await assert.rejects(restored.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /changed|different|session/i);
  await worker.emit({ type: 'session_start', reason: 'reload' });
  await tick();
  assert.equal(fork.state.messages.length, 0);
  assert.equal(changedWorker.state.messages.length, 0);
  const tree = await instance('parent', restored.state.branch);
  tree.state.branch = [];
  await tree.emit({ type: 'session_tree' });
  await assert.rejects(tree.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /does not own/);

  const legacyBranch = structuredClone(restored.state.branch);
  for (const entry of legacyBranch) {
    if (entry.customType === 'herdr-research-run') for (const item of entry.data.workers) if (item.session) { delete item.session.backend; delete item.session.terminalId; }
  }
  const runFile = join(result.run, 'run.json');
  const savedRun = await readFile(runFile, 'utf8');
  const legacyRun = JSON.parse(savedRun);
  for (const item of legacyRun.workers) { delete item.session.backend; delete item.session.terminalId; }
  await writeFile(runFile, JSON.stringify(legacyRun));
  const legacy = await instance('parent', legacyBranch);
  await assert.rejects(legacy.call('herdr_research_guide', { run: result.run, worker: 'worker-1', guidance: 'No' }), /legacy|core|hc/i);
  await writeFile(runFile, savedRun);
  const nextReport = await worker.call('herdr_research_report', { summary: 'New finding.', report: '# Updated findings' });
  await tick();
  assert(legacy.state.messages.some(item => item.message.content.includes(nextReport.details.report)));

  const localReport = (await restored.call('local_workflow_start', { question: 'Synthetic task; report back.', reportBack: true, workspace: 'test', cwd: 'nested' })).details;
  runDirs.push(localReport.run);
  assert.equal(localReport.status, 'launched', JSON.stringify(localReport));
  const localWorkerInput = { run: localReport.run, id: 'worker-1', terminalId: localReport.workers[0].session.terminalId };
  const localWorker = await instance(localReport.workers[0].session.sessionId, [], localWorkerInput);
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY', report: 'INLINE_FINDINGS' }), /existing shareable file path/);
  const privateReport = join(dirname(localReport.guidance), 'private', 'raw.md');
  await writeFile(privateReport, 'PRIVATE_ARTIFACT');
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY', report: privateReport }), /assigned shareable directory/);
  const escaped = join(localReport.reportDirectory, 'symlink.md');
  await symlink(privateReport, escaped);
  await assert.rejects(localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY', report: escaped }), /assigned shareable directory/);
  const safeReport = join(localReport.reportDirectory, 'report.md');
  await writeFile(safeReport, 'SYNTHETIC_AGGREGATE', { mode: 0o600 });
  await localWorker.call('herdr_research_report', { summary: 'PRIVATE_SUMMARY', report: safeReport });
  await tick();
  const delivered = restored.state.messages.at(-1).message.content;
  assert(delivered.includes(`Shareable report: ${safeReport}`));
  assert(!delivered.includes('PRIVATE_SUMMARY') && !delivered.includes('SYNTHETIC_AGGREGATE'));
  await localWorker.emit({ type: 'session_shutdown', reason: 'reload' });
  const { SessionManager: StoredSessions } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
  const savedWorkerBranch = StoredSessions.open(localReport.workers[0].session.sessionPath).getBranch();
  // Manual recovery keeps --session but loses the launcher's environment.
  const recovered = await instance(localReport.workers[0].session.sessionId, savedWorkerBranch, { terminalId: localWorkerInput.terminalId });
  await assert.rejects(recovered.call('herdr_research_report', { summary: 'No', report: 'INLINE_AFTER_RELOAD' }), /existing shareable file path/);
  await assert.rejects(recovered.call('herdr_research_report', { summary: 'No', report: escaped }), /assigned shareable directory/);
  await recovered.call('herdr_research_report', { summary: 'PRIVATE_RECOVERED_SUMMARY', report: safeReport });
  await tick();
  assert(restored.state.messages.at(-1).message.content.includes(`Shareable report: ${safeReport}`));
  assert(!restored.state.messages.at(-1).message.content.includes('PRIVATE_RECOVERED_SUMMARY'));
  const recoveredFork = await instance('forked-recovered-worker', savedWorkerBranch, undefined, true);
  assert(recoveredFork.state.warnings.some(warning => /different Pi session/.test(warning)));
  assert.deepEqual((await coreState()).terminals.t1.labels, {
    'herdr.space': 'test-space', 'pi.session-id': 'forked-recovered-worker', 'pi.session-cwd': scratch,
  }, 'new identity is published before copied worker ownership is rejected');
  const beforeForkReport = restored.state.messages.length;
  await assert.rejects(recoveredFork.call('herdr_research_report', { summary: 'Unauthorized fork', report: safeReport }), /Only research workers|different Pi session/);
  await tick();
  assert.equal(restored.state.messages.length, beforeForkReport);

  process.env.TEST_SPAWN_FAILURE = '1';
  const failedLaunch = (await restored.call('local_workflow_start', { question: 'Synthetic failed launch.', reportBack: true })).details;
  delete process.env.TEST_SPAWN_FAILURE;
  runDirs.push(failedLaunch.run);
  assert.equal(failedLaunch.status, 'failed');
  const failedSession = failedLaunch.workers[0].session;
  assert(!failedSession.terminalId);
  const failedBranch = StoredSessions.open(failedSession.sessionPath).getBranch();
  const recoveredLaunch = await instance(failedSession.sessionId, failedBranch);
  const recoveredReport = join(failedLaunch.reportDirectory, 'recovered.md');
  await writeFile(recoveredReport, 'SYNTHETIC_RECOVERY');
  await recoveredLaunch.call('herdr_research_report', { summary: 'PRIVATE_FAILURE_SUMMARY', report: recoveredReport });
  await tick();
  assert(restored.state.messages.at(-1).message.content.includes(`Shareable report: ${recoveredReport}`));
  assert(!restored.state.messages.at(-1).message.content.includes('PRIVATE_FAILURE_SUMMARY'));
  const unregistered = await instance('unregistered-worker', [], { run: failedLaunch.run, id: 'worker-4' });
  await assert.rejects(unregistered.call('herdr_research_report', { summary: 'No', report: recoveredReport }), /Unknown research worker/);
  const beforeWorkerHandoff = restored.state.branch.length;
  const workerHandoff = await worker.call('herdr_new_session', { handoff: 'independent.md' });
  assert.notEqual(workerHandoff.isError, true, JSON.stringify(workerHandoff.details));
  assert.equal((await launches()).at(-1).env.HERDR_RESEARCH_DIR, '');
  assert.equal((await launches()).at(-1).env.HERDR_RESEARCH_WORKER, '');
  assert.equal(restored.state.branch.length, beforeWorkerHandoff);
  process.env.TEST_FAIL_ONCE = '1';
  const partial = (await restored.call('herdr_research_start', { tasks })).details;
  delete process.env.TEST_FAIL_ONCE;
  runDirs.push(partial.run);
  assert.equal(partial.status, 'partial', JSON.stringify(partial));
  assert(partial.workers[0].error && partial.workers[1].session.deliveryState === 'accepted');
  assert(partial.workers[0].session.name && partial.workers[0].session.sessionPath);
  assert(!(await calls()).some(call => call.method === 'terminal.send'));
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', compaction: { enabled: false }, retry: { enabled: false } });
  const skillRoutes = [['handoff', 'herdr_new_session'], ['research', 'herdr_research_start']];
  const skillPaths = skillRoutes.map(([name]) => join(skillsDir, name, 'SKILL.md'));
  const resourceLoader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager, appendSystemPrompt: [guidance], additionalSkillPaths: skillPaths, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
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

    const loadedSkills = resourceLoader.getSkills();
    assert.deepEqual(loadedSkills.diagnostics.filter(diagnostic => skillPaths.includes(diagnostic.path)), []);
    for (const [name, tool] of skillRoutes) {
      const skill = loadedSkills.skills.find(skill => skill.name === name);
      assert(skill && skill.disableModelInvocation, `${name} must load as an explicitly invoked skill`);
      assert(parent.extension.tools.has(tool), `${name}'s launch tool must be registered`);
      await session.prompt(`/skill:${name} SYNTHETIC_REQUEST_${name}`);
      const user = requests.at(-1).messages.filter(message => message.role === 'user').at(-1);
      const expanded = typeof user.content === 'string' ? user.content : user.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      assert(expanded.includes(`<skill name="${name}" location="${skill.filePath}">`), `${name} command must expand through Pi's real skill loader`);
      assert(expanded.includes(tool) && expanded.includes(`SYNTHETIC_REQUEST_${name}`), `${name} must deliver its launch instructions and supplied request to the model`);
    }
    assert.equal(requests.length, 4);

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

  console.log('PASS: hc handoff/native workers, receipt recovery, session-bound mailbox privacy/reload, and real Pi skill/compaction flows.');
} finally {
  for (const item of instances) await item.emit({ type: 'session_shutdown', reason: 'quit' });
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
  process.argv.splice(0, process.argv.length, ...originalArgv);
  for (const dir of runDirs) await rm(dir, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
