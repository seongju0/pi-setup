import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withRead, withWrite } from "./database.ts";
import { requireId, validate } from "./state.ts";
import { insertLink, readLink } from "./links.ts";
import { acceptOperation, operationDigest, type Authority } from "./operations.ts";
import { textPage } from "./internal/retrieval.ts";

export type Source = { id: string; citation: string; note?: string; verified_at?: string };
export type Payload = { title: string; summary: string; scope: string; explanation: string; limits: string; sources: Source[] };
export type KnowledgeEntry = { version: 1; id: string; revision: number; created_at: string; updated_at: string; lifecycle: "current" | "superseded"; replacement_id?: string; payload: Payload; last_reviewed?: { at: string; checked: string }; provenance: { session_id: string; session_project_id?: string; approval_evidence?: string; origin?: { project_id: string; artifact_id?: string; artifact_version?: string } }; change_note: string };
export type KnowledgeAuthority = Authority & { session_project_id?: string };
export type SourceInput = Omit<Source, "id">;
export type KnowledgeFields = Omit<Payload, "limits" | "sources"> & { limits?: string; sources?: SourceInput[] };
export type KnowledgeInput =
  | { action: "create"; fields: KnowledgeFields; origin?: NonNullable<KnowledgeEntry["provenance"]["origin"]>; key: string; approval_evidence?: string }
  | { action: "update"; id: string; expected_revision: number; fields?: Partial<Omit<Payload, "sources">>; explanation_edits?: { old_text: string; new_text: string }[]; sources?: { add?: SourceInput[]; update?: Source[]; remove?: string[] }; change_note: string; key: string; approval_evidence?: string }
  | { action: "review"; id: string; expected_revision: number; checked: string; key: string; approval_evidence?: string }
  | { action: "supersede"; id: string; expected_revision: number; replacement_id: string; change_note: string; key: string; approval_evidence?: string }
  | { action: "history"; id: string; limit?: number; cursor?: string };
type Input = Record<string, any>;
const scalarLimits: Record<string, number> = { title: 300, summary: 1000, scope: 2000, explanation: 100000, limits: 10000 };
function object(value: unknown, allowed: string[]): asserts value is Input {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid or unknown fields");
}
function string(value: unknown, max: number, name: string, blank = false): asserts value is string {
  if (typeof value !== "string" || (!blank && !value.trim()) || value.length > max) throw new Error(`${name} must contain ${blank ? "0" : "1"}–${max} characters`);
}
function positive(value: unknown, name: string) { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${name} must be a positive integer`); }
function source(value: unknown, hasId: boolean) {
  object(value, [...(hasId ? ["id"] : []), "citation", "note", "verified_at"]);
  if (hasId) requireId(value.id);
  string(value.citation, 2000, "citation");
  if (value.note !== undefined) string(value.note, 2000, "note", true);
  if (value.verified_at !== undefined && (typeof value.verified_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.verified_at) || !Number.isFinite(Date.parse(value.verified_at)))) throw new Error("verified_at must be an ISO timestamp");
}
function fields(value: unknown, create: boolean) {
  object(value, [...Object.keys(scalarLimits), ...(create ? ["sources"] : [])]);
  for (const [key, max] of Object.entries(scalarLimits)) if (value[key] !== undefined || create && key !== "limits") string(value[key], max, key, key === "limits");
  if (create && value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > 100) throw new Error("sources must be an array of at most 100");
    value.sources.forEach((item: unknown) => source(item, false));
  }
}
export function validateKnowledgeId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9-]{1,36}$/.test(value)) throw new Error("Knowledge ID must be a UUID or unique ID prefix; search titles first");
}
/** Pure action validation: adapters call this before reads, preflight or approval. */
export function validateKnowledgeInput(input: unknown): asserts input is KnowledgeInput {
  object(input, ["action", "fields", "origin", "id", "expected_revision", "explanation_edits", "sources", "change_note", "checked", "replacement_id", "key", "approval_evidence", "limit", "cursor"]);
  const allowed: Record<string, string[]> = {
    create: ["fields", "origin", "key", "approval_evidence"],
    update: ["id", "expected_revision", "fields", "explanation_edits", "sources", "change_note", "key", "approval_evidence"],
    review: ["id", "expected_revision", "checked", "key", "approval_evidence"],
    supersede: ["id", "expected_revision", "replacement_id", "change_note", "key", "approval_evidence"],
    history: ["id", "limit", "cursor"],
  };
  if (!allowed[input.action]) throw new Error("Invalid knowledge action");
  object(input, ["action", ...allowed[input.action]]);
  if (input.action !== "create") validateKnowledgeId(input.id);
  if (input.action === "history") {
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)) throw new Error("limit must be 1–50");
    if (input.cursor !== undefined) string(input.cursor, 10000, "cursor");
    return;
  }
  string(input.key, 200, "key");
  if (input.approval_evidence !== undefined) string(input.approval_evidence, 2000, "approval_evidence");
  if (input.action !== "create") positive(input.expected_revision, "expected_revision");
  if (input.action === "create") {
    fields(input.fields, true);
    if (input.origin !== undefined) {
      object(input.origin, ["project_id", "artifact_id", "artifact_version"]); requireId(input.origin.project_id);
      if (input.origin.artifact_id !== undefined) requireId(input.origin.artifact_id);
      if ((input.origin.artifact_id === undefined) !== (input.origin.artifact_version === undefined)) throw new Error("Origin artifact requires artifact_id and artifact_version together");
      if (input.origin.artifact_version !== undefined) string(input.origin.artifact_version, 2000, "artifact_version");
    }
  } else if (input.action === "update") {
    string(input.change_note, 2000, "change_note");
    if (input.fields !== undefined) fields(input.fields, false);
    if (input.explanation_edits !== undefined) {
      if (!Array.isArray(input.explanation_edits) || input.explanation_edits.length < 1 || input.explanation_edits.length > 20) throw new Error("explanation_edits must contain 1–20 edits");
      if (input.fields?.explanation !== undefined) throw new Error("Cannot combine explanation replacement with explanation_edits");
      for (const edit of input.explanation_edits) { object(edit, ["old_text", "new_text"]); string(edit.old_text, 100000, "old_text", true); if (!edit.old_text.length) throw new Error("old_text must be nonempty"); string(edit.new_text, 100000, "new_text", true); }
    }
    if (input.sources !== undefined) {
      object(input.sources, ["add", "update", "remove"]);
      for (const key of ["add", "update", "remove"]) if (input.sources[key] !== undefined && (!Array.isArray(input.sources[key]) || input.sources[key].length > 100)) throw new Error("Source operations must be arrays of at most 100");
      (input.sources.add ?? []).forEach((item: unknown) => source(item, false));
      (input.sources.update ?? []).forEach((item: unknown) => source(item, true));
      (input.sources.remove ?? []).forEach(requireId);
      const ids = [...(input.sources.update ?? []).map((s: Source) => s.id), ...(input.sources.remove ?? [])];
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate/conflicting source IDs");
    }
    if (!Object.keys(input.fields ?? {}).length && !input.explanation_edits?.length && !Object.values(input.sources ?? {}).some(v => (v as any[]).length)) throw new Error("Empty knowledge mutation");
  } else if (input.action === "review") string(input.checked, 2000, "checked");
  else { validateKnowledgeId(input.replacement_id); string(input.change_note, 2000, "change_note"); }
}
export function resolveKnowledgeId(db: DatabaseSync, selector: string): string {
  validateKnowledgeId(selector);
  const ids = db.prepare("SELECT id FROM knowledge_entries WHERE substr(id,1,?)=? ORDER BY id").all(selector.length, selector);
  if (ids.length !== 1) throw new Error(ids.length ? "Ambiguous knowledge ID; use full UUID" : "Knowledge entry not found");
  return String(ids[0].id);
}
export function currentKnowledge(db: DatabaseSync, id: string): KnowledgeEntry {
  const row = db.prepare("SELECT r.document FROM knowledge_entries e JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=e.current_revision WHERE e.id=?").get(id);
  if (!row) throw new Error("Knowledge entry not found");
  return JSON.parse(String(row.document));
}
function patchExplanation(original: string, edits: { old_text: string; new_text: string }[]): string {
  const ranges = edits.map(edit => {
    const start = original.indexOf(edit.old_text);
    if (start < 0 || original.indexOf(edit.old_text, start + 1) >= 0) throw new Error("Explanation edit must match exactly once in the original explanation");
    return { start, end: start + edit.old_text.length, text: edit.new_text };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) throw new Error("Explanation edits overlap in the original explanation");
  let result = "", offset = 0;
  for (const range of ranges) { result += original.slice(offset, range.start) + range.text; offset = range.end; }
  return result + original.slice(offset);
}
function validateOrigin(db: DatabaseSync, origin: Input) {
  const row = db.prepare("SELECT document FROM owners WHERE id=?").get(origin.project_id);
  if (!row) throw new Error("Origin project not found");
  if (origin.artifact_id !== undefined) {
    const project = validate(JSON.parse(String(row.document)));
    if (!project.artifacts.some(a => a.id === origin.artifact_id) || !origin.artifact_version.startsWith(`artifacts/${origin.artifact_id}-`) || !db.prepare("SELECT 1 FROM artifact_revisions WHERE owner_id=? AND version=?").get(origin.project_id, origin.artifact_version)) throw new Error("Origin must identify an actual committed version of the source artifact");
  }
}
/** Revision/history/receipt and explicit origin link commit in one real transaction. */
export function knowledgeOperation(root: string, input: unknown, authority?: KnowledgeAuthority, signal?: AbortSignal) {
  validateKnowledgeInput(input);
  if (input.action === "history") return withRead(root, db => {
    const id = resolveKnowledgeId(db, input.id);
    const rows = db.prepare("SELECT document FROM knowledge_revisions WHERE entry_id=? ORDER BY revision DESC").all(id).map(row => JSON.parse(String(row.document)) as KnowledgeEntry);
    const page = knowledgePage(rows, input, operationDigest("knowledge-history", { id }), row => String(row.revision), 50);
    return { id, ...page, items: page.items.map(entry => ({ id, revision: entry.revision, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, created_at: entry.created_at, updated_at: entry.updated_at, change_note: entry.change_note, provenance: entry.provenance, last_reviewed: entry.last_reviewed, read: { tool: "context", action: "read", kind: "knowledge", id, section: "content", revision: entry.revision } })) };
  });
  if (!authority) throw new Error("Real session authority and explicit approval required");
  const digest = operationDigest(input.action, { ...input, approval_evidence: authority.approval_evidence });
  return withWrite(root, db => {
    const accepted = acceptOperation(db, authority, input.key, digest, () => {
      const now = new Date().toISOString();
      let entry: KnowledgeEntry;
      if (authority.session_project_id !== undefined) {
        requireId(authority.session_project_id);
        if (!db.prepare("SELECT id FROM owners WHERE id=?").get(authority.session_project_id)) throw new Error("Session project not found");
      }
      if (input.action === "create") {
        if (input.origin) validateOrigin(db, input.origin);
        entry = { version: 1, id: randomUUID(), revision: 1, created_at: now, updated_at: now, lifecycle: "current", payload: { ...input.fields, limits: input.fields.limits ?? "", sources: (input.fields.sources ?? []).map(s => ({ ...s, id: randomUUID() })) }, provenance: { session_id: authority.session_id, ...(authority.session_project_id ? { session_project_id: authority.session_project_id } : {}), ...(authority.approval_evidence ? { approval_evidence: authority.approval_evidence } : {}), ...(input.origin ? { origin: { ...input.origin } } : {}) }, change_note: "Created" };
        db.prepare("INSERT INTO knowledge_entries(id,current_revision) VALUES(?,?)").run(entry.id, 1);
      } else {
        const id = resolveKnowledgeId(db, input.id); entry = currentKnowledge(db, id);
        if (entry.revision !== input.expected_revision) throw new Error("Stale knowledge revision; read again before retrying");
        if (entry.lifecycle !== "current") throw new Error("Superseded entries are read-only; update the replacement");
        if (input.action === "update") {
          const original = operationDigest("knowledge-payload", entry.payload);
          Object.assign(entry.payload, input.fields ?? {});
          if (input.explanation_edits) entry.payload.explanation = patchExplanation(entry.payload.explanation, input.explanation_edits);
          const ops = input.sources ?? {};
          for (const id of [...(ops.update ?? []).map((s: Source) => s.id), ...(ops.remove ?? [])]) if (!entry.payload.sources.some(s => s.id === id)) throw new Error("Unknown source ID");
          entry.payload.sources = entry.payload.sources.filter(s => !(ops.remove ?? []).includes(s.id)).map(s => ({ ...((ops.update ?? []).find((u: Source) => u.id === s.id) ?? s) }));
          entry.payload.sources.push(...(ops.add ?? []).map(s => ({ ...s, id: randomUUID() })));
          for (const [key, max] of Object.entries(scalarLimits)) string((entry.payload as any)[key], max, key, key === "limits");
          if (entry.payload.sources.length > 100) throw new Error("At most 100 sources allowed");
          if (original === operationDigest("knowledge-payload", entry.payload)) throw new Error("Empty knowledge mutation: values unchanged");
          entry.change_note = input.change_note;
        } else if (input.action === "review") { entry.last_reviewed = { at: now, checked: input.checked }; entry.change_note = `Reviewed: ${input.checked}`; }
        else {
          const replacement = currentKnowledge(db, resolveKnowledgeId(db, input.replacement_id));
          if (replacement.id === id || replacement.lifecycle !== "current") throw new Error("Replacement must be a different current entry; cycles are forbidden");
          entry.lifecycle = "superseded"; entry.replacement_id = replacement.id; entry.change_note = input.change_note;
        }
        entry.revision++; entry.updated_at = now;
        // Provenance describes this accepted revision, while preserving original extraction context.
        entry.provenance = { ...entry.provenance, session_id: authority.session_id, session_project_id: authority.session_project_id, ...(authority.approval_evidence ? { approval_evidence: authority.approval_evidence } : { approval_evidence: undefined }) };
      }
      db.prepare("INSERT INTO knowledge_revisions(entry_id,revision,document) VALUES(?,?,?)").run(entry.id, entry.revision, JSON.stringify(entry));
      db.prepare("UPDATE knowledge_entries SET current_revision=? WHERE id=?").run(entry.revision, entry.id);
      if (input.action === "create" && input.origin) insertLink(db, { id: randomUUID(), revision: 1, from_kind: "knowledge", from_id: entry.id, to_kind: "project", to_id: input.origin.project_id, relation: "originated-in", reason: "Explicit knowledge origin", active: true, created_at: now, updated_at: now, origin: { ...input.origin } });
      return { id: entry.id, accepted_revision: entry.revision };
    });
    const current = currentKnowledge(db, String(accepted.id)).revision;
    return { ...accepted, ...(current !== accepted.accepted_revision ? { current_revision: current } : {}) };
  }, signal);
}
/** Stable live-result pagination: cursors bind semantic filters and require a surviving anchor. */
export function knowledgePage<T>(rows: T[], input: { cursor?: string; limit?: number }, binding: string, key: (row: T) => string, max: number, defaultLimit = 20) {
  const limit = input.limit ?? defaultLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new Error(`limit must be 1–${max}`);
  let after: string | undefined;
  if (input.cursor !== undefined) {
    try { const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")); if (cursor.v !== 1 || cursor.binding !== binding || typeof cursor.after !== "string") throw new Error(); after = cursor.after; }
    catch { throw new Error("Cursor filters changed or invalid; restart without cursor"); }
  }
  const index = after === undefined ? -1 : rows.findIndex(row => key(row) === after);
  if (after !== undefined && index < 0) throw new Error("Cursor anchor removed; restart without cursor");
  const items = rows.slice(index + 1, index + 1 + limit);
  return { items, next_cursor: index + 1 + items.length < rows.length ? Buffer.from(JSON.stringify({ v: 1, binding, after: key(items.at(-1)!) })).toString("base64url") : null };
}
function endpointSummary(db: DatabaseSync, kind: string, id: string) {
  if (kind === "knowledge") {
    const entry = currentKnowledge(db, id);
    return { kind, id, title: entry.payload.title, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, revision: entry.revision, read: { tool: "context", action: "read", kind, id } };
  }
  const row = db.prepare("SELECT document FROM owners WHERE id=?").get(id);
  if (!row) throw new Error("Missing project link endpoint");
  const todo = validate(JSON.parse(String(row.document)));
  return { kind, id, title: todo.title, status: todo.status, revision: todo.revision, read: { tool: "context", action: "read", kind, selector: id } };
}
export function knowledgeLinks(db: DatabaseSync, id: string) {
  const rows = db.prepare("SELECT id FROM context_links WHERE active=1 AND ((from_kind='knowledge' AND from_id=?) OR (to_kind='knowledge' AND to_id=?)) ORDER BY id").all(id, id).map(row => readLink(db, String(row.id)));
  const endpoint = { kind: "knowledge", id };
  const page = knowledgePage(rows, { limit: 20 }, operationDigest("link-list", { endpoint, direction: "both", include_inactive: false }), row => row.id, 20);
  return { ...page, items: page.items.map(link => ({ ...link, from: endpointSummary(db, link.from_kind, link.from_id), to: endpointSummary(db, link.to_kind, link.to_id) })), ...(page.next_cursor ? { read: { tool: "context_link", action: "list", endpoint, direction: "both", cursor: page.next_cursor } } : {}) };
}
function renderSources(sources: Source[]): string {
  return sources.length ? sources.map(s => `- [${s.id}] ${s.citation}${s.note !== undefined ? `\n  Note: ${s.note}` : ""}${s.verified_at ? `\n  Verified at (user-asserted): ${s.verified_at}` : ""}`).join("\n") : "None recorded";
}
export function renderKnowledgeCore(entry: KnowledgeEntry): string {
  const p = entry.payload;
  return `# ${p.title}\n\n${p.summary}\n\n## Knowledge\n\n${p.explanation}\n\n## Scope and limits\n\n${p.scope}\n\n${p.limits || "None recorded"}\n\n## Sources\n\n${renderSources(p.sources)}\n\n## Related context\n\n`;
}
function renderLinks(links: ReturnType<typeof knowledgeLinks>): string {
  return `${links.items.length ? links.items.map(link => `${link.id}: ${link.from.title} [${link.from.kind}/${link.from.id}; ${"status" in link.from ? link.from.status : link.from.lifecycle}${"replacement_id" in link.from && link.from.replacement_id ? `; replacement ${link.from.replacement_id}` : ""}] --${link.relation}--> ${link.to.title} [${link.to.kind}/${link.to.id}; ${"status" in link.to ? link.to.status : link.to.lifecycle}${"replacement_id" in link.to && link.to.replacement_id ? `; replacement ${link.to.replacement_id}` : ""}]\nReason: ${link.reason}\nRead: ${JSON.stringify({ from: link.from.read, to: link.to.read })}`).join("\n\n") : "None recorded"}${links.read ? `\n\nMore related context: ${JSON.stringify(links.read)}` : ""}\n`;
}
export type KnowledgeReadInput = { id: string; section?: "summary" | "content"; revision?: number; offset?: number; limit?: number; expected_version?: string; action?: "read"; kind?: "knowledge" };
export function validateKnowledgeRead(input: unknown): asserts input is KnowledgeReadInput {
  object(input, ["action", "kind", "id", "section", "revision", "offset", "limit", "expected_version"]);
  if (input.action !== undefined && input.action !== "read" || input.kind !== undefined && input.kind !== "knowledge") throw new Error("Invalid knowledge read");
  validateKnowledgeId(input.id);
  if (input.revision !== undefined) positive(input.revision, "revision");
  if (input.section !== undefined && !["summary", "content"].includes(input.section)) throw new Error("Invalid section");
  if ((input.section ?? "summary") === "summary" && ["offset", "limit", "expected_version"].some(key => input[key] !== undefined)) throw new Error("Summary reads forbid paging fields");
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error("Invalid offset");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 12000)) throw new Error("limit must be 1–12000");
  if (input.expected_version !== undefined) string(input.expected_version, 200, "expected_version");
  if (input.offset > 0 && !input.expected_version) throw new Error("Continuation requires expected_version");
}
/** Rendering, neighbor summaries, complete-text hash and page all share ONE read snapshot. */
export function readKnowledge(root: string, input: KnowledgeReadInput) {
  validateKnowledgeRead(input);
  return withRead(root, db => {
    const id = resolveKnowledgeId(db, input.id);
    let entry = currentKnowledge(db, id);
    if (input.revision !== undefined) {
      const row = db.prepare("SELECT document FROM knowledge_revisions WHERE entry_id=? AND revision=?").get(id, input.revision);
      if (!row) throw new Error("Knowledge revision not found"); entry = JSON.parse(String(row.document));
    }
    const links = knowledgeLinks(db, id);
    const metadata = { id, revision: entry.revision, title: entry.payload.title, summary: entry.payload.summary, scope: entry.payload.scope, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, last_reviewed: entry.last_reviewed, provenance: entry.provenance };
    const linkMetadata = input.revision !== undefined ? { current_links: links, links_note: "Current links are separately retrievable metadata, not historical body", links_read: { tool: "context_link", action: "list", endpoint: { kind: "knowledge", id } } } : { links };
    if ((input.section ?? "summary") === "summary") return { ...metadata, section: "summary", section_sizes: { title: entry.payload.title.length, summary: entry.payload.summary.length, explanation: entry.payload.explanation.length, scope: entry.payload.scope.length, limits: entry.payload.limits.length, sources: renderSources(entry.payload.sources).length }, source_count: entry.payload.sources.length, ...linkMetadata };
    const text = renderKnowledgeCore(entry) + (input.revision !== undefined ? "Historical core only. Current related context is separately retrievable.\n" : renderLinks(links));
    const version = `knowledge/${id}/${entry.revision}/${input.revision !== undefined ? "core" : createHash("sha256").update(text, "utf8").digest("hex")}`;
    if (input.expected_version !== undefined && input.expected_version !== version) throw new Error("Knowledge content changed; restart at offset 0 without expected_version");
    const { text: body, ...page } = textPage(text, input.offset, input.limit);
    // No full payload (or duplicated explanation) in structured output: body is the exact same page.
    return { id, revision: entry.revision, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, section: "content", version, ...page, body,
      ...(input.revision !== undefined ? linkMetadata : {}),
      ...(page.next_offset !== null ? { read: { tool: "context", action: "read", kind: "knowledge", id, section: "content", ...(input.revision !== undefined ? { revision: input.revision } : {}), offset: page.next_offset, ...(input.limit !== undefined ? { limit: input.limit } : {}), expected_version: version } } : {}) };
  });
}
