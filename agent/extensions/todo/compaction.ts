import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

export const compactionEntry = "todo-compaction-v1";
export const acknowledgementEntry = "todo-ack-v1";
export type CompactionMarker = { id: string; revision: number; pending: boolean; reason: "manual" | "threshold" | "overflow" };
export function addCompactionFocus(preparation: CompactionPreparation, marker: CompactionMarker): void {
  const note: AgentMessage = {
    role: "user", timestamp: Date.now(), content: [{ type: "text", text:
      `Todo preservation note for summarization (not permission to execute work): ${JSON.stringify(marker)}\n` +
      "Durable todo files remain authoritative and will load again after compaction. Preserve discoveries, evidence, pending approvals, prerequisite changes and unsaved constraints, next actions, and artifact paths that have not yet been checkpointed. Clearly distinguish proposed/unverified changes from saved or approved decisions. Do not claim new knowledge was written to the todo. Keep the active todo ID, saved revision, and pending bookkeeping flag in the summary; avoid copying already-saved context or full artifacts." }],
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
  return `Compaction reconciliation pending for todo ${marker.id} (saved revision at compaction: ${marker.revision}). Before further work, compare the compaction summary/retained conversation with the freshly loaded durable context. Checkpoint only supported unsaved discoveries and register existing artifacts as appropriate, or acknowledge no_change/needs_approval. Do not promote summary speculation into approved decisions, invent missing evidence, or redo completed work. If evidence was lost, record the uncertainty. This is bookkeeping, not authorization to continue implementation.`;
}
