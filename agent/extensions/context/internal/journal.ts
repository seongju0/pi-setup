import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 200 || /[\\/\x00-\x20\x7f]/.test(value) || value === "." || value === "..") throw new Error("Invalid history identifier");
  return value;
}

export function historyRef(session: string, entry: string) {
  return `pi-history:v1/${encodeURIComponent(identifier(session))}/${encodeURIComponent(identifier(entry))}`;
}

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
