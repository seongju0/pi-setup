import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { searchAnthropic } from "./anthropic.ts";
import { searchCodex } from "./codex.ts";

// Explicit defaults, not a heuristic model picker. Change these as your needs evolve.
const DEFAULT_MODELS = { anthropic: "claude-haiku-4-5", codex: "gpt-6-luna" };
type Provider = keyof typeof DEFAULT_MODELS;

function currentProvider(ctx: ExtensionContext): Provider {
  if (ctx.model?.provider === "anthropic") return "anthropic";
  if (ctx.model?.provider === "openai" || ctx.model?.provider === "openai-codex") return "codex";
  throw new Error("Web search supports Anthropic and Codex. Specify provider explicitly for this conversation model.");
}

const tool = defineTool({
  name: "web_search",
  label: "Web Search",
  description: "Search the public web using a separate Anthropic or Codex model and return a concise answer with native source URLs. Defaults to the current model's provider family. Does not fetch arbitrary pages or verify every claim; use agent-browser to inspect sources. Never send credentials, PHI, private code, or sensitive records to search.",
  promptSnippet: "Use web_search for current or external information. It returns a search-backed answer and source links; use agent-browser when you need to read or interact with a page.",
  parameters: Type.Object({
    query: Type.String({ minLength: 1, description: "Research question or search query. Public information only." }),
    purpose: Type.Optional(Type.String({ description: "Why the information is needed; helps focus the answer." })),
    provider: Type.Optional(Type.Union([Type.Literal("anthropic"), Type.Literal("codex")], { description: "Override the current provider family. No automatic fallback." })),
    model: Type.Optional(Type.String({ minLength: 1, description: "Exact helper model ID on the selected provider, overriding the explicit default." })),
  }),
  outputSchema: Type.Object({
    provider: Type.Union([Type.Literal("anthropic"), Type.Literal("codex")]),
    model: Type.String(),
    answer: Type.String(),
    sources: Type.Array(Type.Object({ title: Type.String(), url: Type.String() })),
  }),
  async execute(_id, params, signal, _onUpdate, ctx) {
    const query = params.query.trim();
    if (!query) throw new Error("Search query must not be blank.");
    const provider = params.provider ?? currentProvider(ctx);
    // Pi's current OpenAI subscription login lives under openai. Older logins may use openai-codex.
    const credentialProvider = provider === "anthropic" ? "anthropic"
      : ctx.model?.provider === "openai-codex" ? "openai-codex"
      : ctx.modelRegistry.getProviderAuthStatus("openai").configured ? "openai" : "openai-codex";
    const modelId = params.model ?? DEFAULT_MODELS[provider];
    const model = ctx.modelRegistry.find(credentialProvider, modelId);
    if (!model) throw new Error(`Search model ${credentialProvider}/${modelId} is unknown. No model was substituted.`);
    if (provider === "codex" && !ctx.modelRegistry.isUsingOAuth(model)) {
      throw new Error(`Codex search requires a subscription login for ${credentialProvider}; use /login. API-key OpenAI search is not supported by this extension.`);
    }
    if (provider === "anthropic" && ctx.modelRegistry.isUsingOAuth(model)) {
      throw new Error("This extension supports Anthropic API-key auth, not Anthropic subscription OAuth.");
    }
    signal?.throwIfAborted();
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    signal?.throwIfAborted();
    if (!auth.ok) throw new Error(`Search authentication failed: ${auth.error}`);
    if (!auth.apiKey) throw new Error(`No credentials available for ${credentialProvider}. Use /login.`);
    const base = new URL(auth.baseUrl ?? model.baseUrl);
    // Only the two official providers are supported. Never redirect a custom gateway's credentials.
    const root = base.href.replace(/\/+$/, "");
    let url: string;
    if (provider === "anthropic" && root === "https://api.anthropic.com" && model.api === "anthropic-messages") {
      url = `${root}/v1/messages`;
    } else if (provider === "codex" && root === "https://api.openai.com/v1" && model.api === "openai-responses") {
      url = `${root}/responses`;
    } else if (provider === "codex" && root === "https://chatgpt.com/backend-api" && model.api === "openai-codex-responses") {
      url = `${root}/codex/responses`;
    } else {
      throw new Error("Web search supports official Anthropic and OpenAI subscription endpoints only; this model's API/base URL is not supported.");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(auth.headers ?? {})) if (value !== null) headers[name] = value;
    // Headers from Pi may already include subscription account metadata; preserve it.
    const requestHeaders = new Headers(headers);
    requestHeaders.set("content-type", "application/json");
    if (provider === "anthropic") {
      requestHeaders.set("x-api-key", auth.apiKey);
      requestHeaders.set("anthropic-version", "2023-06-01");
    } else {
      requestHeaders.set("authorization", `Bearer ${auth.apiKey}`);
      requestHeaders.set("accept", "text/event-stream");
      if (credentialProvider === "openai-codex") {
        const claims = JSON.parse(Buffer.from(auth.apiKey.split(".")[1], "base64url").toString("utf8"));
        const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (!accountId) throw new Error("Codex login has no ChatGPT account ID; log in again.");
        requestHeaders.set("chatgpt-account-id", accountId);
        requestHeaders.set("OpenAI-Beta", "responses=experimental");
        requestHeaders.set("originator", "pi");
      }
    }
    const request = { model, apiKey: auth.apiKey, headers: Object.fromEntries(requestHeaders), url, query, purpose: params.purpose, signal };
    const result = await (provider === "anthropic" ? searchAnthropic(request) : searchCodex(request));
    const data = { provider, model: `${credentialProvider}/${model.id}`, answer: result.answer, sources: result.sources };
    return {
      content: [{ type: "text", text: `Provider: ${data.provider}\nModel: ${data.model}\n\n${data.answer}\n\nSources:\n${data.sources.map((source, i) => `${i + 1}. ${source.title}\n   ${source.url}`).join("\n")}` }],
      details: data, structuredContent: data, usage: result.usage,
    };
  },
});

export default function (pi: ExtensionAPI) { pi.registerTool(tool); }
