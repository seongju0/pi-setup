// Run: node agent/extensions/subagent/tests/test.mjs
// Real Pi extension loader and real child processes; fake RPC CLI, no providers or user settings.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = dirname(fileURLToPath(import.meta.url));
const root = process.env.PI_TEST_PACKAGE_ROOT || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime, clearExtensionCache } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const { visibleWidth, stripTerminalSequences, getKeybindings } = await import(pathToFileURL(join(root, 'node_modules/@earendil-works/pi-tui/dist/index.js')));
const themes = await import(pathToFileURL(join(root, 'dist/modes/interactive/theme/theme.js')));
themes.initTheme('light', false);
const scratch = await mkdtemp(join(tmpdir(), 'pi-subagent-test-'));
const originalEnv = { ...process.env };
const originalScript = process.argv[1];
const instances = [];
let entryId = 0;

async function until(check, message = 'condition') {
  for (let i = 0; i < 400; i++) { if (await check()) return; await delay(10); }
  throw new Error(`Timed out waiting for ${message}`);
}
async function logs() { return (await readFile(process.env.TEST_SUBAGENT_LOG, 'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
async function instance({ id = `parent-${instances.length}`, branch = [], flag, mode = 'tui' } = {}) {
  const runtime = createExtensionRuntime();
  const state = { id, branch: structuredClone(branch), reports: [], queue: [], busy: false, warnings: [], widgets: new Map([['task', 'untouched task'], ['todo', 'untouched todo'], ['physical-model-usage', 'untouched model usage']]), widgetUpdates: 0, renderRequests: 0, customCalls: 0 };
  runtime.appendEntry = (customType, data) => state.branch.push({ type: 'custom', id: `entry-${++entryId}`, customType, data: structuredClone(data) });
  const loaded = await loadExtensions([join(directory, '../index.ts')], scratch, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  if (flag) runtime.flagValues.set('subagent-model', flag);
  assert.equal(runtime.pendingVirtualModelRegistrations.length, 0);
  const models = [
    { provider: 'test', id: 'chosen', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }, { provider: 'test', id: 'explicit' }, { provider: 'test', id: 'mismatch' },
    { provider: 'test', id: 'unpriced', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { provider: 'openai', id: 'gpt-6.1-sol' }, { provider: 'anthropic', id: 'claude-sonnet-5-5' },
    { provider: 'test', id: 'unsafe-router', api: 'pi-virtual' },
  ];
  const ctx = {
    cwd: scratch, mode, model: models[0], thinkingLevel: 'high',
    sessionManager: { getSessionId: () => state.id, getBranch: () => state.branch },
    modelRegistry: { find: (provider, id) => models.find((model) => model.provider === provider && model.id === id), getAvailable: () => models },
    isProjectTrusted: () => true, hasPendingMessages: () => state.queue.length > 0,
    ui: {
      notify: (text) => state.warnings.push(text),
      custom: (factory, options) => new Promise(resolve => {
        state.customCalls++;
        assert.equal(options.overlay, true);
        assert.deepEqual(options.overlayOptions, { width: '90%', maxHeight: '85%', anchor: 'center', margin: 1 });
        const tui = { terminal: { rows: 48, columns: 180 }, requestRender: () => { state.renderRequests++; } };
        const done = () => { state.overlay.component.dispose?.(); state.overlay = undefined; resolve(); };
        state.overlay = { tui, component: factory(tui, themes.theme, getKeybindings(), done) };
      }),
      setWidget: (key, factory, options) => {
        assert.equal(key, 'subagent', 'must not overwrite another extension widget');
        state.widgetUpdates++;
        state.widgets.get(key)?.dispose?.();
        if (factory) {
          assert.equal(options.placement, 'aboveEditor');
          const theme = { fg: (...args) => themes.theme.fg(...args) };
          state.widgets.set(key, factory({ requestRender: () => { state.renderRequests++; } }, theme));
        } else state.widgets.delete(key);
      },
    },
  };
  const emit = async (event) => { for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, ctx); };
  async function record(message) {
    state.branch.push({ type: 'custom_message', id: `entry-${++entryId}`, ...structuredClone(message) });
    await emit({ type: 'message_end', message: { role: 'custom', ...message } });
  }
  runtime.sendMessage = (message, options) => {
    state.reports.push({ message: structuredClone(message), options });
    if (state.busy) state.queue.push(message);
    else void record(message);
  };
  const call = async (params, signal) => extension.tools.get('subagent').definition.execute('call', params, signal, undefined, ctx);
  const item = { state, ctx, extension, call, emit, record, async drain() { for (const message of state.queue.splice(0)) await record(message); } };
  instances.push(item);
  await emit({ type: 'session_start', reason: 'startup' });
  return item;
}
async function snapshot(parent, id) { return (await parent.call({ action: 'status', id })).details; }
function widget(parent, width = 240) { return parent.state.widgets.get('subagent').render(width); }
function view(parent, width = 240) { return widget(parent, width).join('\n').replace(/\x1b\[[0-9;]*m/g, ''); }
function inspect(parent) {
  const pending = parent.extension.commands.get('subagents').handler('', parent.ctx);
  const overlay = parent.state.overlay;
  assert(overlay, 'command opens the real custom component immediately');
  const screen = (width = 180) => overlay.component.render(width).map(stripTerminalSequences).join('\n');
  const key = (data) => { overlay.component.handleInput(data); return screen(); };
  screen();
  return { ...overlay, pending, screen, key };
}
async function stage(id, number) {
  const launch = (await logs()).filter(line => line.child === id && line.type === 'launch').at(-1);
  process.kill(launch.pid, 'SIGUSR2');
  await until(async () => (await logs()).some(line => line.child === id && line.type === 'transcript-stage' && line.stage === number));
}
async function stopAll(parent) { for (const child of (await parent.call({ action: 'status' })).details) await parent.call({ action: 'stop', id: child.id }); }
async function release(id) {
  await until(async () => (await logs()).some((line) => line.child === id && line.type === 'command' && line.command.type === 'prompt'));
  const launch = (await logs()).filter((line) => line.child === id && line.type === 'launch').at(-1);
  process.kill(launch.pid, 'SIGUSR1');
}

try {
  process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
  process.env.TEST_SUBAGENT_LOG = join(scratch, 'rpc.jsonl');
  delete process.env.PI_SUBAGENT;
  await writeFile(process.env.TEST_SUBAGENT_LOG, '');
  process.argv[1] = join(directory, 'fake-pi.mjs');
  const parent = await instance();
  assert.equal(parent.state.widgets.has('subagent'), false, 'empty sessions have no subagent widget');
  const emptyInspector = inspect(parent);
  assert.match(emptyInspector.screen(), /No subagents in this session/);
  emptyInspector.key('\x1b'); await emptyInspector.pending;
  assert.equal(parent.state.widgets.has('subagent'), false);
  const toolDescription = parent.extension.tools.get('subagent').definition.description;
  assert.match(toolDescription, /Continue independent work after acceptance/);
  assert.match(toolDescription, /end the current response/);
  assert.match(toolDescription, /Do not sleep, repeatedly query status/);
  const firstReceipt = await parent.call({ action: 'spawn', name: 'reader', message: 'before-acceptance' });
  const first = firstReceipt.details;
  assert.equal(first.accepted, true);
  assert.match(first.nextAction, /reports automatically resume you/);
  assert.match(first.nextAction, /Do not sleep, poll status/);
  assert.equal(JSON.parse(firstReceipt.content[0].text).nextAction, first.nextAction);
  const childInstructions = await readFile(join(first.directory, 'instructions.md'), 'utf8');
  assert.match(childInstructions, /return your final answer immediately/);
  assert.match(childInstructions, /If blocked, return the blocker and partial findings/);
  assert.match(childInstructions, /no separate notification is required/);
  assert.match(childInstructions, /files are deliverables, not completion signals/);
  await until(() => parent.state.reports.length === 1);
  assert.match(parent.state.reports[0].message.content, /Fast answer/);
  await until(async () => (await snapshot(parent, first.id)).sessionCost === 0.02, 'first assignment session cost');
  assert.deepEqual(parent.state.reports[0].options, { triggerTurn: true, deliverAs: 'followUp' });
  assert.equal((await snapshot(parent, first.id)).latest.delivery, 'delivered');
  assert.equal((await snapshot(parent, first.id)).model, 'test/chosen');
  assert.equal((await snapshot(parent, first.id)).thinkingLevel, 'high');
  const firstLaunch = (await logs()).find((line) => line.type === 'launch');
  for (const flag of ['--no-extensions', '--no-mcp', '--approve']) assert(firstLaunch.args.includes(flag));
  assert(!firstLaunch.args.includes('--no-skills'), 'native skill discovery remains enabled');
  assert.equal(firstLaunch.subagent, '1');
  assert.equal(firstLaunch.args[firstLaunch.args.indexOf('--extension') + 1], 'builtin:codemode');
  assert.equal(first.web, true, 'all new subagents have web search by default');
  assert(firstLaunch.args.includes(join(directory, '../../web-search/index.ts')));
  assert(firstLaunch.args.includes('read,bash,edit,write,grep,find,ls,codemode,web_search'));
  assert(!firstLaunch.args.includes('--no-session'));
  assert.equal((await stat((await snapshot(parent, first.id)).latest.resultPath)).mode & 0o777, 0o600);

  const nextReceipt = await parent.call({ action: 'send', id: first.id, message: 'next assignment' });
  assert.equal(nextReceipt.details.accepted, true);
  assert.equal(nextReceipt.details.nextAction, first.nextAction);
  assert.equal(JSON.parse(nextReceipt.content[0].text).nextAction, first.nextAction);
  await until(() => parent.state.reports.length === 2);
  assert.match(parent.state.reports.at(-1).message.content, /Assignment 2/);
  await until(async () => (await snapshot(parent, first.id)).sessionCost === 0.04, 'send accumulates session cost rather than replacing it');
  await parent.call({ action: 'stop', id: first.id });
  assert.equal((await snapshot(parent, first.id)).state, 'closed');
  await parent.call({ action: 'send', name: 'reader', message: 'remember conversation' });
  await until(() => parent.state.reports.length === 3);
  assert.match(parent.state.reports.at(-1).message.content, /Assignment 3/, 'stop/reopen keeps history');
  await until(async () => (await snapshot(parent, first.id)).sessionCost === 0.06, 'reopened process retains full conversation cost');

  const before = (await logs()).length;
  for (const params of [
    { name: 'reader', message: 'duplicate' }, { name: 'bad', message: 'x', model: 'test/missing' },
    { name: 'bad', message: 'x', model: 'test/unsafe-router' }, { name: 'bad', message: 'x', cwd: 'missing-directory' },
    { name: 'bad', message: ' ' }, { id: 'unexpected', name: 'bad', message: 'x' },
  ]) await assert.rejects(parent.call({ action: 'spawn', ...params }));
  assert.equal((await logs()).length, before, 'invalid inputs do not launch processes');
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  await writeFile(join(scratch, 'not-a-directory'), 'blocked');
  process.env.PI_CODING_AGENT_DIR = join(scratch, 'not-a-directory');
  try {
    await assert.rejects(parent.call({ action: 'spawn', name: 'disk-error', message: 'x' }), /ENOTDIR/);
    assert.equal((await parent.call({ action: 'status', name: 'disk-error' })).details.state, 'failed', 'filesystem failure releases its slot');
  } finally { process.env.PI_CODING_AGENT_DIR = agentDir; }
  await parent.emit({ type: 'message_end', message: { role: 'custom', customType: 'subagent-report' } });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(parent.call({ action: 'spawn', name: 'cancelled', message: 'x' }, aborted.signal));
  await assert.rejects(parent.call({ action: 'send', id: first.id, message: 'x', model: 'test/explicit' }), /spawn-only/);

  parent.state.busy = true;
  const heldController = new AbortController();
  const held = (await parent.call({ action: 'spawn', name: 'held', message: 'artifact-hold' }, heldController.signal)).details;
  await until(async () => (await logs()).some((line) => line.child === held.id && line.type === 'artifact-written'));
  assert.match(await readFile(join(held.directory, 'requested-report.md'), 'utf8'), /before settlement/);
  assert(!parent.state.reports.some((item) => item.message.details.childId === held.id), 'an artifact is not a completion signal');
  heldController.abort();
  assert.equal((await snapshot(parent, held.id)).state, 'running', 'parent abort after acceptance leaves child working');
  await assert.rejects(parent.call({ action: 'send', id: held.id, message: 'overlap' }), /busy/);
  const other = (await parent.call({ action: 'spawn', name: 'other', message: 'normal', model: 'test/explicit' })).details;
  await until(() => parent.state.reports.some((item) => item.message.details.childId === other.id));
  assert.equal((await snapshot(parent, other.id)).latest.delivery, 'queued');
  const stopping = parent.call({ action: 'stop', id: held.id });
  await assert.rejects(parent.call({ action: 'send', id: held.id, message: 'race with stop' }), /busy/);
  await stopping;
  assert.equal((await snapshot(parent, held.id)).latest.outcome, 'cancelled');
  assert.equal((await snapshot(parent, held.id)).state, 'closed');
  assert.equal((await snapshot(parent, other.id)).model, 'test/explicit');
  await parent.drain();
  assert.equal((await snapshot(parent, other.id)).latest.delivery, 'delivered');
  parent.state.busy = false;
  await stopAll(parent);

  const retry = (await parent.call({ action: 'spawn', name: 'retry', message: 'retry' })).details;
  await until(async () => (await logs()).some((line) => line.child === retry.id && line.type === 'waiting-for-retry'));
  assert.equal((await snapshot(parent, retry.id)).state, 'running');
  assert(!parent.state.reports.some((item) => item.message.details.childId === retry.id), 'agent_end is not completion');
  await release(retry.id);
  await until(() => parent.state.reports.some((item) => item.message.details.childId === retry.id));
  const recovered = await snapshot(parent, retry.id);
  assert.equal(recovered.latest.outcome, 'completed');
  assert.equal(recovered.latest.usage.tokens, 24);
  assert.match(await readFile(recovered.latest.resultPath, 'utf8'), /Recovered after retry/);
  await stopAll(parent);

  for (const [name, task, expected] of [['error', 'error', 'failed'], ['crash', 'crash', 'failed'], ['malformed', 'malformed', 'failed'], ['handled', 'handled', 'failed']]) {
    const child = (await parent.call({ action: 'spawn', name, message: task })).details;
    await until(() => parent.state.reports.some((item) => item.message.details.childId === child.id));
    assert.equal((await snapshot(parent, child.id)).latest.outcome, expected);
    await parent.call({ action: 'stop', id: child.id });
  }
  const mismatch = await parent.call({ action: 'spawn', name: 'mismatch', message: 'x', model: 'test/mismatch' });
  assert.equal(mismatch.isError, true);
  assert.equal(mismatch.details.accepted, false);
  assert.match(mismatch.details.error, /mismatch/);
  assert(!(await logs()).some((line) => line.child === mismatch.details.id && line.command?.type === 'prompt'));

  for (const task of ['unicode', 'approval', 'large']) {
    const child = (await parent.call({ action: 'spawn', name: task, message: task })).details;
    await until(() => parent.state.reports.some((item) => item.message.details.childId === child.id));
    const report = parent.state.reports.find((item) => item.message.details.childId === child.id).message;
    if (task === 'unicode') assert.match(report.content, /雪☃️\u2028line\u2029paragraph/);
    if (task === 'approval') assert.match(report.content, /Approval denied: true/);
    if (task === 'large') {
      assert(report.content.length < 9500);
      assert.match(report.content, /truncated/);
      assert((await readFile((await snapshot(parent, child.id)).latest.resultPath, 'utf8')).includes('X'.repeat(12000)));
    }
    await parent.call({ action: 'stop', id: child.id });
  }

  const flagged = await instance({ flag: 'openai/gpt-6.1-sol' });
  const profile = (await flagged.call({ action: 'spawn', name: 'physical', message: 'normal' })).details;
  assert.equal(profile.model, 'openai/gpt-6.1-sol');
  assert.equal(profile.requestedModel, 'openai/gpt-6.1-sol');
  assert.equal(profile.thinkingLevel, 'off', 'explicit/flagged physical models use normal child thinking defaults');
  assert.match(view(flagged), /physical · gpt-6\.1-sol · ctx (?:\?|\d+%) · ~\$/);
  assert.doesNotMatch(view(flagged), /openai\//);
  await stopAll(flagged);

  // Real selected-server MCP connection and resource paths, with no user configs/providers.
  const mcpLog = join(scratch, 'mcp-connections.txt');
  await writeFile(mcpLog, '');
  const mcpFile = join(process.env.PI_CODING_AGENT_DIR, 'mcp.json');
  const server = (name, extra = {}) => ({ command: process.execPath, args: [join(directory, 'fake-mcp.mjs'), name, mcpLog], ...extra });
  await writeFile(mcpFile, JSON.stringify({ mcpServers: { allowed: server('allowed'), excluded: server('excluded'), disabled: server('disabled', { enabled: false }) } }));
  const mcpBefore = await readFile(mcpFile, 'utf8');
  const capabilities = await instance();
  for (const name of ['missing', 'disabled']) {
    await assert.rejects(capabilities.call({ action: 'spawn', name, message: 'normal', mcpServers: [name] }), /unknown or disabled/);
  }
  const webPath = join(directory, '../../web-search/index.ts');
  const research = (await capabilities.call({ action: 'spawn', name: 'web-research', message: 'normal', web: true, mcpServers: ['allowed'] })).details;
  await until(() => capabilities.state.reports.length === 1);
  const researchArgs = (await logs()).find(line => line.type === 'launch' && line.child === research.id).args;
  assert(researchArgs.includes(webPath));
  assert(researchArgs.includes('read,bash,edit,write,grep,find,ls,codemode,web_search'));
  assert.equal(research.web, true);
  assert.deepEqual(research.mcpServers, ['allowed']);
  await assert.rejects(capabilities.call({ action: 'send', id: research.id, message: 'normal', mcpServers: [] }), /spawn-only/);
  await capabilities.call({ action: 'stop', id: research.id });
  await capabilities.call({ action: 'send', id: research.id, message: 'normal follow-up' });
  await until(() => capabilities.state.reports.length === 2);
  assert.deepEqual((await snapshot(capabilities, research.id)).mcpServers, ['allowed']);
  await stopAll(capabilities);
  const disabledConfig = JSON.parse(mcpBefore);
  disabledConfig.mcpServers.allowed.enabled = false;
  await writeFile(mcpFile, JSON.stringify(disabledConfig));
  const unavailableCapability = await capabilities.call({ action: 'send', id: research.id, message: 'normal' });
  assert.equal(unavailableCapability.isError, true);
  assert.equal((await snapshot(capabilities, research.id)).state, 'failed', 'reopen preflight failure must not leave a stuck starting child');
  await writeFile(mcpFile, mcpBefore);

  const personalSettings = join(process.env.PI_CODING_AGENT_DIR, 'settings.json');
  const policyPath = join(process.env.PI_CODING_AGENT_DIR, 'local-policy.ts');
  const brokenPolicyPath = join(process.env.PI_CODING_AGENT_DIR, 'broken-policy.ts');
  await writeFile(policyPath, `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default async function (pi: ExtensionAPI) {
  await Promise.resolve();
  pi.on('tool_call', (event) => {
    if (event.toolName === 'mcp__allowed__lookup' && event.input.blocked) return { block: true, reason: 'Synthetic local policy' };
  });
}`);
  await writeFile(brokenPolicyPath, `export default async function () { await Promise.resolve(); throw new Error('Synthetic policy failure'); }`);
  await mkdir(join(scratch, '.pi'), { recursive: true });
  await writeFile(join(scratch, '.pi/settings.json'), JSON.stringify({ subagents: { mcpPolicy: brokenPolicyPath } }));
  await writeFile(join(scratch, 'settings.json'), JSON.stringify({ subagents: { mcpPolicy: brokenPolicyPath } }));

  async function checkSelectedMcp(hasPolicy) {
    // Recreate the real child's loader after launch/reopen; the fake CLI itself never loads extensions.
    clearExtensionCache();
    await writeFile(mcpLog, '');
    const mcpRuntime = createExtensionRuntime();
    const mcpLoaded = await loadExtensions([join(research.directory, 'mcp.ts')], scratch, undefined, mcpRuntime);
    assert.deepEqual(mcpLoaded.errors, []);
    const mcpExtension = mcpLoaded.extensions[0];
    mcpRuntime.getAllTools = () => [{ name: 'codemode', reachesTools: () => 'all' }, ...[...mcpExtension.tools.values()].map(item => item.definition)];
    mcpRuntime.getActiveTools = () => ['codemode'];
    const mcpCtx = { ...capabilities.ctx, signal: new AbortController().signal };
    try {
      for (const handler of mcpExtension.handlers.get('session_start')) await handler({ type: 'session_start' }, mcpCtx);
      await until(() => mcpExtension.tools.has('mcp__allowed__lookup'), 'selected MCP server connects');
      const lookup = await mcpExtension.tools.get('mcp__allowed__lookup').definition.execute('lookup', {}, undefined, undefined, mcpCtx);
      assert.match(JSON.stringify(lookup), /allowed: synthetic answer/);
      const resources = await mcpExtension.tools.get('list_mcp_resources').definition.execute('resources', {}, undefined, undefined, mcpCtx);
      assert.match(JSON.stringify(resources), /test:\/\/allowed\/report/);
      assert.doesNotMatch(JSON.stringify(resources), /excluded|disabled/);
      const resource = await mcpExtension.tools.get('read_mcp_resource').definition.execute('read', { server: 'allowed', uri: 'test://allowed/report' }, undefined, undefined, mcpCtx);
      assert.match(JSON.stringify(resource), /allowed: synthetic resource/);
      await assert.rejects(mcpExtension.tools.get('read_mcp_resource').definition.execute('excluded-resource', { server: 'excluded', uri: 'test://excluded/report' }, undefined, undefined, mcpCtx), /has no resources/, 'resource access cannot bypass the server allowlist');
      const decisions = [];
      for (const handler of mcpExtension.handlers.get('tool_call') ?? []) decisions.push(await handler({ type: 'tool_call', toolCallId: 'synthetic-blocked', toolName: 'mcp__allowed__lookup', input: { blocked: true } }, mcpCtx));
      assert.equal(decisions.some(result => result?.block), hasPolicy, hasPolicy ? 'personal async policy blocks the synthetic selected-server call' : 'project settings cannot configure a child policy');
      assert.equal(mcpExtension.tools.has('mcp__excluded__lookup'), false);
      assert.deepEqual((await readFile(mcpLog, 'utf8')).trim().split('\n'), ['allowed'], 'unselected servers must never connect');
      assert.equal(await readFile(mcpFile, 'utf8'), mcpBefore, 'child selection must not edit global config');
    } finally {
      for (const handler of mcpExtension.handlers.get('session_shutdown') ?? []) await handler({ type: 'session_shutdown', reason: 'quit' }, mcpCtx);
    }
  }
  await checkSelectedMcp(false); // No personal setting: generic MCP works even with a throwing project policy.
  await writeFile(personalSettings, JSON.stringify({ subagents: { mcpPolicy: 'local-policy.ts' } }));
  await capabilities.call({ action: 'send', id: research.id, message: 'load current personal policy' });
  await until(() => capabilities.state.reports.length === 3);
  await stopAll(capabilities);
  assert.match(await readFile(join(research.directory, 'mcp.ts'), 'utf8'), /local-policy\.ts/);
  assert.equal('mcpPolicy' in (await snapshot(capabilities, research.id)), false, 'policy is not persisted in child snapshots');
  await checkSelectedMcp(true); // Reopening re-reads personal settings, without changing old snapshots.

  for (const [label, policy] of [['missing', 'missing-policy.ts'], ['throwing', brokenPolicyPath], ['unloadable', 'unloadable-policy.ts'], ['not-factory', 'not-factory.ts']]) {
    if (label === 'unloadable') await writeFile(join(process.env.PI_CODING_AGENT_DIR, policy), 'export default function ( {');
    if (label === 'not-factory') await writeFile(join(process.env.PI_CODING_AGENT_DIR, policy), 'export default 42;');
    await writeFile(personalSettings, JSON.stringify({ subagents: { mcpPolicy: policy } }));
    await capabilities.call({ action: 'send', id: research.id, message: `configured ${label} policy` });
    await until(async () => (await snapshot(capabilities, research.id)).state === 'idle');
    await stopAll(capabilities);
    clearExtensionCache();
    await writeFile(mcpLog, '');
    const failedPolicy = await loadExtensions([join(research.directory, 'mcp.ts')], scratch, undefined, createExtensionRuntime());
    assert.equal(failedPolicy.errors.length, 1, `${label} policy fails child extension loading`);
    assert.equal(failedPolicy.extensions.length, 0, 'failed policy cannot leave an MCP integration registered');
    assert.equal(await readFile(mcpLog, 'utf8'), '', 'configured policy failure must prevent selected server connection');
  }
  for (const policy of [null, '', '   ']) {
    await writeFile(personalSettings, JSON.stringify({ subagents: { mcpPolicy: policy } }));
    const invalid = await capabilities.call({ action: 'send', id: research.id, message: 'invalid personal setting' });
    assert.equal(invalid.isError, true);
    assert.match(invalid.details.error, /subagents\.mcpPolicy must be a non-empty path string/);
  }
  const withoutWeb = (await capabilities.call({ action: 'spawn', name: 'no-web', message: 'normal', web: false })).details;
  await until(() => capabilities.state.reports.some(item => item.message.details.childId === withoutWeb.id));
  const noWebArgs = (await logs()).find(line => line.type === 'launch' && line.child === withoutWeb.id).args;
  assert(!noWebArgs.includes(webPath), 'explicit opt-out does not load the search extension');
  assert(noWebArgs.includes('read,bash,edit,write,grep,find,ls,codemode'));
  await stopAll(capabilities);

  const instructions = (await parent.call({ action: 'spawn', name: 'instructions', message: 'normal' })).details;
  await until(() => parent.state.reports.some((item) => item.message.details.childId === instructions.id));
  await parent.call({ action: 'stop', id: instructions.id });
  await rm(join(instructions.directory, 'instructions.md'));
  const withoutInstructions = await parent.call({ action: 'send', id: instructions.id, message: 'x' });
  assert.equal(withoutInstructions.isError, true);
  assert.match(withoutInstructions.details.error, /ENOENT/, 'reopening cannot silently lose child system instructions');

  const concurrent = await instance();
  const batch = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => concurrent.call({ action: 'spawn', name: `child-${index}`, message: 'hold' })));
  assert.equal(batch.filter((item) => item.status === 'fulfilled').length, 4, 'parallel calls respect four-process limit');
  assert.equal(batch.filter((item) => item.status === 'rejected').length, 1);
  await stopAll(concurrent);
  const duplicate = await Promise.allSettled([1, 2].map(() => concurrent.call({ action: 'spawn', name: 'same', message: 'hold' })));
  assert.equal(duplicate.filter((item) => item.status === 'fulfilled').length, 1);
  await stopAll(concurrent);

  const queued = await instance(); queued.state.busy = true;
  const queueChild = (await queued.call({ action: 'spawn', name: 'queued', message: 'normal' })).details;
  await until(() => queued.state.queue.length === 1);
  queued.state.queue = [];
  await queued.emit({ type: 'agent_settled', aborted: true });
  assert.equal((await snapshot(queued, queueChild.id)).latest.delivery, 'retained');
  assert.equal(queued.state.reports.length, 1, 'cleared reports are retained, not repeatedly injected');
  await stopAll(queued);
  const queuedRestored = await instance({ id: queued.state.id, branch: queued.state.branch });
  assert.equal((await snapshot(queuedRestored, queueChild.id)).latest.delivery, 'retained');

  const lifecycle = await instance();
  const running = (await lifecycle.call({ action: 'spawn', name: 'running', message: 'hold' })).details;
  await lifecycle.emit({ type: 'session_shutdown', reason: 'reload' });
  const restored = await instance({ id: lifecycle.state.id, branch: lifecycle.state.branch });
  assert.equal((await snapshot(restored, running.id)).state, 'closed');
  assert.equal((await snapshot(restored, running.id)).latest.outcome, 'interrupted');
  assert.equal(restored.state.reports.length, 0, 'restore does not replay work or inject old reports');
  const newParent = await instance({ id: 'different-parent', branch: lifecycle.state.branch });
  assert.deepEqual((await newParent.call({ action: 'status' })).details, [], 'fork cannot inherit child ownership');

  const tree = await instance();
  await tree.call({ action: 'spawn', name: 'branch', message: 'hold' });
  tree.state.branch = [];
  await tree.emit({ type: 'session_tree', newLeafId: null });
  assert.deepEqual((await tree.call({ action: 'status' })).details, []);
  assert.equal(tree.state.reports.length, 0, 'navigation cannot misroute late reports');
  const preflight = tree.call({ action: 'spawn', name: 'preflight', message: 'hold' }).then(() => { throw new Error('Stale spawn should reject'); }, (error) => error);
  await tree.emit({ type: 'session_tree', newLeafId: null });
  assert.match((await preflight).message, /Parent session changed/);
  assert.deepEqual((await tree.call({ action: 'status' })).details, [], 'preflight cannot launch into a navigated session');

  const print = await instance({ mode: 'json' });
  await assert.rejects(print.call({ action: 'spawn', name: 'x', message: 'x' }), /interactive or RPC/);

  const realSetTimeout = global.setTimeout;
  let assignmentDeadline = false;
  global.setTimeout = (callback, ms, ...args) => {
    if (ms === 600000) assignmentDeadline = true;
    return realSetTimeout(callback, ms, ...args);
  };
  try {
    const ongoing = (await parent.call({ action: 'spawn', name: 'no-deadline', message: 'hold' })).details;
    assert.equal(assignmentDeadline, false, 'assignments must not install the old ten-minute deadline');
    assert.equal((await snapshot(parent, ongoing.id)).state, 'running');
    await parent.call({ action: 'stop', id: ongoing.id });
    assert.equal((await snapshot(parent, ongoing.id)).latest.outcome, 'cancelled');
  } finally { global.setTimeout = realSetTimeout; }

  // Compact activity widget: real component lifecycle, animation, and width-safe rows.
  const ui = await instance();
  const named = (await ui.call({ action: 'spawn', name: '測試🙂\n\x1b[31m', message: 'hold' })).details;
  assert.equal(widget(ui)[1].replace(/\x1b\[[0-9;]*m/g, ''), 'Subagents · 1 active · /subagents to inspect');
  assert.doesNotMatch(widget(ui, 30)[1], /subagents to inspect/, 'hint disappears rather than adding a widget row');
  assert.equal(widget(ui)[0], '', 'blank line separates Tasks from subagents');
  assert.equal(widget(ui).at(-1), '', 'blank line separates subagents from the next widget');
  assert.match(view(ui), / · chosen · ctx (?:\?|\d+%) · ~\$[?\d.]+ · running/);
  assert.doesNotMatch(view(ui), /test\/chosen|Context|total/);
  await until(async () => (await snapshot(ui, named.id)).contextUsage?.tokens === 2500, 'native child context remains available through status');
  await until(async () => (await snapshot(ui, named.id)).sessionCost === 0, 'known pricing permits zero before billed responses');
  assert.match(view(ui), /ctx 3% · ~\$0\.000 · running/, 'native context percentage rounds to whole percent');
  const initialHeader = widget(ui)[1];
  const initialFrame = view(ui);
  const rendersBeforeAnimation = ui.state.renderRequests;
  await until(() => view(ui) !== initialFrame, 'active indicator animates');
  assert(ui.state.renderRequests > rendersBeforeAnimation, 'animation requests local redraws');
  assert.equal(widget(ui)[1], initialHeader, 'header stays static while active row animates');
  assert.doesNotMatch(view(ui), /\x1b/);
  const queriesBeforeRender = (await logs()).filter((line) => line.command?.type === 'get_session_stats').length;
  for (const width of [0, 1, 12, 21, 31, 36, 45, 60, 80, 240]) {
    assert.equal(widget(ui, width).length, 4, 'a child never wraps into extra rows');
    for (const line of widget(ui, width)) assert(visibleWidth(line) <= width, `widget overflow at ${width}`);
  }
  assert.match(widget(ui, 45)[2], /chosen · ctx 3% · ~\$0\.000 · running/, 'name truncates before model, context, cost and status');
  assert.match(widget(ui, 31)[2], /ctx 3% · ~\$0\.000 · running/, 'metrics remain when model no longer fits');
  assert.match(widget(ui, 21)[2], /ctx 3% · running/, 'context takes priority over cost at narrow widths');
  assert.equal(widget(ui, 7)[2].replace(/\x1b\[[0-9;]*m/g, ''), 'running', 'very narrow rows prioritize status');
  view(ui); view(ui);
  assert.equal((await logs()).filter((line) => line.command?.type === 'get_session_stats').length, queriesBeforeRender, 'render/keystrokes must not perform RPC reads');
  assert.equal(ui.state.widgets.get('task'), 'untouched task');
  assert.equal(ui.state.widgets.get('todo'), 'untouched todo');
  assert.equal(ui.state.widgets.get('physical-model-usage'), 'untouched model usage');
  await release(named.id);
  await until(async () => (await snapshot(ui, named.id)).contextUsage?.tokens === 5000, 'final context sample');
  await until(async () => (await snapshot(ui, named.id)).sessionCost === 0.02, 'completed cost sample');
  assert.match(view(ui), /✓ .* · chosen · ctx 5% · ~\$0\.020 · completed/);
  assert.match(view(ui), /Subagents · 0 active/);
  const settledRenders = ui.state.renderRequests;
  await delay(180);
  assert.equal(ui.state.renderRequests, settledRenders, 'no animation remains after completion');
  assert.equal((await snapshot(ui, named.id)).latest.usage.tokens, 12, 'context usage is not cumulative billed tokens');
  const light = widget(ui).join('\n'); themes.initTheme('dark', false);
  assert.notEqual(widget(ui).join('\n'), light, 'theme evaluated at render time');
  themes.initTheme('light', false);
  await ui.call({ action: 'stop', id: named.id });
  assert.match(view(ui), /ctx 5% · ~\$0\.020 · completed/, 'stopped children retain their last context sample');
  assert.doesNotMatch(view(ui), /closed|Context/);
  const uiRestored = await instance({ id: ui.state.id, branch: ui.state.branch });
  assert.equal((await snapshot(uiRestored, named.id)).contextUsage.tokens, 5000, 'restore keeps last known context without launching a process');
  assert.equal((await snapshot(uiRestored, named.id)).sessionCost, 0.02, 'restored cost is persisted');
  assert.match(view(uiRestored), /ctx 5% · ~\$0\.020 · completed/, 'restored context is displayed without reopening the child');
  const unpriced = (await ui.call({ action: 'spawn', name: 'unpriced', model: 'test/unpriced', message: 'normal' })).details;
  await until(() => ui.state.reports.some((item) => item.message.details.childId === unpriced.id));
  await until(async () => (await snapshot(ui, unpriced.id)).sessionCost === null);
  assert.match(view(ui), /unpriced · unpriced · ctx (?:\?|\d+%) · ~\$\? · completed/, 'missing pricing is not displayed as zero');
  await ui.call({ action: 'stop', id: unpriced.id });

  const compact = (await ui.call({ action: 'spawn', name: 'compact', message: 'compact hold' })).details;
  assert.match(widget(ui)[2], /compact/, 'active child precedes completed history');
  await until(async () => /compact.*running/.test(view(ui)) && (await snapshot(ui, compact.id)).contextUsage?.tokens === null, 'unknown post-compaction context');
  assert.match(widget(ui)[2], /ctx \?/, 'post-compaction context is unknown, not zero or stale');
  await release(compact.id);
  await until(async () => (await snapshot(ui, compact.id)).contextUsage?.tokens === 5000);
  assert.match(widget(ui)[2], /ctx 5%/, 'context display recovers after compaction');
  await ui.call({ action: 'stop', id: compact.id });
  const unavailable = (await ui.call({ action: 'spawn', name: 'stats-unavailable', message: 'stats-error hold' })).details;
  await until(async () => (await logs()).some((line) => line.child === unavailable.id && line.command?.type === 'get_session_stats'));
  await until(async () => (await snapshot(ui, unavailable.id)).contextUsage?.tokens === null);
  assert.equal((await snapshot(ui, unavailable.id)).state, 'running', 'telemetry errors do not abort delegated work');
  assert.match(widget(ui)[2], /ctx \?/, 'unavailable telemetry is not displayed as zero');
  await ui.call({ action: 'stop', id: unavailable.id });
  const stale = (await ui.call({ action: 'spawn', name: 'compaction-race', message: 'stale-stat hold' })).details;
  await until(async () => (await logs()).some((line) => line.child === stale.id && line.type === 'stale-stats-replied'));
  await until(async () => (await logs()).filter((line) => line.child === stale.id && line.command?.type === 'get_session_stats').length >= 3);
  await until(async () => (await snapshot(ui, stale.id)).contextUsage?.tokens === null);
  assert(!ui.state.branch.some((entry) => entry.data?.id === stale.id && entry.data?.contextUsage?.tokens === 2500), 'pre-compaction in-flight samples must not be recorded after invalidation');
  await ui.call({ action: 'stop', id: stale.id });
  assert.equal(widget(parent).length, 8, 'long history is bounded to a header, five rows and two blank lines');
  assert.doesNotMatch(view(parent), /more ·|Context|total/);
  assert.doesNotMatch(view(parent), /reader/, 'old closed children are omitted');

  const history = new Map(parent.state.branch.filter((entry) => entry.type === 'custom' && entry.customType === 'subagent-state').map((entry) => [entry.data.id, entry]));
  const historyBranch = [...history.values()].filter((entry) => entry.data.latest).slice(0, 6).map((entry, index) => {
    const copy = structuredClone(entry);
    copy.data.name = `recent-${index}`;
    copy.data.latest.startedAt = 1000 + index * 100;
    copy.data.latest.durationMs = index === 0 ? 2000 : 10;
    return copy;
  });
  const recent = await instance({ id: parent.state.id, branch: historyBranch });
  const recentRows = widget(recent).slice(2, -1).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.deepEqual(recentRows.map((line) => line.match(/recent-\d/)[0]), ['recent-0', 'recent-5', 'recent-4', 'recent-3', 'recent-2'], 'finished assignments sort by completion time, not start time or open process');
  assert.equal((await recent.call({ action: 'status' })).details.length, 6, 'hidden history remains inspectable');
  const historyPicker = inspect(recent);
  const historyChoices = historyPicker.screen();
  for (let index = 0; index < 6; index++) assert.match(historyChoices, new RegExp(`recent-${index}`), 'picker includes children beyond the widget cap');
  for (let index = 0; index < 5; index++) historyPicker.key('\x1b[B');
  historyPicker.key('\r');
  assert.match(historyPicker.screen().split('\n')[1], /recent-1/, 'old omitted child is selectable');
  historyPicker.key('\x1b'); await historyPicker.pending;

  await ui.call({ action: 'spawn', name: 'reload-active', message: 'hold' });
  const shutdownInspector = inspect(ui);
  shutdownInspector.key('\r');
  await ui.emit({ type: 'session_shutdown', reason: 'reload' });
  await shutdownInspector.pending;
  assert.equal(ui.state.overlay, undefined, 'shutdown disposes the open viewer');
  const rendersAfterShutdown = ui.state.renderRequests;
  await delay(180);
  assert.equal(ui.state.renderRequests, rendersAfterShutdown, 'shutdown disposes active animation');
  assert.equal(ui.state.widgets.has('subagent'), false);
  assert.equal(ui.state.widgets.get('task'), 'untouched task');
  await uiRestored.call({ action: 'spawn', name: 'tree-active', message: 'hold' });
  const navigationInspector = inspect(uiRestored);
  navigationInspector.key('\r');
  uiRestored.state.branch = [];
  await uiRestored.emit({ type: 'session_tree', newLeafId: null });
  await navigationInspector.pending;
  assert.equal(uiRestored.state.overlay, undefined, 'navigation disposes the viewer and in-flight history read');
  const rendersAfterNavigation = uiRestored.state.renderRequests;
  await delay(180);
  assert.equal(uiRestored.state.renderRequests, rendersAfterNavigation, 'navigation disposes active animation');
  assert.equal(uiRestored.state.widgets.has('subagent'), false, 'tree navigation clears abandoned rows');
  const rpc = await instance({ mode: 'rpc' });
  const headless = (await rpc.call({ action: 'spawn', name: 'headless', message: 'normal' })).details;
  await until(() => rpc.state.reports.length === 1);
  await rpc.call({ action: 'stop', id: headless.id });
  assert.equal(rpc.state.widgetUpdates, 0, 'headless/RPC operation must not use terminal component factories');
  for (const headlessParent of [rpc, print]) {
    await headlessParent.extension.commands.get('subagents').handler('', headlessParent.ctx);
    assert.equal(headlessParent.state.customCalls, 0, 'non-TUI command never constructs an overlay');
    assert.match(headlessParent.state.warnings.at(-1), /requires interactive mode/);
  }

  // Actual command + native UI components, with only terminal presentation and
  // the child CLI as external boundaries. No live providers or installed state.
  const trace = await instance();
  trace.state.busy = true;
  trace.ctx.waitForIdle = () => { throw new Error('Inspection must not wait for the parent turn'); };
  const traced = (await trace.call({ action: 'spawn', name: 'trace 雪🙂', message: 'transcript-hold' })).details;
  await until(async () => (await logs()).some(line => line.child === traced.id && line.type === 'transcript-stage' && line.stage === 0));
  const neighbor = (await trace.call({ action: 'spawn', name: 'neighbor', message: 'hold' })).details;
  let inspector = inspect(trace);
  inspector.key('\x1b[B'); // Select trace, initially second behind the newer active child.
  await release(neighbor.id);
  await until(async () => (await snapshot(trace, neighbor.id)).sessionCost === 0.02);
  const stableRows = inspector.screen();
  assert(stableRows.indexOf('neighbor') < stableRows.indexOf('trace 雪🙂'), 'finishing a child does not reorder an open picker');
  const appended = (await trace.call({ action: 'spawn', name: 'newcomer', message: 'hold' })).details;
  await until(async () => (await snapshot(trace, appended.id)).contextUsage?.tokens === 2500);
  assert(inspector.screen().indexOf('newcomer') > inspector.screen().indexOf('trace 雪🙂'), 'new children append without moving existing picker rows');
  inspector.tui.terminal.rows = 28;
  inspector.key('\r');
  assert.match(inspector.screen().split('\n')[1], /trace 雪🙂/, 'selection remains attached to the child ID');
  await until(() => /INDEXED_TEXT/.test(inspector.screen()), 'opening midway includes deltas emitted before the viewer existed');
  assert.match(inspector.screen(), /lookup · preparing/);
  inspector.key('\x1b[H');
  await until(() => /Delegated assignment/.test(inspector.screen()), 'native history loaded');
  assert.match(inspector.screen(), /PRELUDE 雪🙂/);
  assert.doesNotMatch(inspector.screen(), /Abandoned branch/);
  const bodyBeforeDelta = inspector.screen().split('\n').slice(4, -2);
  const beforeDeltaWidgets = trace.state.widgetUpdates;
  const beforeDeltaQueries = (await logs()).filter(line => line.child === traced.id && line.type === 'command').length;
  await stage(traced.id, 1);
  await until(() => /New activity below/.test(inspector.screen()));
  assert.deepEqual(inspector.screen().split('\n').slice(4, -2), bodyBeforeDelta, 'scrolling up pauses follow while new output arrives');
  assert.equal(trace.state.widgetUpdates, beforeDeltaWidgets, 'text deltas do not redraw the compact widget');
  assert.equal((await logs()).filter(line => line.child === traced.id && line.type === 'command').length, beforeDeltaQueries, 'deltas use the runtime buffer, not history polling');
  inspector.key('\x1b[F');
  assert.match(inspector.screen(), /LIVE_DELTA/);
  assert.match(inspector.screen(), /AUTHORITATIVE_BLOCK/, 'block-end content replaces the reconstructed delta block');
  assert.match(inspector.screen(), /LIVE/);
  inspector.key('\x1b'); await inspector.pending;
  assert.equal((await snapshot(trace, traced.id)).state, 'running', 'closing a live viewer does not stop its child');
  inspector = inspect(trace);
  inspector.key('\x1b[B'); inspector.key('\r');
  inspector.tui.terminal.rows = 28;
  assert.match(inspector.screen().split('\n')[1], /trace 雪🙂/);
  assert.match(inspector.screen(), /LIVE_DELTA/, 'reopening retains the current partial response');
  inspector.key('e');
  await stage(traced.id, 2);
  await until(() => /replacement partial/.test(inspector.screen()), 'tool updates stream into the open transcript');
  assert.doesNotMatch(inspector.screen(), /obsolete partial/, 'partial results replace the latest snapshot, not concatenate');
  inspector.tui.terminal.rows = 100;
  const pendingHistory = inspector.screen();
  assert.equal((pendingHistory.match(/AUTHORITATIVE_END/g) ?? []).length, 1, 'completed live message survives a lagging native baseline without duplication');
  assert.equal((pendingHistory.match(/INDEXED_TEXT/g) ?? []).length, 1, 'contentIndex keeps text blocks separate from thinking and tools');
  assert.match(pendingHistory, /complete-arguments/);
  assert.match(pendingHistory, /AUTHORITATIVE_MESSAGE/, 'message-end content is authoritative over block-end content');
  assert.doesNotMatch(pendingHistory, /AUTHORITATIVE_BLOCK/);
  assert.match(pendingHistory, /lookup · running/);
  assert.doesNotMatch(pendingHistory, /PRIVATE_THINKING_BODY|incomplete/);
  await stage(traced.id, 3);
  await until(() => /History unavailable/.test(inspector.screen()), 'history failure remains local to the viewer');
  const failedHistory = inspector.screen();
  assert.match(failedHistory, /AUTHORITATIVE_END/);
  assert.match(failedHistory, /lookup · completed/);
  assert.match(failedHistory, /check · failed/);
  assert.match(failedHistory, /FINAL_TOOL_OUTPUT/);
  assert.match(failedHistory, /FAILED_TOOL_OUTPUT/);
  assert.match(failedHistory, /\[Image omitted\]/);
  assert.doesNotMatch(failedHistory, /omitted-base64|replacement partial/);
  assert.equal((await snapshot(trace, traced.id)).state, 'running', 'viewer read failure never fails the assignment');
  await stage(traced.id, 4);
  await until(() => /Context compacted/.test(inspector.screen()) && /Transcript final/.test(inspector.screen()));
  await until(async () => (await snapshot(trace, traced.id)).latest.outcome === 'completed');
  const reconciled = inspector.screen();
  for (const text of ['PRELUDE', 'AUTHORITATIVE_END', 'INDEXED_TEXT', 'FINAL_TOOL_OUTPUT', 'FAILED_TOOL_OUTPUT', 'Transcript final']) assert.equal(reconciled.split(text).length - 1, 1, `${text} renders once after native reconciliation`);
  assert.doesNotMatch(reconciled, /PRIVATE_THINKING_BODY|Abandoned branch|History unavailable/);
  assert.match(reconciled, /completed/);
  assert.equal(trace.state.reports.filter(item => item.message.details.childId === traced.id).length, 1, 'normal automatic reporting continues with the viewer open');
  inspector.key('e');
  assert.doesNotMatch(inspector.screen(), /FINAL_TOOL_OUTPUT|complete-arguments/, 'E collapses all tool arguments and output');
  assert.match(inspector.screen(), /lookup · completed/);
  inspector.key('e');
  assert.match(inspector.screen(), /FINAL_TOOL_OUTPUT/);
  await delay(30); // Drain coalesced completion/settlement reads before the render-only check.
  const readOnlyQueries = (await logs()).filter(line => line.child === traced.id && line.type === 'command').length;
  for (const width of [0, 1, 12, 32, 80, 180]) {
    const lines = inspector.component.render(width);
    for (const line of lines) assert(visibleWidth(line) <= width, `transcript overflow at ${width}`);
    assert(lines.length <= Math.floor(inspector.tui.terminal.rows * 0.85), 'overlay height is bounded');
  }
  for (const key of ['\x1b[H', '\x1b[B', '\x1b[6~', '\x1b[5~', '\x1b[A', '\x1b[F', 'e', 'e']) inspector.key(key);
  inspector.component.invalidate(); inspector.screen();
  await delay(20);
  assert.equal((await logs()).filter(line => line.child === traced.id && line.type === 'command').length, readOnlyQueries, 'rendering, scrolling, expansion, invalidation and resize make no child RPC calls');
  inspector.key('b');
  const reordered = inspector.screen();
  assert(reordered.indexOf('newcomer') < reordered.indexOf('trace 雪🙂'), 'returning rebuilds active-first picker order');
  inspector.key('\r');
  assert.match(inspector.screen().split('\n')[1], /trace 雪🙂/);
  inspector.key('\x1b'); await inspector.pending;
  assert.equal((await snapshot(trace, traced.id)).state, 'idle', 'closing inspection does not stop or reopen the child');
  assert.equal(trace.state.overlay, undefined);
  assert.doesNotMatch(JSON.stringify(trace.state.branch), /PRIVATE_THINKING_BODY|AUTHORITATIVE_END|FINAL_TOOL_OUTPUT|PRELUDE/, 'transcript bodies never enter parent persisted entries or queued reports');
  assert.doesNotMatch(JSON.stringify(await snapshot(trace, traced.id)), /PRIVATE_THINKING_BODY|AUTHORITATIVE_END|FINAL_TOOL_OUTPUT|PRELUDE/);
  await trace.call({ action: 'send', id: traced.id, message: 'second saved assignment' });
  await until(() => trace.state.reports.filter(item => item.message.details.childId === traced.id).length === 2);
  await stopAll(trace);
  const saved = await snapshot(trace, traced.id);
  const savedLines = (await readFile(saved.sessionPath, 'utf8')).trim().split('\n').map(JSON.parse);
  savedLines[0].version = 2; // Native in-memory migration must not rewrite the file.
  await writeFile(saved.sessionPath, savedLines.map(JSON.stringify).join('\n') + '\n');
  const savedBytes = await readFile(saved.sessionPath, 'utf8');
  const savedTrace = await instance({ id: trace.state.id, branch: trace.state.branch.filter(entry => entry.customType === 'subagent-state' && entry.data.id === traced.id) });
  const savedLogs = (await logs()).length;
  const savedInspector = inspect(savedTrace);
  savedInspector.tui.terminal.rows = 120;
  savedInspector.key('\r');
  await until(() => /second saved assignment/.test(savedInspector.screen()));
  const savedScreen = savedInspector.screen();
  assert.match(savedScreen, /PRELUDE/);
  assert.match(savedScreen, /Context compacted/);
  assert.match(savedScreen, /Transcript final/);
  assert.doesNotMatch(savedScreen, /Abandoned branch|PRIVATE_THINKING_BODY/);
  assert.equal(await readFile(saved.sessionPath, 'utf8'), savedBytes, 'viewing older native saved history never mutates it');
  assert.equal((await logs()).length, savedLogs, 'saved/restored inspection launches no child and sends no RPC');
  savedInspector.key('b');
  await rm(saved.sessionPath);
  savedInspector.key('\r');
  await until(() => /Transcript unavailable/.test(savedInspector.screen()));
  assert.equal((await snapshot(savedTrace, traced.id)).latest.outcome, 'completed', 'missing file is a local viewer error, not an execution failure');
  savedInspector.key('\x1b'); await savedInspector.pending;

  process.env.PI_SUBAGENT = '1';
  const guarded = await instance();
  assert.equal(guarded.extension.tools.size, 0, 'child cannot register delegation tool');
  delete process.env.PI_SUBAGENT;
  assert.equal(parent.state.warnings.length, 0);
  console.log('subagent checks passed: physical/inherited models, web loading and capability persistence, selected MCP connection/tools/resources and personal-only policy (optional, blocked calls, fail-closed loading), parallel limits, context reuse, reporting/retries, failures, approvals, Unicode, no assignment deadline, ownership, cleanup, widget isolation, read-only /subagents picker/live streaming, scroll/follow/expansion, saved pre-compaction branch history, and transcript lifecycle/error isolation');
} finally {
  for (const item of instances) await item.emit({ type: 'session_shutdown', reason: 'quit' });
  const launches = await logs();
  for (const { pid } of launches.filter((line) => line.type === 'launch')) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, `child ${pid} must be gone after cleanup`);
  }
  process.argv[1] = originalScript;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(scratch, { recursive: true, force: true });
}
