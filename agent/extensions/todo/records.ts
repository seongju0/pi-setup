import { textPage } from "../lib/retrieval.ts";
import { requireId, type Todo, type Artifact } from "./state.ts";
import { locate } from "./storage.ts";

export type RecordKind = "evidence" | "reference" | "decision" | "question";
export type RecordInput = {
  id: string; expected_revision: number; source_kind: RecordKind;
  index?: number; record_id?: string; view?: "active" | "full"; offset?: number; limit?: number;
};
export type Provenance = {
  in_active_context: boolean; inactive_reasons: string[];
  hidden?: boolean; approval?: "draft" | "approved"; supersedes?: string; superseded_by?: string; resolved?: boolean;
};
type RecordText = Provenance & { source_kind: RecordKind; index?: number; record_id?: string; text: string };

/** The exact literal text searched and read, without labels or policy text mixed into it. */
export function recordTexts(todo: Todo): RecordText[] {
  return [
    ...todo.current_state.evidence.map((text, index) => ({ source_kind: "evidence" as const, index, text, in_active_context: true, inactive_reasons: [] })),
    ...todo.references.map((text, index) => ({ source_kind: "reference" as const, index, text, in_active_context: true, inactive_reasons: [] })),
    ...todo.decisions.map(decision => {
      const hidden = todo.context_policy?.consult_on_demand_decisions.includes(decision.id) ?? false;
      const superseded_by = todo.decisions.find(row => row.supersedes === decision.id)?.id;
      const inactive_reasons = [...(hidden ? ["hidden"] : []), ...(superseded_by ? ["superseded"] : [])];
      return {
        source_kind: "decision" as const, record_id: decision.id, text: [decision.summary, decision.rationale, ...decision.evidence].join("\n"),
        approval: decision.approval, hidden, ...(decision.supersedes ? { supersedes: decision.supersedes } : {}), ...(superseded_by ? { superseded_by } : {}),
        in_active_context: !inactive_reasons.length, inactive_reasons,
      };
    }),
    ...todo.open_questions.map(question => ({
      source_kind: "question" as const, record_id: question.id, text: [question.text, question.resolution ?? ""].join("\n"),
      resolved: !!question.resolution, in_active_context: !question.resolution, inactive_reasons: question.resolution ? ["resolved"] : [],
    })),
  ];
}

export function artifactProvenance(todo: Todo, artifact: Artifact): Provenance {
  const hidden = todo.context_policy?.consult_on_demand_artifacts.includes(artifact.id) ?? false;
  const inactive_reasons = [...(hidden ? ["hidden"] : []), ...(artifact.lifecycle !== "current" ? [artifact.lifecycle] : [])];
  return { hidden, in_active_context: !inactive_reasons.length, inactive_reasons };
}

export function recordTarget(todo: Todo, record: Pick<RecordText, "source_kind" | "index" | "record_id">, view: "active" | "full", offset: number, limit?: number) {
  return { tool: "todo_record", id: todo.id, expected_revision: todo.revision, source_kind: record.source_kind,
    ...(record.index !== undefined ? { index: record.index } : { record_id: record.record_id }), view, offset, ...(limit !== undefined ? { limit } : {}) };
}

export async function readRecordPage(root: string, input: RecordInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  requireId(input.id);
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) throw new Error("expected_revision is required and must be a positive integer");
  const indexed = input.source_kind === "evidence" || input.source_kind === "reference";
  if (!["evidence", "reference", "decision", "question"].includes(input.source_kind)) throw new Error("Invalid source_kind");
  if (indexed) {
    if (!Number.isSafeInteger(input.index) || input.index! < 0 || input.record_id !== undefined) throw new Error("evidence/reference require index and no record_id");
  } else {
    if (input.index !== undefined || input.record_id === undefined) throw new Error("decision/question require record_id and no index");
    requireId(input.record_id);
  }
  const view = input.view ?? "active";
  if (view !== "active" && view !== "full") throw new Error("Invalid view");
  const { todo } = await locate(root, input.id);
  signal?.throwIfAborted();
  if (todo.revision !== input.expected_revision) throw new Error("Owner revision changed; search again or restart with the current expected_revision");
  const record = recordTexts(todo).find(row => row.source_kind === input.source_kind && (indexed ? row.index === input.index : row.record_id === input.record_id));
  if (!record) throw new Error("Record not found");
  if (view === "active" && !record.in_active_context) throw new Error("Record is not in active context; use view full to read retained content");
  const { text, ...metadata } = record;
  const { text: body, ...page } = textPage(text, input.offset, input.limit);
  return { owner_id: todo.id, owner_revision: todo.revision, ...metadata, view, ...page, body,
    ...(page.next_offset !== null ? { read: recordTarget(todo, record, view, page.next_offset, input.limit) } : {}) };
}
