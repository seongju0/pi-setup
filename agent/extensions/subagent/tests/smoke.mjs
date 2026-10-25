// Opt-in LIVE check: default-enabled native web search, automatic reports, and saved follow-up.
// Asserts actual successful web_search in the real child's transcript; no shell fallback.
// Run: node agent/extensions/subagent/tests/smoke.mjs provider/model
// Parent extension runtime is mocked; child uses the installed Pi CLI and a real model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const reference = process.argv[2];
assert(reference?.includes('/'), 'Provide an exact physical provider/model (this check makes real API calls)');
const slash = reference.indexOf('/');
const model = { provider: reference.slice(0, slash), id: reference.slice(slash + 1) };
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, 'dist/core/extensions/loader.js')));
const { getAgentDir } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
const cwd = await mkdtemp(join(tmpdir(), 'pi-subagent-smoke-'));
const reportPath = join(cwd, 'research.md');
const owner = randomUUID();
const branch = [];
const reports = [];
const runtime = createExtensionRuntime();
runtime.appendEntry = (customType, data) => branch.push({ type: 'custom', customType, data: structuredClone(data) });
runtime.sendMessage = (message) => {
  reports.push(message);
  branch.push({ type: 'custom_message', ...structuredClone(message) });
};
const loaded = await loadExtensions([join(dirname(fileURLToPath(import.meta.url)), '../index.ts')], cwd, undefined, runtime);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
const context = {
  cwd, mode: 'rpc', model, thinkingLevel: 'off',
  sessionManager: { getSessionId: () => owner, getBranch: () => branch },
  modelRegistry: { find: (provider, id) => provider === model.provider && id === model.id ? model : undefined, getAvailable: () => [model] },
  isProjectTrusted: () => false, hasPendingMessages: () => false,
  ui: { notify: (text) => console.error(text) },
};
const emit = async (event) => { for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, context); };
const call = (params) => extension.tools.get('subagent').definition.execute('smoke', params, undefined, undefined, context);
async function waitForReport(count) {
  const deadline = Date.now() + 120000;
  while (reports.length < count && Date.now() < deadline) await delay(50);
  assert.equal(reports.length, count, 'Child must automatically report back');
  assert.equal(reports.at(-1).details.outcome, 'completed', reports.at(-1).content);
  assert.match(reports.at(-1).content, /SUBAGENT_SMOKE_OK/);
}
const originalScript = process.argv[1];
try {
  process.argv[1] = join(packageRoot, 'dist/cli.js');
  await emit({ type: 'session_start', reason: 'startup' });
  const started = await call({ action: 'spawn', name: 'research-smoke',
    instructions: 'Read-only public research. You must call web_search directly, not through codemode. Do not use bash, browser tools, curl, Python or any networking fallback. No MCP, private data, repository edits, external mutations or delegation. Write only the assigned report. Return a concise summary and its absolute path after writing it.',
    message: `Call web_search exactly once to find what IANA says example.com is for. Do not override its provider or model. Write a Markdown report to ${reportPath} with heading "Research smoke", findings, at least one IANA source URL from the tool, and uncertainty. Return SUBAGENT_SMOKE_OK and the absolute report path. If the tool fails or is absent, report that blocker without using an alternative.` });
  assert(!started.isError, JSON.stringify(started.details));
  await waitForReport(1);
  assert.match(await readFile(reportPath, 'utf8'), /https:\/\/www\.iana\.org\//);
  const transcript = (await readFile(started.details.sessionPath, 'utf8')).trim().split('\n').map(JSON.parse);
  const messages = transcript.filter(entry => entry.type === 'message').map(entry => entry.message);
  const searches = messages.filter(message => message.role === 'toolResult' && message.toolName === 'web_search');
  assert.equal(searches.length, 1, 'must execute the real web_search, not just mention it');
  assert.equal(searches[0].isError, false, 'the actual search must succeed');
  assert.equal(searches[0].details.provider, model.provider === 'anthropic' ? 'anthropic' : 'codex');
  assert(searches[0].details.sources.some(source => source.url.startsWith('https://www.iana.org/')));
  assert(!messages.some(message => message.role === 'toolResult' && message.toolName === 'bash'), 'no shell fallback');
  const originalReport = await readFile(reportPath, 'utf8');
  await call({ action: 'stop', id: started.details.id });
  const followup = await call({ action: 'send', id: started.details.id,
    message: `Append a section headed "Follow-up" to ${reportPath}, retaining all prior content. Explain in one sentence why the single public source is limited evidence. No more web requests. Return SUBAGENT_SMOKE_OK and the absolute report path.` });
  assert(!followup.isError, JSON.stringify(followup.details));
  await waitForReport(2);
  const revisedReport = await readFile(reportPath, 'utf8');
  assert(revisedReport.startsWith(originalReport), 'follow-up must preserve the original report');
  assert.match(revisedReport, /Follow-up/);
  assert.match(reports.at(-1).content, /research\.md/);
  const stopped = await call({ action: 'stop', id: started.details.id });
  assert.equal(stopped.details.state, 'closed');
  console.log(`Live smoke passed: ${reference}, successful default-enabled native web_search (verified in child transcript, no shell fallback), /tmp report, automatic reports, reopened follow-up preserving evidence, clean stop.`);
} finally {
  await emit({ type: 'session_shutdown', reason: 'quit' });
  process.argv[1] = originalScript;
  await rm(join(getAgentDir(), 'subagents', owner), { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
}
