import { createHash, randomUUID } from "node:crypto";

export const statuses = ["todo", "in_progress", "done", "canceled"] as const;
export type Status = typeof statuses[number];
export type Decision = { id: string; summary: string; rationale: string; approval: "draft" | "approved"; evidence: string[]; supersedes?: string };
export type Question = { id: string; text: string; resolution?: string };
export type Artifact = { id: string; title: string; kind: string; path: string; description: string; lifecycle: "current" | "reference" | "superseded"; required: boolean; applies_to: string[] };
export type ContextPolicy = { consult_on_demand_decisions: string[]; consult_on_demand_artifacts: string[]; reason: string };
export type Todo = {
  version: 1; id: string; type: "simple" | "project"; title: string; outcome: string;
  status: Status; revision: number; created_at: string; updated_at: string;
  current_state: { summary: string; evidence: string[] };
  decisions: Decision[]; open_questions: Question[]; depends_on: string[]; next_actions: string[];
  references: string[]; artifacts: Artifact[];
  context_policy?: ContextPolicy;
  linear?: { url: string; coverage: "whole" | "partial"; status?: string; status_type?: string; refreshed_at?: string };
  last_checkpoint?: { key: string; digest: string; session_id: string; at: string };
};
export type Changes = Partial<Pick<Todo, "title" | "outcome" | "status" | "current_state" | "depends_on" | "next_actions" | "references">> & {
  decisions?: Array<Omit<Decision, "id"> & { id?: string }>;
  questions?: Array<{ id?: string; text: string; resolution?: string }>;
  linear?: { url: string; coverage: "whole" | "partial" };
  approval_evidence?: string;
};
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
export function validate(todo: Todo): Todo {
  // Read compatibility only: retain legacy constraints as unresolved questions, never as completed prerequisites.
  const legacy = todo as Todo & { blockers?: string[] };
  if (legacy.blockers !== undefined || (todo.status as string) === "blocked" || todo.depends_on === undefined) {
    todo = structuredClone(todo);
    const old = todo as Todo & { blockers?: string[] };
    if (old.blockers !== undefined) strings(old.blockers);
    const notes = [...(old.blockers ?? [])];
    if ((todo.status as string) === "blocked") { todo.status = "todo"; notes.push("Legacy blocked status: review preserved constraints and model prerequisites before starting work."); }
    for (const [index, note] of notes.entries()) {
      const hex = createHash("sha256").update(`${todo.id}:legacy-constraint:${index}:${note}`).digest("hex").slice(0, 32);
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      if (!todo.open_questions.some(question => question.id === id)) todo.open_questions.push({ id, text: note });
    }
    delete old.blockers; todo.depends_on ??= [];
  }
  keys(todo, ["version", "id", "type", "title", "outcome", "status", "revision", "created_at", "updated_at", "current_state", "decisions", "open_questions", "depends_on", "next_actions", "references", "artifacts", "context_policy", "linear", "last_checkpoint"]);
  if (todo.version !== 1) throw new Error("Unsupported todo schema version");
  requireId(todo.id);
  if (!["simple", "project"].includes(todo.type) || !statuses.includes(todo.status)) throw new Error("Invalid todo type/status");
  text(todo.title, 300); text(todo.outcome, 3000);
  if (!Number.isSafeInteger(todo.revision) || todo.revision < 1) throw new Error("Invalid revision");
  for (const value of [todo.created_at, todo.updated_at]) if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  keys(todo.current_state, ["summary", "evidence"]); text(todo.current_state.summary, 3000, true); strings(todo.current_state.evidence);
  for (const list of [todo.next_actions, todo.references]) strings(list);
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
    if (!/^artifacts\/[a-f0-9-]+-\d+\.md$/.test(a.path) || !["current", "reference", "superseded"].includes(a.lifecycle) || typeof a.required !== "boolean") throw new Error("Invalid artifact metadata");
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
    keys(todo.last_checkpoint, ["key", "digest", "session_id", "at"]); text(todo.last_checkpoint.key, 200); text(todo.last_checkpoint.digest, 64); text(todo.last_checkpoint.session_id, 200);
    if (!Number.isFinite(Date.parse(todo.last_checkpoint.at))) throw new Error("Invalid checkpoint timestamp");
  }
  return todo;
}
export function createTodo(type: Todo["type"], title: string, outcome: string): Todo {
  const now = new Date().toISOString();
  return validate({ version: 1, id: randomUUID(), type, title, outcome, status: "todo", revision: 1, created_at: now, updated_at: now, current_state: { summary: "", evidence: [] }, decisions: [], open_questions: [], depends_on: [], next_actions: [], references: [], artifacts: [] });
}
export function applyChanges(todo: Todo, changes: Changes): Todo {
  keys(changes, ["title", "outcome", "status", "current_state", "depends_on", "next_actions", "references", "decisions", "questions", "linear", "approval_evidence"]);
  if (changes.approval_evidence !== undefined) text(changes.approval_evidence, 1000);
  if (changes.status !== undefined && !statuses.includes(changes.status)) throw new Error("Invalid status; waiting is derived from depends_on");
  const next = structuredClone(todo);
  for (const key of ["title", "outcome", "status", "current_state", "depends_on", "next_actions", "references"] as const) if (changes[key] !== undefined) (next as any)[key] = structuredClone(changes[key]);
  if (changes.linear) next.linear = changes.linear.url === todo.linear?.url ? { ...todo.linear, ...changes.linear } : { ...changes.linear };
  for (const patch of changes.decisions ?? []) {
    const id = patch.id ?? randomUUID(); const index = next.decisions.findIndex(row => row.id === id);
    if (patch.id && index < 0) throw new Error("Decision ID does not exist; omit id to create");
    const evidence = [...patch.evidence];
    const receipt = changes.approval_evidence ? `User approval: ${changes.approval_evidence}` : undefined;
    if (receipt && !evidence.includes(receipt)) evidence.push(receipt);
    const decision = { ...patch, id, evidence }; if (index < 0) next.decisions.push(decision); else next.decisions[index] = decision;
    if (next.context_policy) next.context_policy.consult_on_demand_decisions = next.context_policy.consult_on_demand_decisions.filter(hidden => hidden !== id);
  }
  for (const patch of changes.questions ?? []) {
    const id = patch.id ?? randomUUID(); const index = next.open_questions.findIndex(row => row.id === id);
    if (patch.id && index < 0) throw new Error("Question ID does not exist; omit id to create");
    const question = { ...next.open_questions[index], ...patch, id }; if (index < 0) next.open_questions.push(question); else next.open_questions[index] = question;
  }
  if (changes.approval_evidence) {
    const receipt = `User approval: ${changes.approval_evidence}`;
    if (changes.outcome !== undefined && changes.outcome !== todo.outcome && !next.current_state.evidence.includes(receipt)) next.current_state.evidence.push(receipt);
  }
  return validate(next);
}
export function needsApproval(todo: Todo, changes: Changes): boolean {
  // Cite an explicit approval already given rather than asking for a second approval to save it.
  if (changes.approval_evidence?.trim()) return false;
  return (changes.outcome !== undefined && changes.outcome !== todo.outcome) || (changes.decisions ?? []).some(d => {
    const existing = todo.decisions.find(row => row.id === d.id);
    const superseded = todo.decisions.find(row => row.id === d.supersedes);
    return d.approval === "approved" || existing?.approval === "approved" || superseded?.approval === "approved";
  });
}
