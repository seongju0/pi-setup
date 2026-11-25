import { createHash, randomUUID } from "node:crypto";

export const statuses = ["todo", "in_progress", "done", "canceled"] as const;
export type Status = typeof statuses[number];
export type Decision = { id: string; summary: string; rationale: string; approval: "draft" | "approved"; evidence: string[]; supersedes?: string };
export type Question = { id: string; text: string; resolution?: string };
export type Artifact = { id: string; title: string; kind: string; path: string; description: string; lifecycle: "current" | "reference" | "superseded"; required: boolean; applies_to: string[] };
export type ContextPolicy = { consult_on_demand_decisions: string[]; consult_on_demand_artifacts: string[]; reason: string };
export type Evidence = { id: string; text: string };
export type EvidenceChanges = { add?: string[]; update?: Evidence[]; remove?: string[] };
export type Todo = {
  version: 3; id: string; type: "project"; title: string; outcome: string;
  context_refs: ContextReference[];
  legacy?: { type: "simple" | "project"; parent_id?: string };
  status: Status; revision: number; created_at: string; updated_at: string;
  current_state: { evidence: Evidence[]; summary?: string }; // Legacy summary is read-only.
  decisions: Decision[]; open_questions: Question[]; depends_on: string[]; next_actions?: string[]; // Legacy actions are read-only.
  references: string[]; artifacts: Artifact[];
  context_policy?: ContextPolicy;
  linear?: { url: string; coverage: "whole" | "partial"; status?: string; status_type?: string; refreshed_at?: string };
  last_checkpoint?: { key: string; digest: string; session_id: string; at: string; base_revision?: number };
};
export type ContextReference = { id: string; reason: string; origin?: { type: string; [key: string]: unknown } } & (
  { kind: "project-grounding"; source_project_id: string } |
  { kind: "artifact"; source_owner_id: string; artifact_id: string; follow: "current"; requirement: "source" }
);
export function validateReference(ref: ContextReference) {
  const common = ["id", "kind", "reason", "origin"];
  requireId(ref.id); text(ref.reason);
  if (ref.kind === "project-grounding") { keys(ref, [...common, "source_project_id"]); requireId(ref.source_project_id); }
  else if (ref.kind === "artifact") {
    keys(ref, [...common, "source_owner_id", "artifact_id", "follow", "requirement"]);
    requireId(ref.source_owner_id); requireId(ref.artifact_id);
    if (ref.follow !== "current" || ref.requirement !== "source") throw new Error("Invalid artifact reference policy");
  } else throw new Error("Invalid context reference kind");
  if (ref.origin !== undefined && (!ref.origin || typeof ref.origin !== "object" || Array.isArray(ref.origin) || typeof ref.origin.type !== "string" || !ref.origin.type.trim())) throw new Error("Invalid reference origin");
}
export function referenceIdentity(ref: ContextReference): string {
  return ref.kind === "project-grounding" ? `grounding/${ref.source_project_id}` : `artifact/${ref.source_owner_id}/${ref.artifact_id}`;
}
export type Changes = Partial<Pick<Todo, "title" | "outcome" | "status" | "depends_on" | "references">> & {
  evidence?: EvidenceChanges;
  decisions?: Array<Omit<Decision, "id"> & { id?: string }>;
  questions?: Array<{ id?: string; text: string; resolution?: string }>;
  linear?: { url: string; coverage: "whole" | "partial" };
  approval_evidence?: string;
};
export const artifactPathPattern = /^artifacts\/[a-f0-9-]+-\d+\.md$/;
export const idPattern = /^[a-f0-9]{8}-[a-f0-9-]{27}$/;
export function requireId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid todo/record ID");
}
function text(value: unknown, max = 2000, empty = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new Error(`Expected ${empty ? "" : "nonempty "}text, at most ${max} characters`);
}
function strings(value: unknown, max = 30): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Expected at most ${max} strings`);
  value.forEach(item => text(item));
}
function keys(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid or unknown fields");
}
export function linearUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "linear.app" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !/^\/[^/]+\/issue\/[A-Z][A-Z0-9]*-\d+\/[^/]+\/?$/.test(parsed.pathname)) throw new Error("Use a full https://linear.app/<workspace>/issue/<ID>/<slug> URL");
  return parsed.href;
}
function derivedId(...parts: Array<string | number>): string {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function evidenceId(todoId: string, baseRevision: number, addOrdinal: number): string {
  return derivedId(todoId, "evidence", baseRevision, addOrdinal);
}
export function rejectRetiredCurrentState(input: unknown) {
  if (input && typeof input === "object" && Object.hasOwn(input, "current_state")) throw new Error("current_state whole-list writes are retired and never applied; use evidence {add, update:[{id,text}], remove:[id]} with IDs from context_project get.");
}
function validateEvidence(rows: unknown): asserts rows is Evidence[] {
  if (!Array.isArray(rows)) throw new Error("Expected evidence records");
  if (rows.length > 30) throw new Error(`Evidence holds at most 30 records; this change leaves ${rows.length}. Update an existing changed finding by ID instead of adding a correction (record count unchanged); if new understanding needs room, remove or consolidate entries by ID in the same change.`);
  for (const row of rows) { keys(row, ["id", "text"]); requireId(row.id); text(row.text); }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate evidence IDs");
}
export function validate(source: Todo): Todo {
  if (source.version !== 3) throw new Error("Unsupported project model; explicit schema upgrade required");
  requireId(source.id);
  const todo = source;
  keys(todo, ["version", "id", "type", "title", "outcome", "status", "revision", "created_at", "updated_at", "current_state", "decisions", "open_questions", "depends_on", "next_actions", "references", "artifacts", "context_policy", "linear", "last_checkpoint", "context_refs", "legacy"]);
  if (todo.type !== "project" || !statuses.includes(todo.status)) throw new Error("Invalid todo type/status");
  if (!Array.isArray(todo.context_refs) || todo.context_refs.length > 500) throw new Error("Expected at most 500 context references");
  todo.context_refs.forEach(validateReference);
  if (new Set(todo.context_refs.map(ref => ref.id)).size !== todo.context_refs.length || new Set(todo.context_refs.map(referenceIdentity)).size !== todo.context_refs.length) throw new Error("Duplicate context reference");
  if (todo.context_refs.some(ref => ref.kind === "project-grounding" && ref.source_project_id === todo.id)) throw new Error("Self grounding is not allowed");
  if (todo.legacy) { keys(todo.legacy, ["type", "parent_id"]); if (!["simple", "project"].includes(todo.legacy.type)) throw new Error("Invalid legacy type"); if (todo.legacy.parent_id !== undefined) requireId(todo.legacy.parent_id); }
  text(todo.title, 300); text(todo.outcome, 3000);
  if (!Number.isSafeInteger(todo.revision) || todo.revision < 1) throw new Error("Invalid revision");
  for (const value of [todo.created_at, todo.updated_at]) if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  keys(todo.current_state, ["summary", "evidence"]); if (todo.current_state.summary !== undefined) text(todo.current_state.summary, 3000, true); validateEvidence(todo.current_state.evidence);
  if (todo.next_actions !== undefined) strings(todo.next_actions);
  strings(todo.references);
  strings(todo.depends_on, 100); todo.depends_on.forEach(requireId);
  if (new Set(todo.depends_on).size !== todo.depends_on.length) throw new Error("Duplicate dependencies");
  if (!Array.isArray(todo.decisions) || todo.decisions.length > 80 || !Array.isArray(todo.open_questions) || todo.open_questions.length > 80 || !Array.isArray(todo.artifacts) || todo.artifacts.length > 200) throw new Error("Context list limit exceeded");
  const unique = (rows: { id: string }[]) => { if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate record IDs"); };
  for (const d of todo.decisions) {
    keys(d, ["id", "summary", "rationale", "approval", "evidence", "supersedes"]); requireId(d.id); text(d.summary); text(d.rationale); strings(d.evidence);
    if (!["draft", "approved"].includes(d.approval)) throw new Error("Invalid approval");
    if (d.supersedes !== undefined) { requireId(d.supersedes); if (d.supersedes === d.id || !todo.decisions.some(row => row.id === d.supersedes)) throw new Error("Superseded decision must exist"); }
  }
  for (const q of todo.open_questions) { keys(q, ["id", "text", "resolution"]); requireId(q.id); text(q.text); if (q.resolution !== undefined) text(q.resolution); }
  for (const a of todo.artifacts) {
    keys(a, ["id", "title", "kind", "path", "description", "lifecycle", "required", "applies_to"]); requireId(a.id); text(a.title, 300); text(a.kind, 60); text(a.description, 1000);
    if (!artifactPathPattern.test(a.path) || !["current", "reference", "superseded"].includes(a.lifecycle) || typeof a.required !== "boolean") throw new Error("Invalid artifact metadata");
    strings(a.applies_to, 100); a.applies_to.forEach(requireId);
    if (a.lifecycle !== "current" && a.required) throw new Error("Only current artifacts can be required");
  }
  unique(todo.decisions); unique(todo.open_questions); unique(todo.artifacts);
  if (todo.context_policy) {
    const policy = todo.context_policy;
    keys(policy, ["consult_on_demand_decisions", "consult_on_demand_artifacts", "reason"]); text(policy.reason);
    for (const [ids, records, max] of [[policy.consult_on_demand_decisions, todo.decisions, 80], [policy.consult_on_demand_artifacts, todo.artifacts, 200]] as const) {
      strings(ids, max); ids.forEach(requireId);
      if (new Set(ids).size !== ids.length || ids.some(id => !records.some(row => row.id === id))) throw new Error("Context policy must contain unique existing record IDs");
    }
    if (todo.artifacts.some(a => a.required && policy.consult_on_demand_artifacts.includes(a.id))) throw new Error("Required artifacts cannot be made consult-on-demand");
  }
  // Supersession is a chain, not a cycle or competing replacements.
  const replaced = todo.decisions.flatMap(d => d.supersedes ? [d.supersedes] : []);
  if (new Set(replaced).size !== replaced.length) throw new Error("Decision already superseded");
  for (const d of todo.decisions) {
    const seen = new Set<string>(); let cursor: Decision | undefined = d;
    while (cursor) { if (seen.has(cursor.id)) throw new Error("Decision supersession cycle"); seen.add(cursor.id); cursor = todo.decisions.find(row => row.id === cursor?.supersedes); }
  }
  if (todo.linear) {
    keys(todo.linear, ["url", "coverage", "status", "status_type", "refreshed_at"]); linearUrl(todo.linear.url);
    if (!["whole", "partial"].includes(todo.linear.coverage)) throw new Error("Invalid issue coverage");
    if (todo.linear.status !== undefined) text(todo.linear.status, 100);
    if (todo.linear.status_type !== undefined) text(todo.linear.status_type, 100);
    if (todo.linear.refreshed_at !== undefined && !Number.isFinite(Date.parse(todo.linear.refreshed_at))) throw new Error("Invalid Linear refresh timestamp");
  }
  if (todo.last_checkpoint) {
    keys(todo.last_checkpoint, ["key", "digest", "session_id", "at", "base_revision"]);
    if (todo.last_checkpoint.base_revision !== undefined && (!Number.isSafeInteger(todo.last_checkpoint.base_revision) || todo.last_checkpoint.base_revision < 1)) throw new Error("Invalid checkpoint base revision");
    text(todo.last_checkpoint.key, 200); text(todo.last_checkpoint.digest, 64); text(todo.last_checkpoint.session_id, 200);
    if (!Number.isFinite(Date.parse(todo.last_checkpoint.at))) throw new Error("Invalid checkpoint timestamp");
  }
  return todo;
}
export function createTodo(type: "simple" | "project", title: string, outcome: string): Todo {
  if (!["simple", "project"].includes(type)) throw new Error("Invalid project type");
  const now = new Date().toISOString();
  return validate({ version: 3, id: randomUUID(), type: "project", context_refs: [], title, outcome, status: "todo", revision: 1, created_at: now, updated_at: now, current_state: { evidence: [] }, decisions: [], open_questions: [], depends_on: [], references: [], artifacts: [] });
}
export function applyChanges(todo: Todo, changes: Changes): Todo {
  rejectRetiredCurrentState(changes);
  keys(changes, ["title", "outcome", "status", "evidence", "depends_on", "references", "decisions", "questions", "linear", "approval_evidence"]);
  if (changes.approval_evidence !== undefined) text(changes.approval_evidence, 1000);
  if (changes.status !== undefined && !statuses.includes(changes.status)) throw new Error("Invalid status; waiting is derived from depends_on");
  const next = structuredClone(todo);
  if (changes.evidence !== undefined) {
    const edit = changes.evidence;
    keys(edit, ["add", "update", "remove"]);
    if (edit.add !== undefined) strings(edit.add);
    if (edit.remove !== undefined) { strings(edit.remove); edit.remove.forEach(requireId); }
    if (edit.update !== undefined) {
      if (!Array.isArray(edit.update) || edit.update.length > 30) throw new Error("Expected at most 30 evidence updates");
      for (const row of edit.update) { keys(row, ["id", "text"]); requireId(row.id); text(row.text); }
    }
    const targets = [...(edit.update ?? []).map(row => row.id), ...(edit.remove ?? [])];
    if (new Set(targets).size !== targets.length) throw new Error("Each evidence ID may be updated or removed once per change.");
    for (const id of targets) if (!todo.current_state.evidence.some(row => row.id === id)) throw new Error(`Evidence ID not found at this revision: ${id}; read the project again.`);
    next.current_state.evidence = next.current_state.evidence.filter(row => !edit.remove?.includes(row.id)).map(row => ({ ...row, text: edit.update?.find(patch => patch.id === row.id)?.text ?? row.text }));
    next.current_state.evidence.push(...(edit.add ?? []).map((text, ordinal) => ({ id: evidenceId(todo.id, todo.revision, ordinal), text })));
  }
  for (const key of ["title", "outcome", "status", "depends_on", "references"] as const) if (changes[key] !== undefined) (next as any)[key] = structuredClone(changes[key]);
  if (changes.linear) next.linear = changes.linear.url === todo.linear?.url ? { ...todo.linear, ...changes.linear } : { ...changes.linear };
  for (const patch of changes.decisions ?? []) {
    const id = patch.id ?? randomUUID(); const index = next.decisions.findIndex(row => row.id === id);
    if (patch.id && index < 0) throw new Error("Decision ID does not exist; omit id to create");
    const evidence = [...patch.evidence];
    const receipt = changes.approval_evidence ? `User approval: ${changes.approval_evidence}` : undefined;
    if (receipt && !evidence.includes(receipt)) evidence.push(receipt);
    const decision = { ...patch, id, evidence };
    // Inherit only the optional link; required fields must still validate as replacements.
    if (decision.supersedes === undefined && next.decisions[index]?.supersedes !== undefined) decision.supersedes = next.decisions[index].supersedes;
    if (index < 0) next.decisions.push(decision); else next.decisions[index] = decision;
    if (next.context_policy) next.context_policy.consult_on_demand_decisions = next.context_policy.consult_on_demand_decisions.filter(hidden => hidden !== id);
  }
  for (const patch of changes.questions ?? []) {
    const id = patch.id ?? randomUUID(); const index = next.open_questions.findIndex(row => row.id === id);
    if (patch.id && index < 0) throw new Error("Question ID does not exist; omit id to create");
    const question = { ...next.open_questions[index], ...patch, id }; if (index < 0) next.open_questions.push(question); else next.open_questions[index] = question;
  }
  if (changes.approval_evidence) {
    const receipt = `User approval: ${changes.approval_evidence}`;
    if (changes.outcome !== undefined && changes.outcome !== todo.outcome && !next.current_state.evidence.some(row => row.text === receipt)) {
      if (next.current_state.evidence.length >= 30) throw new Error(`Evidence holds at most 30 records; automatic outcome-approval provenance consumes one record even with no evidence additions, leaving ${next.current_state.evidence.length + 1}. Consolidate evidence or explicitly remove a chosen existing ID in the same change to make room for the approval receipt.`);
      next.current_state.evidence.push({ id: derivedId(todo.id, "approval-receipt", todo.revision), text: receipt });
    }
  }
  return validate(next);
}
export function needsApproval(todo: Todo, changes: Changes): boolean {
  // Cite an explicit approval already given rather than asking for a second approval to save it.
  if (changes.approval_evidence?.trim()) return false;
  return (changes.outcome !== undefined && changes.outcome !== todo.outcome) || (changes.decisions ?? []).some(d => {
    const existing = todo.decisions.find(row => row.id === d.id);
    const superseded = todo.decisions.find(row => row.id === (d.supersedes ?? existing?.supersedes));
    const priorTarget = todo.decisions.find(row => row.id === existing?.supersedes);
    return d.approval === "approved" || existing?.approval === "approved" || superseded?.approval === "approved" || priorTarget?.approval === "approved";
  });
}
