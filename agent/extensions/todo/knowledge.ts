import { createHash } from "node:crypto";
import { excerpt } from "../lib/retrieval.ts";
import { readArtifact } from "./artifacts.ts";
import { recordTexts, recordTarget, artifactProvenance, type Provenance } from "./records.ts";
import { list, locate, type Located } from "./storage.ts";

export type KnowledgeInput = { query: string; selector?: string; view?: "active" | "full"; limit?: number; cursor?: string };
type Hit = Partial<Provenance> & {
  index?: number; match_field?: "body" | "metadata"; match_offset?: number;
  owner_id: string; owner_title: string; parent_id: string | null; owner_revision: number;
  source_kind: string; record_id?: string; artifact_id?: string; artifact_version?: string;
  lifecycle?: string; excerpt: string; read: Record<string, unknown>;
};
type Match = { key: string; historical: boolean; hit: Hit };
type Cursor = { v: 1; query: string; scope: string | null; view: string; after: string };

function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (cursor.v !== 1 || typeof cursor.query !== "string" || !(cursor.scope === null || typeof cursor.scope === "string") || !["active", "full"].includes(cursor.view) || typeof cursor.after !== "string") throw new Error();
    return cursor;
  } catch { throw new Error("Invalid knowledge cursor; restart search without cursor"); }
}

/** Search owned current records, not an inherited resume bundle or an archive of every revision. */
export async function searchKnowledge(root: string, input: KnowledgeInput, signal?: AbortSignal) {
  const query = input.query.trim().toLowerCase();
  if (!query) throw new Error("query must contain non-whitespace text");
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be between 1 and 20");
  const view = input.view ?? "active";
  signal?.throwIfAborted();
  const owner = input.selector ? await locate(root, input.selector) : undefined;
  const scope = owner?.todo.id ?? null;
  const queryKey = createHash("sha256").update(query).digest("hex");
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  if (cursor && (cursor.query !== queryKey || cursor.scope !== scope || cursor.view !== view)) throw new Error("Cursor query, scope or view changed; restart search");
  const rows = (await list(root)).filter(row => !owner || row.todo.id === scope || owner.todo.type === "project" && row.parent_id === scope);
  const matches: Match[] = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    await collect(row);
  }
  matches.sort((a, b) => Number(a.historical) - Number(b.historical) || a.key.localeCompare(b.key));
  const cursorIndex = cursor ? matches.findIndex(match => match.key === cursor.after) : -1;
  if (cursor && cursorIndex < 0) throw new Error("Knowledge cursor source changed; restart search");
  const start = cursorIndex + 1;
  const selected = matches.slice(start, start + limit);
  function response() {
    const last = selected.at(-1);
    return {
      results: selected.map(match => match.hit),
      next_cursor: last && start + selected.length < matches.length
        ? Buffer.from(JSON.stringify({ v: 1, query: queryKey, scope, view, after: last.key } satisfies Cursor)).toString("base64url") : null,
    };
  }
  // Keep the existing JSON tool display below its truncation boundary, including escaped strings/cursor.
  while (selected.length > 1 && JSON.stringify(response(), null, 2).length > 40000) selected.pop();
  return response();

  async function collect(row: Located) {
    const todo = row.todo;
    function add(key: string, source_kind: string, text: string, extra: Partial<Hit> & Pick<Hit, "read">, historical = false) {
      if (!text.toLowerCase().includes(query)) return;
      matches.push({ key: `${todo.id}/${key}`, historical, hit: {
        owner_id: todo.id, owner_title: todo.title, parent_id: row.parent_id ?? null, owner_revision: todo.revision,
        source_kind, excerpt: excerpt(text, query), ...extra,
      } });
    }
    for (const record of recordTexts(todo)) {
      if (view === "active" && !record.in_active_context) continue;
      const { text, ...metadata } = record;
      add(`${record.source_kind}/${record.index ?? record.record_id}`, record.source_kind, text, {
        ...metadata, read: recordTarget(todo, record, view, Math.max(0, text.toLowerCase().indexOf(query) - 80)),
      }, !record.in_active_context);
    }
    for (const artifact of todo.artifacts) {
      const provenance = artifactProvenance(todo, artifact);
      if (view === "active" && !provenance.in_active_context) continue;
      signal?.throwIfAborted();
      const body = await readArtifact(root, row, artifact.id);
      signal?.throwIfAborted();
      const bodyMatch = body.toLowerCase().indexOf(query);
      add(`artifact/${artifact.id}`, "artifact", [artifact.title, artifact.description, body].join("\n"), {
        artifact_id: artifact.id, artifact_version: artifact.path, lifecycle: artifact.lifecycle, ...provenance,
        match_field: bodyMatch >= 0 ? "body" : "metadata", ...(bodyMatch >= 0 ? { match_offset: bodyMatch } : {}),
        read: { tool: "todo_artifact", action: "read", id: todo.id, artifact_id: artifact.id, expected_version: artifact.path, offset: Math.max(0, bodyMatch - 80) },
      }, !provenance.in_active_context);
    }
  }
}
