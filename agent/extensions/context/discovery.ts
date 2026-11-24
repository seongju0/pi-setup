import { withRead } from "./database.ts";
import { list, locate } from "./storage.ts";
import { effects } from "./dependencies.ts";
import { compact } from "./session.ts";
import { discoverySummary } from "./search.ts";
import { collectKnowledgeMatches } from "./knowledge.ts";
import { excerpt } from "./internal/retrieval.ts";
import { currentKnowledge, knowledgePage, readKnowledge, renderKnowledgeCore, validateKnowledgeId, validateKnowledgeRead, type KnowledgeEntry, type KnowledgeReadInput } from "./library.ts";
import { operationDigest } from "./operations.ts";

export type ContextInput =
  | { action: "status" | "refresh" | "detach" }
  | { action: "attach"; selector: string }
  | { action: "list"; kind?: "project" | "knowledge" | "all"; include_closed?: boolean; limit?: number; cursor?: string }
  | { action: "search"; query: string; kind?: "project" | "knowledge" | "all"; scope_project_id?: string; view?: "active" | "full"; limit?: number; cursor?: string }
  | { action: "read"; kind: "project"; selector: string; view?: "active" | "full" }
  | (KnowledgeReadInput & { action: "read"; kind: "knowledge" });
type Input = Record<string, any>;
function object(input: unknown, allowed: string[]): asserts input is Input {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid or forbidden context fields");
}
function text(value: unknown, max: number, name: string) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must contain 1–${max} characters`); }
function limit(value: unknown, max: number) { if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)) throw new Error(`limit must be 1–${max}`); }
/** Shared public facade validation, including adapter-owned session actions. No reads or UI. */
export function validateContextInput(input: unknown): asserts input is ContextInput {
  object(input, ["action", "kind", "include_closed", "limit", "cursor", "query", "scope_project_id", "view", "selector", "id", "section", "revision", "offset", "expected_version"]);
  if (input.action === "read" && !["project", "knowledge"].includes(input.kind)) throw new Error('Read requires kind: "project" with selector, or kind: "knowledge" with id');
  if (input.action === "read" && input.kind === "project" && Object.hasOwn(input, "id")) throw new Error('Project read requires kind: "project" and selector; id is forbidden (use selector instead)');
  const actions: Record<string, string[]> = { status: [], list: ["kind", "include_closed", "limit", "cursor"], search: ["query", "kind", "scope_project_id", "view", "limit", "cursor"], read: input.kind === "project" ? ["kind", "selector", "view"] : ["kind", "id", "section", "revision", "offset", "limit", "expected_version"], attach: ["selector"], refresh: [], detach: [] };
  if (!actions[input.action]) throw new Error("Invalid context action");
  object(input, ["action", ...actions[input.action]]);
  if (["list", "search"].includes(input.action)) {
    if (input.kind !== undefined && !["project", "knowledge", "all"].includes(input.kind)) throw new Error("Invalid entity kind");
    limit(input.limit, input.action === "list" ? 50 : 20);
    if (input.cursor !== undefined) text(input.cursor, 10000, "cursor");
  }
  if (input.action === "list" && input.include_closed !== undefined && typeof input.include_closed !== "boolean") throw new Error("include_closed must be boolean");
  if (input.action === "search") { text(input.query, 2000, "query"); if (input.scope_project_id !== undefined) validateKnowledgeId(input.scope_project_id); }
  if (input.view !== undefined && !["active", "full"].includes(input.view)) throw new Error("Invalid view");
  if (input.action === "attach" || input.action === "read" && input.kind === "project") text(input.selector, 2000, "selector");
  if (input.action === "read") {
    if (input.kind === "knowledge") validateKnowledgeRead(input);
  }
}
function kbSummary(entry: KnowledgeEntry) {
  return { kind: "knowledge" as const, id: entry.id, title: entry.payload.title, summary: entry.payload.summary, scope: entry.payload.scope, revision: entry.revision, lifecycle: entry.lifecycle, replacement_id: entry.replacement_id, read: { tool: "context", action: "read", kind: "knowledge", id: entry.id } };
}
function entries(root: string): KnowledgeEntry[] {
  return withRead(root, db => db.prepare("SELECT id FROM knowledge_entries ORDER BY id").all().map(row => currentKnowledge(db, String(row.id))));
}
/** Domain discovery never attaches, starts, refreshes or observes project session bookkeeping. */
export async function contextOperation(root: string, input: unknown) {
  validateContextInput(input);
  if (input.action === "read") {
    if (input.kind === "knowledge") return readKnowledge(root, input);
    const item = await locate(root, input.selector);
    const full = effects(await list(root), item);
    return (input.view ?? "active") === "active" ? { ...full, todo: compact(item.todo) } : full;
  }
  if (input.action !== "list" && input.action !== "search") throw new Error("Session actions belong to the Context adapter");
  const rows = await list(root);
  const titles = new Map(rows.map(row => [row.todo.id, row.todo.title]));
  const projectSummary = (row: typeof rows[number]) => ({ kind: "project" as const, ...discoverySummary(row, titles), read: { tool: "context", action: "read", kind: "project", selector: row.todo.id } });
  const kind = input.kind ?? (input.action === "list" ? "project" : "all");
  if (input.action === "list") {
    const include_closed = input.include_closed ?? false;
    const items = [
      ...(kind !== "knowledge" ? rows.filter(row => include_closed || !["done", "canceled"].includes(row.todo.status)).map(projectSummary).sort((a, b) => a.id.localeCompare(b.id)) : []),
      ...(kind !== "project" ? entries(root).filter(entry => include_closed || entry.lifecycle === "current").map(kbSummary) : []),
    ];
    return knowledgePage(items, input, operationDigest("context-list", { kind, include_closed, limit: input.limit ?? 20 }), row => `${row.kind}/${row.id}`, 50);
  }
  const query = input.query.trim().toLowerCase();
  const view = input.view ?? "active";
  const scopeRows = input.scope_project_id === undefined ? [] : rows.filter(row => row.todo.id.startsWith(input.scope_project_id!));
  if (input.scope_project_id !== undefined && scopeRows.length !== 1) throw new Error("Project scope missing or ambiguous; use a full project UUID");
  const scope = scopeRows[0];
  const sourceIds = new Set(scope ? [scope.todo.id, ...scope.todo.context_refs.filter(ref => ref.kind === "project-grounding").map(ref => ref.source_project_id)] : rows.map(row => row.todo.id));
  type Match = { rank: number; historical: boolean; kind: "project" | "knowledge"; id: string; source: string; hit: Input };
  const matches: Match[] = [];
  if (kind !== "knowledge") {
    for (const row of rows.filter(row => sourceIds.has(row.todo.id))) {
      const title = row.todo.title.toLowerCase(), outcome = row.todo.outcome.toLowerCase();
      const rank = title === query ? 0 : title.includes(query) ? 1 : outcome.includes(query) ? 2 : -1;
      if (rank < 0) continue;
      const source = rank < 2 ? "title" : "outcome";
      matches.push({ rank, historical: false, kind: "project", id: row.todo.id, source, hit: { ...projectSummary(row), source_kind: source, excerpt: excerpt(source === "title" ? row.todo.title : row.todo.outcome, query, 398), in_active_context: true, inactive_reasons: [] } });
    }
    // Retain the existing record/artifact literal search and its real positioned, pinned targets.
    const projectMatches = await collectKnowledgeMatches(root, { query, view, owner: scope });
    for (const { hit } of projectMatches) {
      const row = rows.find(row => row.todo.id === hit.owner_id);
      if (!row) throw new Error("Project source changed; restart search");
      const source = `${hit.source_kind}/${hit.record_id ?? hit.artifact_id ?? hit.index ?? ""}`;
      matches.push({ rank: 3, historical: hit.in_active_context === false, kind: "project", id: row.todo.id, source, hit: { ...projectSummary(row), ...hit } });
    }
  }
  if (kind !== "project") {
    const linkedIds = scope ? withRead(root, db => new Set(db.prepare("SELECT from_kind,from_id,to_kind,to_id FROM context_links WHERE active=1 AND ((from_kind='project' AND from_id=?) OR (to_kind='project' AND to_id=?))").all(scope.todo.id, scope.todo.id).flatMap(link => link.from_kind === "knowledge" ? [String(link.from_id)] : link.to_kind === "knowledge" ? [String(link.to_id)] : []))) : undefined;
    for (const entry of entries(root)) {
      if (linkedIds && !linkedIds.has(entry.id) || view === "active" && entry.lifecycle !== "current") continue;
      const p = entry.payload;
      const candidates = [
        { source: "title", text: p.title, rank: p.title.toLowerCase() === query ? 0 : 1 },
        ...["summary", "scope"].map(source => ({ source, text: p[source as "summary" | "scope"], rank: 2 })),
        { source: "explanation", text: p.explanation, rank: 3 }, { source: "limits", text: p.limits, rank: 3 },
        ...p.sources.flatMap(source => ["citation", "note", "verified_at"].map(field => ({ source: `source/${source.id}/${field}`, text: source[field as "citation" | "note" | "verified_at"] ?? "", rank: 3 }))),
      ].filter(c => c.text.toLowerCase().includes(query)).sort((a, b) => a.rank - b.rank || a.source.localeCompare(b.source));
      const best = candidates[0]; if (!best) continue;
      // Find the match in the actual canonical body, not a synthetic field concatenation.
      const content = readKnowledge(root, { id: entry.id, section: "content", limit: 1 });
      const core = renderMatchOffset(entry, best.source, best.text, query);
      matches.push({ rank: best.rank, historical: entry.lifecycle !== "current", kind: "knowledge", id: entry.id, source: best.source, hit: { ...kbSummary(entry), source_kind: best.source, excerpt: excerpt(best.text, query, 398), in_active_context: entry.lifecycle === "current", inactive_reasons: entry.lifecycle === "current" ? [] : ["superseded"], provenance: entry.provenance, read: { tool: "context", action: "read", kind: "knowledge", id: entry.id, section: "content", offset: Math.max(0, core - 80), expected_version: content.version } } });
    }
  }
  matches.sort((a, b) => Number(a.historical) - Number(b.historical) || a.rank - b.rank || Number(a.kind === "knowledge") - Number(b.kind === "knowledge") || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
  const seen = new Set<string>();
  const best = matches.filter(row => { const key = `${row.kind}/${row.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const binding = operationDigest("context-search", { query, kind, view, scope_project_id: scope?.todo.id ?? null, limit: input.limit ?? 10 });
  const page = knowledgePage(best, input, binding, row => `${Number(row.historical)}/${row.rank}/${row.kind}/${row.id}/${row.source}`, 20, 10);
  return { results: page.items.map(row => row.hit), next_cursor: page.next_cursor };
}
function renderMatchOffset(entry: KnowledgeEntry, source: string, text: string, query: string) {
  const core = renderKnowledgeCore(entry);
  const sourceId = source.startsWith("source/") ? source.split("/")[1] : undefined;
  const from = sourceId ? core.indexOf(`- [${sourceId}]`) : 0;
  const textStart = core.indexOf(text, from);
  return Math.max(0, textStart) + text.toLowerCase().indexOf(query);
}
