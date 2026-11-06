import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { excerpt } from "../lib/retrieval.ts";
import { historyRef, identifier } from "./sources.ts";

type ToolIdentity = { tool_name?: string; tool_namespace?: string; tool_call_id?: string; is_error?: boolean };
export type Normalized = { text: string; kind: string; provenance: "historical_original" | "derived_coordination" | "derived_summary" } & ToolIdentity;
const textContent = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part?.type === "text" && typeof part.text === "string" ? part.text : part?.type === "image" ? "[image omitted]" : "").filter(Boolean).join("\n") : "";
const identity = (name: unknown, namespace: unknown, id: unknown): ToolIdentity => ({
  ...(typeof name === "string" ? { tool_name: name.slice(0, 200) } : {}),
  ...(typeof namespace === "string" ? { tool_namespace: namespace.slice(0, 200) } : {}),
  ...(typeof id === "string" ? { tool_call_id: id.slice(0, 200) } : {}),
});

/** Raw journal text, deliberately not the edited/compacted model-context projection. */
export function normalize(entry: SessionEntry): Normalized | undefined {
  if (entry.type === "compaction" || entry.type === "branch_summary") return { kind: entry.type, provenance: "derived_summary", text: entry.summary };
  if (entry.type === "custom_message") return entry.display ? { kind: "custom_coordination", provenance: "derived_coordination", text: textContent(entry.content) } : undefined;
  if (entry.type !== "message") return undefined;
  const message = entry.message;
  if (message.role === "user") return { kind: "user", provenance: "historical_original", text: textContent(message.content) };
  if (message.role === "assistant") {
    const calls = message.content.filter(part => part.type === "toolCall");
    const text = message.content.map(part => part.type === "text" ? part.text : part.type === "toolCall" ? `Tool call ${JSON.stringify(identity(part.name, part.namespace, part.id))}\nArguments: ${JSON.stringify(part.arguments)}` : "").filter(Boolean).join("\n");
    // A journal entry may contain parallel calls; do not attribute the whole entry to its first call.
    const call = calls.length === 1 ? calls[0] : undefined;
    return { kind: calls.length ? "assistant_tool_call" : "assistant", provenance: "historical_original", text, ...(call ? identity(call.name, call.namespace, call.id) : {}) };
  }
  if (message.role === "toolResult") return { kind: "tool_result", provenance: "historical_original", text: textContent(message.content), ...identity(message.toolName, message.namespace, message.toolCallId), is_error: message.isError };
  if (message.role === "bashExecution") return { kind: "user_bash", provenance: "historical_original", text: `Command: ${message.command}\nOutput:\n${message.output}` };
  return undefined;
}

type Cursor = { v: 1; session: string; query: string; head: string; last: string; group: number };
function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (cursor.v !== 1 || typeof cursor.query !== "string" || ![0, 1].includes(cursor.group)) throw new Error();
    identifier(cursor.session); identifier(cursor.head); identifier(cursor.last);
    return cursor;
  } catch { throw new Error("Invalid history cursor; restart search"); }
}

export function searchHistory(branch: SessionEntry[], session: string, query: string, limit = 10, cursorText?: string) {
  query = query.trim();
  if (!query) throw new Error("Nonempty query required");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Search limit must be between 1 and 20");
  const queryKey = createHash("sha256").update(query).digest("hex");
  const cursor = cursorText ? decodeCursor(cursorText) : undefined;
  const head = cursor?.head ?? branch.at(-1)?.id;
  if (cursor && (cursor.session !== session || cursor.query !== queryKey)) throw new Error("History cursor does not match session/query; restart search");
  const end = branch.findIndex(entry => entry.id === head);
  if (cursor && end < 0) throw new Error("History search ancestry changed; restart search");
  const candidates = branch.slice(0, end + 1).reverse().flatMap(entry => {
    const normalized = normalize(entry);
    return normalized?.text.toLowerCase().includes(query.toLowerCase()) ? [{ entry, normalized, group: normalized.provenance === "historical_original" ? 0 : 1 }] : [];
  }).sort((a, b) => a.group - b.group);
  const previous = cursor ? candidates.findIndex(hit => hit.entry.id === cursor.last && hit.group === cursor.group) : -1;
  if (cursor && previous < 0) throw new Error("History cursor position missing; restart search");
  const selected = candidates.slice(previous + 1, previous + 1 + limit);
  const last = selected.at(-1);
  return {
    results: selected.map(({ entry, normalized }) => {
      const { text, ...metadata } = normalized;
      return { ref: historyRef(session, entry.id), session_id: session, entry_id: entry.id, timestamp: entry.timestamp, ...metadata, excerpt: excerpt(text, query) };
    }),
    next_cursor: last && previous + 1 + selected.length < candidates.length ? Buffer.from(JSON.stringify({ v: 1, session, query: queryKey, head, last: last.entry.id, group: last.group })).toString("base64url") : null,
  };
}
