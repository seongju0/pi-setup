# Native web search

One directly available `web_search` tool. A short-lived helper model uses provider-hosted search and returns an answer plus native source URLs. No activation tool, subagent, shell script, search-service account, cache, or fallback chain.

## Use

```js
web_search({ query: "What changed in the latest Node.js release?", purpose: "Assess upgrade impact" })
web_search({ query: "Dachshund puppy socialization guidance", provider: "anthropic" })
web_search({ query: "IANA reserved example domains", provider: "codex", model: "gpt-6-luna" })
```

With codemode, `await tools.web_search(...)` returns:

```ts
{
  provider: "anthropic" | "codex",
  model: string, // exact credential-provider/model reference
  answer: string,
  sources: { title: string; url: string }[]
}
```

Sources include native search results and citation metadata, not just URLs requested in a prompt. The answer is a search-backed summary, not independent verification of every claim. Anthropic citation blocks become numbered references into `sources`. A source without a supplied title uses its URL as the label. URLs are preserved as received, including provider-supplied query parameters.

## Providers and authentication

Default routing follows the conversation model's provider family:

| Conversation provider | Search backend | Default helper model |
|---|---|---|
| `anthropic` | Anthropic API key | `claude-haiku-4-5` |
| `openai` / `openai-codex` | OpenAI subscription | `gpt-6-luna` |
| Other | Requires an explicit `provider` argument | No guess or fallback |

Change `DEFAULT_MODELS` in `index.ts` to change the persistent defaults, or pass an exact `model` ID for one call. Models are resolved through Pi's registry. Unknown models fail without substitution. Helper model choice is independent of the main conversation's model and thinking setting.

Pi resolves existing credentials and refreshes OAuth through `ctx.modelRegistry.getApiKeyAndHeaders()`. This extension does not read or write `auth.json` itself. Current subscription auth uses `openai` at the official Responses endpoint; legacy `openai-codex` auth uses its Codex endpoint/account header. An explicit Codex request from another provider uses configured `openai` auth if present, otherwise `openai-codex`. This is login selection, not retry/fallback. An OpenAI API key or Anthropic OAuth login is deliberately unsupported in v1.

Official endpoints only. Custom gateways fail before sending credentials. HTTP redirects are refused. Provider failure never retries through another provider. Cancellation is passed to the HTTP request; no separate hard search deadline is imposed.

Search must actually run, native source URLs must be present, and the response must finish. A fluent answer without search, a provider search error, an incomplete Anthropic turn, or a truncated OpenAI stream is a failed tool result. OpenAI streams are reconstructed from completed output-item events because subscription responses can have an empty final `output` array.

## Scope and privacy

Public research only. Never send PHI, credentials, private code, or sensitive records. Only the query, optional purpose, and fixed research instructions go to the helper—not the current transcript. Provider policies/retention still apply.

Use the `agent-browser` skill/CLI for reading pages, PDFs, screenshots, and browser interaction. This extension deliberately has no arbitrary URL fetching, PDF/video extraction, browser automation, result cache, source-check tool, curator UI, provider registry, or automatic provider fallback.

Token usage is returned to Pi with catalog-priced estimates. Search-specific service fees and subscription accounting are not represented by the token estimate; this is not an invoice. Usage from a request that fails before a final result is not recovered.

## Subagents and loading

Pi discovers `extensions/web-search/index.ts` in normal sessions. `/reload` is required after installation/removal changes. Subagents explicitly load this same file and allow `web_search` by default (`web: false` is an explicit opt-out); MCP remains opt-in. There is no `web_enable` step. Already saved children retain their spawn-time web setting.

The extension replaces `npm:pi-web-access`; do not enable both, since they register the same `web_search` name.

## Files

- `index.ts`: tool schema, provider/model/auth selection, output formatting.
- `anthropic.ts`: Anthropic native-search request, source/citation parsing.
- `codex.ts`: subscription Responses request and SSE parsing.
- `shared.ts`: small shared request, source, and token-usage helpers.

## Checks

```sh
# From the repository root: deterministic suites, HTTP replaced, temporary state.
npm test
```

The subagent suite verifies native-search loading and capability persistence.
No live provider calls are part of this repository's test command. The legacy
`openai-codex` login path is not live-verified.

The deterministic flows cover both providers, citation/Unicode stream parsing with empty final output, explicit provider override, rejecting no-search/provider-error results, unknown models, provider errors without fallback, credential redaction, official endpoint boundaries, and in-flight cancellation. No browser/cache tests or provider permutation matrix.

## Inspiration

The small helper-model/native-search approach comes from [mitsuhiko/agent-stuff's native-web-search skill](https://github.com/mitsuhiko/agent-stuff/tree/0865c84/skills/native-web-search). This implementation is a local Pi extension using Pi credential resolution, structured native evidence, search-execution checks, and caller cancellation rather than a standalone credential-managing CLI.
