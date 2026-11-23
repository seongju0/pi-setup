import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { artifactBytes, readRows, updateOwner, validateReferences, withRead, withWrite } from "./database.ts";
import { requireId, validate, validateReference, type ContextReference } from "./state.ts";
import { acceptOperation, operationDigest, replay, type Authority } from "./operations.ts";

export type Endpoint = { kind: "project" | "knowledge"; id: string };
export type Relation = "related" | "contributes-to" | "uses" | "originated-in";
export type Link = { id: string; revision: number; from_kind: Endpoint["kind"]; from_id: string; to_kind: Endpoint["kind"]; to_id: string; relation: Relation; reason: string; active: boolean; created_at: string; updated_at: string; origin?: Record<string, unknown>; change_note?: string };
function fields(value: object, allowed: string[]) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error("Invalid or unknown fields"); }
function reason(value: string) { if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error("Expected reason/change_note (1–2000)"); }
function endpoint(db: DatabaseSync, value: Endpoint) {
  fields(value, ["kind", "id"]); requireId(value.id);
  if (!["project", "knowledge"].includes(value.kind)) throw new Error("Invalid endpoint kind");
  if (!db.prepare(value.kind === "project" ? "SELECT id FROM owners WHERE id=?" : "SELECT id FROM knowledge_entries WHERE id=?").get(value.id)) throw new Error(`Missing ${value.kind} endpoint: ${value.id}`);
}
function identity(db: DatabaseSync, from: Endpoint, to: Endpoint, relation: Relation, except?: string) {
  endpoint(db, from); endpoint(db, to);
  if (from.kind === to.kind && from.id === to.id) throw new Error("Self links are not allowed");
  if (!(relation === "related" || relation === "contributes-to" && from.kind === "project" && to.kind === "project" || relation === "uses" && to.kind === "knowledge" || relation === "originated-in" && from.kind === "knowledge" && to.kind === "project")) throw new Error("Invalid relation/endpoints");
  const duplicate = db.prepare("SELECT id FROM context_links WHERE from_kind=? AND from_id=? AND to_kind=? AND to_id=? AND relation=? AND active=1").get(from.kind, from.id, to.kind, to.id, relation);
  if (duplicate && duplicate.id !== except) throw new Error("Active link already exists");
}
export function readLink(db: DatabaseSync, id: string): Link {
  requireId(id); const row = db.prepare("SELECT * FROM context_links WHERE id=?").get(id);
  if (!row) throw new Error("Link not found");
  const { origin, active, ...rest } = row;
  return { ...rest, active: !!active, ...(origin ? { origin: JSON.parse(String(origin)) } : {}) } as Link;
}
export function insertLink(db: DatabaseSync, link: Link) {
  db.prepare("INSERT INTO context_links(id,revision,from_kind,from_id,to_kind,to_id,relation,reason,active,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(link.id, link.revision, link.from_kind, link.from_id, link.to_kind, link.to_id, link.relation, link.reason, Number(link.active), link.created_at, link.updated_at, link.origin ? JSON.stringify(link.origin) : null);
  db.prepare("INSERT INTO context_link_revisions(link_id,revision,document) VALUES(?,?,?)").run(link.id, link.revision, JSON.stringify(link));
}
export type LinkWrite = { key: string } & (
  { action: "link"; from: Endpoint; to: Endpoint; relation: Relation; reason: string } |
  { action: "unlink" | "restore"; id: string; expected_revision: number; change_note: string } |
  { action: "update_reason"; id: string; expected_revision: number; reason: string }
);
export function writeLink(root: string, input: LinkWrite, authority: Authority, signal?: AbortSignal) {
  fields(input, input.action === "link" ? ["action", "key", "from", "to", "relation", "reason"] : input.action === "update_reason" ? ["action", "key", "id", "expected_revision", "reason"] : ["action", "key", "id", "expected_revision", "change_note"]);
  if (!["link", "unlink", "restore", "update_reason"].includes(input.action)) throw new Error("Invalid link action");
  const digest = operationDigest(input.action, { ...input, approval_evidence: authority.approval_evidence });
  return withWrite(root, db => {
    const result = acceptOperation(db, authority, input.key, digest, () => {
      let link: Link;
      const now = new Date().toISOString();
      if (input.action === "link") {
        reason(input.reason); identity(db, input.from, input.to, input.relation);
        // Inactive identity must be restored by ID, not silently recreated.
        if (db.prepare("SELECT id FROM context_links WHERE from_kind=? AND from_id=? AND to_kind=? AND to_id=? AND relation=?").get(input.from.kind, input.from.id, input.to.kind, input.to.id, input.relation)) throw new Error("Existing inactive link must be restored by ID");
        link = { id: randomUUID(), revision: 1, from_kind: input.from.kind, from_id: input.from.id, to_kind: input.to.kind, to_id: input.to.id, relation: input.relation, reason: input.reason, active: true, created_at: now, updated_at: now };
        insertLink(db, link);
      } else {
        link = readLink(db, input.id);
        if (link.revision !== input.expected_revision) throw new Error("Stale link revision");
        if (input.action === "update_reason") { reason(input.reason); link.reason = input.reason; }
        else {
          reason(input.change_note); link.change_note = input.change_note;
          const active = input.action === "restore";
          if (link.active === active) throw new Error("Link already in requested state");
          if (active) identity(db, { kind: link.from_kind, id: link.from_id }, { kind: link.to_kind, id: link.to_id }, link.relation, link.id);
          link.active = active;
        }
        link.revision++; link.updated_at = now;
        db.prepare("UPDATE context_links SET revision=?,reason=?,active=?,updated_at=? WHERE id=?").run(link.revision, link.reason, Number(link.active), now, link.id);
        db.prepare("INSERT INTO context_link_revisions(link_id,revision,document) VALUES(?,?,?)").run(link.id, link.revision, JSON.stringify(link));
      }
      return { id: link.id, accepted_revision: link.revision };
    });
    const current = readLink(db, String(result.id)).revision;
    return { ...result, ...(current !== result.accepted_revision ? { current_revision: current } : {}) };
  }, signal);
}
export type ReferenceWrite = { project_id: string; expected_revision: number; key: string } & (
  { action: "reference_add"; reference: Omit<Extract<ContextReference, { kind: "artifact" }>, "id" | "origin"> | Omit<Extract<ContextReference, { kind: "project-grounding" }>, "id" | "origin"> } |
  { action: "reference_remove"; reference_id: string; change_note: string }
);
export function writeReference(root: string, input: ReferenceWrite, authority: Authority, signal?: AbortSignal) {
  fields(input, ["action", "project_id", "expected_revision", "key", ...(input.action === "reference_add" ? ["reference"] : ["reference_id", "change_note"])]);
  if (!["reference_add", "reference_remove"].includes(input.action)) throw new Error("Invalid reference action");
  const digest = operationDigest(input.action, { ...input, approval_evidence: authority.approval_evidence });
  return withWrite(root, (db, root) => {
    const result = acceptOperation(db, authority, input.key, digest, () => {
      requireId(input.project_id);
      const rows = readRows(db, root); const item = rows.find(row => row.todo.id === input.project_id);
      if (!item) throw new Error("Project not found");
      if (item.todo.revision !== input.expected_revision) throw new Error("Stale project revision");
      let reference_id: string;
      if (input.action === "reference_add") {
        if ("id" in input.reference || "origin" in input.reference) throw new Error("Reference ID/origin are API generated");
        const ref = { ...input.reference, id: randomUUID() } as ContextReference; validateReference(ref);
        reference_id = ref.id; item.todo.context_refs.push(ref);
      } else {
        reason(input.change_note); requireId(input.reference_id); reference_id = input.reference_id;
        if (!item.todo.context_refs.some(ref => ref.id === reference_id)) throw new Error("Reference not found");
        item.todo.context_refs = item.todo.context_refs.filter(ref => ref.id !== reference_id);
      }
      validate(item.todo); validateReferences(rows);
      // Required current source material must exist at acceptance, not only at refresh.
      for (const ref of item.todo.context_refs) if (ref.kind === "artifact") {
        const source = rows.find(row => row.todo.id === ref.source_owner_id)!;
        const artifact = source.todo.artifacts.find(a => a.id === ref.artifact_id)!;
        if (artifact.lifecycle === "current" && artifact.required) artifactBytes(db, source.todo.id, artifact.path);
      }
      item.todo.revision++; item.todo.updated_at = new Date().toISOString(); updateOwner(db, item);
      return { id: item.todo.id, reference_id, accepted_revision: item.todo.revision };
    });
    const current = readRows(db, root).find(row => row.todo.id === result.id)!.todo.revision;
    return { ...result, ...(current !== result.accepted_revision ? { current_revision: current } : {}) };
  }, signal);
}
/** Adapter preflight can bypass another approval for an already accepted identical request. */
export function preflightOperation(root: string, action: string, args: Record<string, unknown>, authority: Authority, key: string) {
  return withRead(root, db => replay(db, authority.session_id, key, operationDigest(action, { ...args, approval_evidence: authority.approval_evidence })));
}
export type LinkListInput = { endpoint: Endpoint; direction?: "outgoing" | "incoming" | "both"; include_inactive?: boolean; limit?: number; cursor?: string };
function readTarget(kind: Endpoint["kind"], id: string) {
  return kind === "project" ? { tool: "context", action: "read", kind, selector: id } : { tool: "context", action: "read", kind, id };
}
function endpointSummary(db: DatabaseSync, kind: Endpoint["kind"], id: string) {
  if (kind === "project") {
    const row = db.prepare("SELECT document FROM owners WHERE id=?").get(id);
    if (!row) throw new Error("Missing project link endpoint");
    const project = validate(JSON.parse(String(row.document)));
    return { kind, id, title: project.title, status: project.status, revision: project.revision, read: readTarget(kind, id) };
  }
  const row = db.prepare("SELECT r.document FROM knowledge_entries e JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=e.current_revision WHERE e.id=?").get(id);
  if (!row) throw new Error("Missing knowledge link endpoint");
  const entry = JSON.parse(String(row.document));
  return { kind, id, title: entry.payload.title, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, revision: entry.revision, read: readTarget(kind, id) };
}
function linkSummary(db: DatabaseSync, link: Link) {
  return { ...link, from: endpointSummary(db, link.from_kind, link.from_id), to: endpointSummary(db, link.to_kind, link.to_id) };
}
function cursorPage<T>(rows: T[], input: { cursor?: string; limit?: number }, binding: string, key: (row: T) => string, max: number) {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new Error(`limit must be 1–${max}`);
  let after: string | undefined;
  if (input.cursor) {
    try { const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")); if (parsed.v !== 1 || parsed.binding !== binding || typeof parsed.after !== "string") throw new Error(); after = parsed.after; }
    catch { throw new Error("Cursor filters changed or invalid; restart without cursor"); }
  }
  const index = after === undefined ? -1 : rows.findIndex(row => key(row) === after);
  if (after !== undefined && index < 0) throw new Error("Cursor anchor removed; restart without cursor");
  const items = rows.slice(index + 1, index + 1 + limit);
  const next_cursor = index + 1 + items.length < rows.length ? Buffer.from(JSON.stringify({ v: 1, binding, after: key(items.at(-1)!) })).toString("base64url") : null;
  return { items, next_cursor };
}
function listLinksInRead(db: DatabaseSync, input: LinkListInput) {
  fields(input, ["endpoint", "direction", "include_inactive", "limit", "cursor"]);
  endpoint(db, input.endpoint);
  const direction = input.direction ?? "both"; const include_inactive = input.include_inactive ?? false;
  if (!["outgoing", "incoming", "both"].includes(direction) || typeof include_inactive !== "boolean") throw new Error("Invalid link list filters");
  const clauses = direction === "outgoing" ? ["from_kind=? AND from_id=?"] : direction === "incoming" ? ["to_kind=? AND to_id=?"] : ["from_kind=? AND from_id=?", "to_kind=? AND to_id=?"];
  const params = clauses.flatMap(() => [input.endpoint.kind, input.endpoint.id]);
  const rows = db.prepare(`SELECT id FROM context_links WHERE (${clauses.map(clause => `(${clause})`).join(" OR ")})${include_inactive ? "" : " AND active=1"} ORDER BY id`).all(...params).map(row => readLink(db, String(row.id)));
  const page = cursorPage(rows, input, operationDigest("link-list", { endpoint: input.endpoint, direction, include_inactive }), row => row.id, 20);
  return { ...page, items: page.items.map(link => linkSummary(db, link)) };
}
export function listLinks(root: string, input: LinkListInput) { return withRead(root, db => listLinksInRead(db, input)); }
export function linkHistory(root: string, input: { id: string; limit?: number; cursor?: string }) {
  fields(input, ["id", "limit", "cursor"]); requireId(input.id);
  return withRead(root, db => {
    readLink(db, input.id);
    const rows = db.prepare("SELECT document FROM context_link_revisions WHERE link_id=? ORDER BY revision DESC").all(input.id).map(row => JSON.parse(String(row.document)) as Link);
    const page = cursorPage(rows, input, operationDigest("link-history", { id: input.id }), row => String(row.revision), 50);
    return { ...page, items: page.items.map(link => ({ ...link, from: { kind: link.from_kind, id: link.from_id, read: readTarget(link.from_kind, link.from_id) }, to: { kind: link.to_kind, id: link.to_id, read: readTarget(link.to_kind, link.to_id) } })) };
  });
}
/** Compact discovery navigation: no eager endpoint documents or neighbor pages. */
export function projectLinkSummary(db: DatabaseSync, id: string) {
  const project = { kind: "project" as const, id };
  endpoint(db, project);
  const count = Number(db.prepare("SELECT count(*) AS count FROM context_links WHERE active=1 AND ((from_kind='project' AND from_id=?) OR (to_kind='project' AND to_id=?))").get(id, id)!.count);
  return { count, read: { tool: "context_link", action: "list", endpoint: project, direction: "both" } };
}
export function projectLinks(db: DatabaseSync, id: string) {
  return listLinksInRead(db, { endpoint: { kind: "project", id }, direction: "both", limit: 20 });
}
