import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { checkpointMessage } from "./session.ts";

export const contextType = "todo-context-v1";
export const driftType = "todo-context-drift-v1";
export const sizeType = "todo-context-size-warning-v1";
export const detachedType = "todo-context-detached-v1";
export const anchorEntry = "todo-context-anchor-v1";
export type ContextNote = { role: "custom"; customType: string; content: string; display: boolean; details: { load_id: string; anchor_version?: number; warning_key?: string; drift_key?: string }; timestamp: number };
export type Anchor = { id: string; epoch: string; after: string | null };
const ownedTypes = new Set([contextType, driftType, sizeType, detachedType, checkpointMessage]);
export const isTodoNote = (message: any) => ownedTypes.has(message.customType);
// Identity only, never content: tool results can share timestamps but have distinct call IDs.
export const messageKey = (message: any) => JSON.stringify([message.role, message.timestamp, message.toolCallId, message.responseId]);
export const ordinaryMessages = (messages: AgentMessage[]) => messages.filter(message => !isTodoNote(message));

export function hasMissingAnchor(messages: AgentMessage[], notes: ContextNote[], anchors: Map<string, Anchor>): boolean {
  const keys = new Set(ordinaryMessages(messages).map(messageKey));
  return notes.some(note => { const anchor = anchors.get(note.details.load_id); return !!anchor?.after && !keys.has(anchor.after); });
}

/** Replay each delivered note where the model first saw it, even when Pi persisted it after a tool turn. */
export function projectContext(messages: AgentMessage[], boundary: ContextNote, notes: ContextNote[], anchors: Map<string, Anchor>): AgentMessage[] {
  const ordinary = ordinaryMessages(messages);
  const buckets = new Map<number, ContextNote[]>();
  for (const note of [boundary, ...notes]) {
    const anchor = anchors.get(note.details.load_id)!;
    const index = anchor.after === null ? -1 : ordinary.findIndex(message => messageKey(message) === anchor.after);
    if (anchor.after !== null && index < 0) throw new Error("Todo context anchor is missing; refresh the todo context before continuing");
    const bucket = buckets.get(index) ?? []; bucket.push(note); buckets.set(index, bucket);
  }
  const projected: AgentMessage[] = [...buckets.get(-1) ?? []];
  ordinary.forEach((message, index) => { projected.push(message, ...buckets.get(index) ?? []); });
  const resetIndex = projected.indexOf(boundary);
  return projected.map((message, index) => index < resetIndex && message.role === "assistant" && message.api === "anthropic-messages"
    ? { ...message, content: message.content.filter(block => block.type !== "thinking") }
    : message);
}
