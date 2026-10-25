import { addSource, checkAnswer, instructions, post, prompt, usage, type SearchAnswer, type SearchRequest, type Source } from "./shared.ts";

export async function searchAnthropic(request: SearchRequest): Promise<SearchAnswer> {
  const response = await post(request, {
    model: request.model.id, max_tokens: 3000,
    system: instructions,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: prompt(request.query, request.purpose) }],
  });
  const payload = await response.json();
  const sources: Source[] = [];
  const text: string[] = [];
  let searched = false;
  for (const block of payload.content ?? []) {
    if (block.type === "server_tool_use" && block.name === "web_search") searched = true;
    if (block.type === "web_search_tool_result") {
      if (block.content?.type === "web_search_tool_result_error") {
        throw new Error(`Anthropic web search failed: ${block.content.error_code}`);
      }
      for (const result of Array.isArray(block.content) ? block.content : []) {
        if (result.type === "web_search_result") addSource(sources, result.url, result.title);
      }
    }
    if (block.type === "text") {
      let segment = block.text;
      for (const citation of block.citations ?? []) {
        if (citation.type !== "web_search_result_location") continue;
        addSource(sources, citation.url, citation.title);
        const index = sources.findIndex((source) => source.url === citation.url);
        if (index >= 0) segment += ` [${index + 1}]`;
      }
      text.push(segment);
    }
  }
  if (!searched) throw new Error("Anthropic returned an answer without executing web search.");
  if (payload.stop_reason !== "end_turn") {
    throw new Error(`Anthropic search did not finish (${payload.stop_reason}); try a narrower query.`);
  }
  const answer = text.join("").trim();
  checkAnswer(answer, sources);
  return {
    answer, sources,
    usage: usage(request.model, {
      input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0,
      cacheRead: payload.usage?.cache_read_input_tokens ?? 0, cacheWrite: payload.usage?.cache_creation_input_tokens ?? 0,
    }),
  };
}
