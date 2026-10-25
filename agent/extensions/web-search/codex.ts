import { addSource, checkAnswer, instructions, post, prompt, usage, type SearchAnswer, type SearchRequest, type Source } from "./shared.ts";

// Both current openai subscription auth and legacy openai-codex use Responses SSE.
async function completedResponse(response: Response) {
  if (!response.body) throw new Error("OpenAI search returned no response body.");
  let buffer = "";
  const output: any[] = [];
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.type === "response.output_item.done") output[event.output_index] = event.item;
      if (event.type === "response.completed") {
        if (event.response?.status !== "completed") throw new Error("OpenAI search did not complete.");
        // Subscription streams can leave final output empty; completed item events carry it.
        return { ...event.response, output: output.length ? output.filter(Boolean) : event.response.output };
      }
      if (["error", "response.failed", "response.incomplete"].includes(event.type)) {
        // Do not dump raw events, which can contain the submitted query or provider data.
        throw new Error(`OpenAI search failed (${event.type}); no other provider was tried.`);
      }
    }
  }
  throw new Error("OpenAI search stream ended before completion.");
}

export async function searchCodex(request: SearchRequest): Promise<SearchAnswer> {
  const response = await post(request, {
    model: request.model.id, instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt(request.query, request.purpose) }] }],
    tools: [{ type: "web_search" }], tool_choice: "required",
    include: ["web_search_call.action.sources"], store: false, stream: true,
  });
  const payload = await completedResponse(response);
  const sources: Source[] = [];
  const text: string[] = [];
  let searched = false;
  for (const item of payload.output ?? []) {
    if (item.type === "web_search_call") {
      if (item.status !== "completed") throw new Error("OpenAI web search call did not complete.");
      searched = true;
      for (const source of item.action?.sources ?? []) addSource(sources, source.url, source.title);
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text.push(part.text);
        for (const annotation of part.annotations ?? []) {
          if (annotation.type === "url_citation") addSource(sources, annotation.url, annotation.title);
        }
      }
    }
  }
  if (!searched) throw new Error("OpenAI returned an answer without executing web search.");
  const answer = text.join("\n\n").trim();
  checkAnswer(answer, sources);
  const cached = payload.usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    answer, sources,
    usage: usage(request.model, {
      input: (payload.usage?.input_tokens ?? 0) - cached, output: payload.usage?.output_tokens ?? 0, cacheRead: cached,
    }),
  };
}
