import { readFile } from "node:fs/promises";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, parseSessionEntries, type JsonAgentSessionEvent, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { ChildRpc } from "./rpc.ts";

type Message = SessionMessageEntry["message"];
export type TranscriptEvent = Extract<JsonAgentSessionEvent, { type: "message_start" | "message_update" | "message_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>;
export type ToolState = {
  id: string; name: string; args: unknown; started: boolean;
  result?: Extract<TranscriptEvent, { type: "tool_execution_end" }>["result"] & { isError: boolean; durationMs?: number };
  partial?: boolean;
};
export type TranscriptItem =
  | { key: string; kind: "message"; message: Message; streaming: boolean }
  | { key: string; kind: "tool"; tool: ToolState }
  | { key: string; kind: "marker"; text: string };

export const messageKey = (message: Message) => message.role === "toolResult" ? `toolResult:${message.toolCallId}` : `${message.role}:${message.timestamp}`;

// Only the current response and executing tools live on a child. Historical
// content belongs to the native session file and, while open, the viewer.
export class LiveTranscript {
  assistant?: AssistantMessage;
  streaming = false;
  tools = new Map<string, ToolState>();

  update(event: TranscriptEvent) {
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.assistant = structuredClone(event.message);
      this.streaming = true;
    } else if (event.type === "message_update" && this.assistant) {
      const update = event.assistantMessageEvent;
      if (!("contentIndex" in update)) return;
      const content = [...this.assistant.content];
      const previous = content[update.contentIndex];
      switch (update.type) {
        case "text_start": content[update.contentIndex] = { type: "text", text: "" }; break;
        case "text_delta": content[update.contentIndex] = { type: "text", text: (previous?.type === "text" ? previous.text : "") + update.delta }; break;
        case "text_end": content[update.contentIndex] = { type: "text", text: update.content }; break;
        case "thinking_start": content[update.contentIndex] = { type: "thinking", thinking: "" }; break;
        case "thinking_delta": content[update.contentIndex] = { type: "thinking", thinking: (previous?.type === "thinking" ? previous.thinking : "") + update.delta }; break;
        case "thinking_end": content[update.contentIndex] = { type: "thinking", thinking: update.content }; break;
        case "toolcall_start": content[update.contentIndex] = { type: "toolCall", id: update.id, name: update.toolName, arguments: {} }; break;
        case "toolcall_end": content[update.contentIndex] = update.toolCall; break;
        default: return; // Incomplete tool JSON is not useful to the viewer.
      }
      this.assistant = { ...this.assistant, content, usage: event.usage };
    } else if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        this.assistant = structuredClone(event.message);
        this.streaming = false;
      } else if (event.message.role === "toolResult") this.tools.delete(event.message.toolCallId);
    } else if (event.type === "tool_execution_start") {
      this.tools.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, args: event.args, started: true });
    } else if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const tool = this.tools.get(event.toolCallId);
      if (!tool) return;
      const result = event.type === "tool_execution_update"
        ? { ...event.partialResult, isError: false }
        : { ...event.result, isError: event.isError, durationMs: event.durationMs };
      this.tools.set(tool.id, { ...tool, result, partial: event.type === "tool_execution_update" });
    }
  }
}

export async function loadTranscript(child: { snapshot: { id: string; cwd: string; sessionPath?: string }; rpc?: ChildRpc }, signal: AbortSignal): Promise<SessionEntry[]> {
  const { id, cwd, sessionPath } = child.snapshot;
  if (child.rpc) {
    const { entries, leafId } = await child.rpc.request<{ entries: SessionEntry[]; leafId: string | null }>({ type: "get_entries" }, signal);
    return leafId === null ? [] : SessionManager.inMemory(cwd, { id }, entries).getBranch(leafId);
  }
  if (!sessionPath) return [];
  const entries = parseSessionEntries(await readFile(sessionPath, { encoding: "utf8", signal }));
  if (entries.find(entry => entry.type === "session")?.id !== id) throw new Error("Saved transcript does not match this child session");
  return SessionManager.inMemory(cwd, undefined, entries).getBranch();
}

export class Transcript {
  history: SessionEntry[] = [];
  private pending = new Map<string, Message>();

  complete(message: Message) { this.pending.set(messageKey(message), structuredClone(message)); }

  replaceHistory(entries: SessionEntry[]) {
    const previous = new Map(this.history.map(entry => [entry.id, entry]));
    this.history = entries.map(entry => previous.get(entry.id) ?? entry);
    for (const entry of entries) if (entry.type === "message") this.pending.delete(messageKey(entry.message));
  }

  items(live?: LiveTranscript): TranscriptItem[] {
    const messages = new Map<string, Message>();
    const sequence: Array<{ key: string; message?: Message; marker?: string }> = [];
    for (const entry of this.history) {
      if (entry.type === "message") {
        const key = messageKey(entry.message);
        messages.set(key, entry.message);
        sequence.push({ key, message: entry.message });
      } else if (entry.type === "compaction") sequence.push({ key: entry.id, marker: "Context compacted · earlier history retained" });
    }
    const extra = [...this.pending.values()];
    if (live?.assistant) extra.push(live.assistant);
    for (const message of extra) {
      const key = messageKey(message);
      if (!messages.has(key)) {
        messages.set(key, message);
        sequence.push({ key, message });
      }
    }
    const results = new Map([...messages.values()].filter(message => message.role === "toolResult").map(message => [message.toolCallId, message]));
    const tools = new Map<string, ToolState>();
    const items: TranscriptItem[] = [];
    const addTool = (tool: ToolState) => {
      const result = results.get(tool.id);
      const current = result ? { ...tool, started: true, result, partial: false } : live?.tools.get(tool.id) ?? tool;
      tools.set(tool.id, current);
      items.push({ key: `tool:${tool.id}`, kind: "tool", tool: current });
    };
    for (const row of sequence) {
      if (row.marker) { items.push({ key: row.key, kind: "marker", text: row.marker }); continue; }
      const message = row.message!;
      if (message.role === "user" || message.role === "assistant") {
        items.push({ key: row.key, kind: "message", message, streaming: !!live?.streaming && message === live.assistant });
        if (message.role === "assistant") for (const block of message.content) if (block.type === "toolCall") {
          addTool({ id: block.id, name: block.name, args: block.arguments, started: false });
        }
      }
    }
    // Live nested execution may not have a standalone persisted tool-call block.
    for (const tool of live?.tools.values() ?? []) if (!tools.has(tool.id)) addTool(tool);
    for (const result of results.values()) if (!tools.has(result.toolCallId)) addTool({ id: result.toolCallId, name: result.toolName, args: {}, started: true });
    return items;
  }
}
