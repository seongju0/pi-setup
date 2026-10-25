// Run from the repository root: npm test. Direct: node agent/extensions/web-search/tests/test.mjs
// Real extension entry point and provider adapters. Stand-in Pi host registry; only HTTP is replaced.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
const loaded = await loadExtensions([join(dirname(fileURLToPath(import.meta.url)), '../index.ts')], process.cwd(), undefined, createExtensionRuntime());
assert.deepEqual(loaded.errors, []);
const tool = loaded.extensions[0].tools.get('web_search').definition;
const cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 };
const anthropic = { provider: 'anthropic', id: 'claude-haiku-4-5', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', cost };
const openai = { provider: 'openai', id: 'gpt-6-luna', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', cost };
const models = [anthropic, openai];
const ctx = {
  model: anthropic,
  modelRegistry: {
    find: (provider, id) => models.find(model => model.provider === provider && model.id === id),
    getProviderAuthStatus: provider => ({ configured: provider === 'openai' || provider === 'anthropic' }),
    isUsingOAuth: model => model.provider === 'openai',
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'test-secret', headers: {} }),
  },
};
const originalFetch = globalThis.fetch;
const calls = [];
let response;
globalThis.fetch = async (url, options) => {
  calls.push({ url, options, body: JSON.parse(options.body) });
  options.signal?.throwIfAborted();
  return typeof response === 'function' ? response(options) : response;
};
const call = (params, signal) => tool.execute('test', params, signal, undefined, ctx);
const source = { title: 'IANA Example Domains', url: 'https://www.iana.org/help/example-domains' };
function anthropicResponse({ searched = true, toolError } = {}) {
  return Response.json({ stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 }, content: [
    ...(searched ? [{ type: 'server_tool_use', name: 'web_search', id: 'search' },
      { type: 'web_search_tool_result', tool_use_id: 'search', content: toolError ? { type: 'web_search_tool_result_error', error_code: toolError } : [{ type: 'web_search_result', ...source }] }] : []),
    { type: 'text', text: 'Reserved for documentation', citations: [{ type: 'web_search_result_location', ...source }] },
    { type: 'text', text: '.' },
  ] });
}
function codexResponse() {
  const events = [
    { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', status: 'completed', action: { sources: [source] } } },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'message', content: [{ type: 'output_text', text: 'IANA’s example domains.', annotations: [{ type: 'url_citation', ...source }] }] } },
    { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30 } } },
  ];
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  // Real streaming frames may cross byte and Unicode boundaries, including the final output-empty event.
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13)); controller.close(); } }));
}
try {
  // Follow Anthropic, retain native citations and contiguous text; propagate usage/cancellation signal.
  const controller = new AbortController();
  response = anthropicResponse();
  const a = await call({ query: 'What are example domains?' }, controller.signal);
  assert.equal(a.structuredContent.provider, 'anthropic');
  assert.equal(a.structuredContent.model, 'anthropic/claude-haiku-4-5');
  assert.equal(a.structuredContent.answer, 'Reserved for documentation [1].');
  assert.deepEqual(a.structuredContent.sources, [source]);
  assert.equal(a.usage.totalTokens, 130);
  assert.equal(calls.at(-1).options.signal, controller.signal);
  assert.equal(calls.at(-1).url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls.at(-1).options.redirect, 'error');

  // Follow the current OpenAI subscription family; do not require final response.output to be populated.
  ctx.model = openai;
  response = codexResponse();
  const c = await call({ query: 'What are example domains?', purpose: 'Test sources' });
  assert.equal(c.structuredContent.provider, 'codex');
  assert.equal(c.structuredContent.model, 'openai/gpt-6-luna');
  assert.match(c.structuredContent.answer, /IANA’s/);
  assert.deepEqual(c.structuredContent.sources, [source]);
  assert.equal(c.usage.totalTokens, 130);
  assert.equal(c.usage.input, 80);
  assert.equal(c.usage.cacheRead, 20);
  assert.equal(calls.at(-1).url, 'https://api.openai.com/v1/responses');
  assert.equal(calls.at(-1).body.tool_choice, 'required');

  // Explicit provider override; refusing a fluent answer without actual search catches the original helper's gap.
  response = anthropicResponse({ searched: false });
  await assert.rejects(call({ query: 'Example domains', provider: 'anthropic' }), /without executing web search/);
  assert.equal(calls.at(-1).url, 'https://api.anthropic.com/v1/messages');
  response = anthropicResponse({ toolError: 'too_many_requests' });
  await assert.rejects(call({ query: 'Example domains', provider: 'anthropic' }), /too_many_requests/);

  // Provider failure never triggers a second provider or exposes the credential in error text.
  response = Response.json({ error: { message: 'Rate limit test-secret' } }, { status: 429 });
  const beforeFailure = calls.length;
  await assert.rejects(call({ query: 'Example domains' }), error => /429/.test(error.message) && !error.message.includes('test-secret'));
  assert.equal(calls.length, beforeFailure + 1);
  const beforeUnknown = calls.length;
  await assert.rejects(call({ query: 'Example domains', model: 'unknown' }), /No model was substituted/);
  const official = openai.baseUrl;
  openai.baseUrl = 'https://gateway.example/v1';
  await assert.rejects(call({ query: 'Example domains' }), /official Anthropic and OpenAI/);
  openai.baseUrl = official;
  assert.equal(calls.length, beforeUnknown, 'do not send credentials to an unsupported endpoint');

  // Cancellation of an in-flight operation reaches the actual HTTP boundary.
  const aborted = new AbortController();
  response = options => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  const pending = call({ query: 'Example domains' }, aborted.signal);
  await new Promise(resolve => setImmediate(resolve));
  aborted.abort(new Error('Search cancelled'));
  await assert.rejects(pending, /Search cancelled/);
  console.log('Web search flows passed: both provider families, native evidence, streamed item recovery, explicit override, provider failure/no fallback, endpoint boundary, cancellation.');
} finally { globalThis.fetch = originalFetch; }
