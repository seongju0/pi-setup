import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

export const compactionEntry = "todo-compaction-v1";
export const acknowledgementEntry = "todo-ack-v1";
export const preservationType = "todo-preservation-request-v1";
export const preservationReceipt = "todo-preservation-receipt-v1";
export type PreservationOutcome = "checkpoint" | "no_change" | "needs_approval";

/** Only committed entries on the active branch count, never boundary proposals. */
export function preservationState(entries: readonly any[], selected?: string) {
  const cycle: string | null = entries.findLast(entry => entry.type === "compaction")?.id ?? null;
  const request = selected ? entries.findLast(entry => entry.type === "custom_message" && entry.customType === preservationType && entry.details?.id === selected && entry.details?.cycle === cycle) : undefined;
  const receipt = request ? entries.findLast(entry => entry.type === "custom" && entry.customType === preservationReceipt && entry.data?.request_id === request.details.request_id) : undefined;
  return { cycle, request, outcome: receipt?.data.outcome as PreservationOutcome | undefined };
}
export const preservationText = (id: string) => `Before further substantive work, reconcile unsaved understanding for attached todo ${id}. Preserve significant findings, decisions with reasons, pivots, implementation/completion state and honest verification limits, unresolved constraints, and essential research/design bodies or stable authoritative references. Read needed material, save relevant document updates, then todo_checkpoint this selected owner. If saved understanding is already current, explicitly use todo_ack no_change truthfully instead of an empty checkpoint. If approval is needed, use todo_ack needs_approval to record the question and ask the user; this grants no authority. Keep current authorization and its exact limits in the conversation, not as durable execution permission. Do not prematurely finish the task, skip prescribed checks, create receipt artifacts, or start new implementation merely to satisfy this bounded bookkeeping request. Native compaction remains in control; this is not a task deadline or guaranteed preservation gate.`;
export type CompactionMarker = { id: string; revision: number; pending: boolean; reason: "manual" | "threshold" | "overflow" };
export function addCompactionFocus(preparation: CompactionPreparation, marker: CompactionMarker): void {
  const note: AgentMessage = {
    role: "user", timestamp: Date.now(), content: [{ type: "text", text:
      `Todo preservation note for summarization (not permission to execute work): ${JSON.stringify(marker)}\n` +
      "Durable todo files remain authoritative and will load again after compaction. Preserve discoveries that change project understanding, choices with reasons/rejected alternatives, uncertainty, substantial completion evidence, pending approvals, prerequisite changes, unsaved constraints and needed artifact paths. Exclude execution diaries, expired/historical stage approvals and per-test receipts; QA Toolkit/native reports own QA detail. Preserve any still-active user authorization with its exact scope, conditions and limits in the conversation summary, not the durable todo. Do not infer or expand authorization. Clearly distinguish proposed/unverified changes from saved or approved decisions. Do not claim new knowledge was written to the todo. Keep the active todo ID, saved revision, and pending bookkeeping flag in the summary; avoid copying already-saved context or full artifacts." }],
  };
  // Pi's default compactor consumes these prepared message arrays. customInstructions is not a mutable return contract.
  // Add focus to both summary inputs for split turns without replacing Pi's summarizer, cut point, or user instructions.
  if (preparation.messagesToSummarize.length) preparation.messagesToSummarize.push(note);
  if (preparation.isSplitTurn && preparation.turnPrefixMessages.length) preparation.turnPrefixMessages.push(note);
}
export function pendingReconciliation(entries: readonly any[], selected?: string): CompactionMarker | undefined {
  if (!selected) return undefined;
  let pending: CompactionMarker | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || !entry.data) continue;
    if (entry.customType === compactionEntry && entry.data?.id === selected) pending = entry.data.pending ? entry.data : undefined;
    if (entry.customType === acknowledgementEntry && entry.data?.id === selected) pending = undefined;
  }
  return pending;
}
export function reconciliationText(marker?: CompactionMarker): string {
  if (!marker) return "";
  return `Compaction reconciliation pending for todo ${marker.id} (saved revision at compaction: ${marker.revision}). Before further work, compare the compaction summary/retained conversation with the freshly loaded durable context. Checkpoint only supported unsaved understanding and substantial goal completion; preserve substantial documents only if future work needs them, not each output or QA receipt. Otherwise acknowledge no_change/needs_approval. Do not promote summary speculation into approved decisions, invent missing evidence, or redo completed work. If evidence was lost, record the uncertainty. This is bookkeeping, not authorization to continue implementation.`;
}
