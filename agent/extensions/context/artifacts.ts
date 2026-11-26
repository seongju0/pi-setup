import { createHash, randomUUID } from "node:crypto";
import { mutate, type Located } from "./storage.ts";
import { artifactBytes, withRead } from "./database.ts";
import { validate, type Artifact } from "./state.ts";
import { PAGE_CHARS, textPage } from "./internal/retrieval.ts";

export type ArtifactEdit = { start: string; end?: string; new_text: string };
export type ArtifactInput = Omit<Artifact, "id" | "path"> & { id?: string; body?: string; body_edits?: ArtifactEdit[]; expected_version?: string };

type Line = { start: number; end: number; ending: string; text: string; hash: string };
function sourceLines(bytes: Uint8Array) {
  let body: string;
  try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("Line reads and edits require valid UTF-8 source; use legacy character/full-body maintenance"); }
  const lines: Line[] = [];
  for (let start = 0; start < body.length;) {
    const lf = body.indexOf("\n", start);
    const end = lf < 0 ? body.length : lf + 1;
    const span = body.slice(start, end);
    const ending = span.endsWith("\r\n") ? "\r\n" : span.endsWith("\n") ? "\n" : "";
    lines.push({ start, end, ending, text: span.slice(0, span.length - ending.length), hash: createHash("sha256").update(span, "utf8").digest("hex").slice(0, 16) });
    start = end;
  }
  return { body, lines };
}
function anchor(value: unknown) {
  if (typeof value !== "string" || !/^[1-9][0-9]*:[a-f0-9]{16}$/.test(value)) throw new Error("Anchor must be a positive safe line number:16 lowercase hex digits");
  const [number, hash] = value.split(":"); const line = Number(number);
  if (!Number.isSafeInteger(line)) throw new Error("Anchor line must be a positive safe integer");
  return { line, hash };
}
function validateEdits(input: ArtifactInput) {
  if (input.body !== undefined) throw new Error("body and body_edits cannot be combined");
  if (typeof input.id !== "string" || !input.id || typeof input.expected_version !== "string" || !input.expected_version.trim()) throw new Error("body_edits requires existing artifact id and expected_version");
  if (!Array.isArray(input.body_edits) || input.body_edits.length < 1 || input.body_edits.length > 20) throw new Error("body_edits must contain 1–20 edits");
  for (const edit of input.body_edits) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit) || Object.keys(edit).some(key => !["start", "end", "new_text"].includes(key))) throw new Error("Invalid body_edits object keys");
    anchor(edit.start); if (edit.end !== undefined) anchor(edit.end);
    if (typeof edit.new_text !== "string" || edit.new_text.length > 100000) throw new Error("new_text must be a string of at most 100000 characters (empty deletes)");
  }
}
function editBody(bytes: Uint8Array, edits: ArtifactEdit[]) {
  const { body, lines } = sourceLines(bytes);
  const ranges = edits.map(edit => {
    const start = anchor(edit.start), end = anchor(edit.end ?? edit.start);
    if (end.line < start.line || !lines[start.line - 1] || !lines[end.line - 1]) throw new Error("Anchor range is reversed or outside the source");
    const first = lines[start.line - 1], last = lines[end.line - 1];
    if (first.hash !== start.hash || last.hash !== end.hash) throw new Error("Anchor hash mismatch; read the pinned source again");
    const text = edit.new_text + (edit.new_text && last.ending && !edit.new_text.endsWith("\n") ? last.ending : "");
    return { start: first.start, end: last.end, text };
  }).sort((a, b) => a.start - b.start);
  let cursor = 0, result = "";
  for (const range of ranges) {
    if (range.start < cursor) throw new Error("body_edits ranges overlap");
    result += body.slice(cursor, range.start) + range.text; cursor = range.end;
  }
  result += body.slice(cursor);
  if (!result.trim() || result.length - (result.endsWith("\n") ? 1 : 0) > 100000) throw new Error("Edited artifact body must contain 1–100000 characters excluding one final LF");
  return result;
}

export async function readArtifactLines(root: string, item: Located, artifactId: string, input: { start_line?: number; end_line?: number; expected_version?: string; offset?: number; limit?: number; body_edits?: ArtifactEdit[] }) {
  const { start_line: start, end_line: end, expected_version: version } = input;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1 || typeof end !== "number" || !Number.isSafeInteger(end) || end < start) throw new Error("start_line and end_line must be positive safe integers in forward order");
  if (input.offset !== undefined || input.limit !== undefined || input.body_edits !== undefined) throw new Error("Line reads cannot combine character paging or body_edits");
  if (typeof version !== "string" || !version.trim()) throw new Error("Every line read requires expected_version");
  const artifact = item.todo.artifacts.find(row => row.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (version !== artifact.path) throw new Error("Artifact changed; obtain the current version and read again");
  const { lines } = withRead(root, db => sourceLines(artifactBytes(db, item.todo.id, artifact.path)));
  if (start > lines.length) throw new Error("start_line is past the end");
  const stop = Math.min(end, lines.length);
  let body = "", last = start - 1;
  for (let n = start; n <= stop; n++) {
    const line = lines[n - 1], rendered = `${n}:${line.hash}|${line.text}\n`;
    if (body.length + rendered.length > PAGE_CHARS) {
      if (!body) throw new Error("Annotated line exceeds 12000 characters; use existing character paging/full-body maintenance");
      break;
    }
    body += rendered; last = n;
  }
  return { id: item.todo.id, artifact_id: artifactId, version: artifact.path, start_line: start, end_line: last, next_line: last < stop ? last + 1 : null, total_lines: lines.length, body };
}
export async function saveArtifact(root: string, id: string, revision: number, input: ArtifactInput, signal?: AbortSignal): Promise<Located> {
  if ((input as any).start_line !== undefined || (input as any).end_line !== undefined) throw new Error("Line read fields are not valid on upsert");
  if (input.body_edits !== undefined) validateEdits(input);
  if (!["research", "design"].includes(input.kind)) throw new Error("Artifact kind must be research or design");
  return mutate(root, id, revision, (todo, item, context) => {
    const existing = todo.artifacts.find(row => row.id === input.id);
    if (input.id && !existing) throw new Error("Artifact ID not found; omit id to create");
    if (!existing && input.body === undefined) throw new Error("New artifacts require a Markdown body");
    if (input.body !== undefined && (!input.body.trim() || input.body.length > 100000)) throw new Error("Artifact body must contain 1–100000 characters");
    if (!existing && input.applies_to.length || existing && JSON.stringify(input.applies_to) !== JSON.stringify(existing.applies_to)) throw new Error("applies_to is retired; preserve imported provenance and edit explicit consumer context references");
    if (input.body_edits !== undefined && input.expected_version !== existing!.path) throw new Error("Artifact changed; obtain the current version and read again");
    const edited = input.body_edits !== undefined ? editBody(context.readArtifact(existing!.path), input.body_edits) : undefined;
    const bodyChanged = input.body !== undefined || input.body_edits !== undefined;
    const artifactId = existing?.id ?? randomUUID();
    const path = bodyChanged ? `artifacts/${artifactId}-${todo.revision + 1}.md` : existing!.path;
    const { body, body_edits, expected_version, ...metadata } = input;
    const artifact: Artifact = { ...metadata, id: artifactId, path };
    const index = todo.artifacts.findIndex(row => row.id === artifactId);
    if (index < 0) {
      todo.artifacts.push(artifact);
      todo.context_refs.push({ id: randomUUID(), kind: "artifact", source_owner_id: todo.id, artifact_id: artifactId, follow: "current", requirement: "source", reason: "Owner artifact" });
    } else todo.artifacts[index] = artifact;
    if (todo.context_policy && (bodyChanged || artifact.required)) todo.context_policy.consult_on_demand_artifacts = todo.context_policy.consult_on_demand_artifacts.filter(hidden => hidden !== artifactId);
    validate(todo);
    if (bodyChanged) context.writeArtifact(path, Buffer.from(edited ?? `${body!.trim()}\n`));
    return todo;
  }, signal, true);
}
export async function readArtifactPage(root: string, item: Located, artifactId: string, offset = 0, limit = PAGE_CHARS, expectedVersion?: string) {
  const artifact = item.todo.artifacts.find(row => row.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (offset > 0 && !expectedVersion) throw new Error("Continuation requires expected_version from the first page");
  if (expectedVersion !== undefined && expectedVersion !== artifact.path) throw new Error("Artifact changed; restart at offset 0 without expected_version");
  const { text, ...page } = textPage(await readArtifact(root, item, artifactId), offset, limit);
  return { id: item.todo.id, artifact_id: artifactId, version: artifact.path, body: text, ...page };
}

export async function readArtifact(root: string, item: Located, artifactId: string): Promise<string> {
  const artifact = item.todo.artifacts.find(row => row.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  return withRead(root, db => artifactBytes(db, item.todo.id, artifact.path).toString("utf8"));
}
