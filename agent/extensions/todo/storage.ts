import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { applyChanges, createTodo, rejectRetiredCurrentState, validate, type Changes, type Todo } from "./state.ts";
import { effects, validateGraph, validateTransition } from "./dependencies.ts";
import { canonicalRoot, decodeOwner, insertOwner, locator, readRows, synchronous, updateOwner, withRead, withWrite } from "./database.ts";

/** directory is a deprecated legacy locator, not a physical document directory. */
export type Located = { directory: string; todo: Todo; parent_id?: string };
export function configuredRoot(): string { return resolve(process.env.PI_TODO_PATH?.trim() || join(homedir(), ".pi", "agent", "todos")); }
export async function rootPath(root: string): Promise<string> { return canonicalRoot(root); }
export async function readKnown(root: string, item: Located): Promise<Located> {
  return withRead(root, (db, root) => {
    const row = db.prepare("SELECT id,parent_id,document FROM owners WHERE id=?").get(item.todo.id);
    if (!row) throw new Error(`Todo not found: ${item.todo.id}`);
    return decodeOwner(root, row);
  });
}
export async function list(root: string): Promise<Located[]> { return withRead(root, readRows); }
function select(rows: Located[], selector: string): Located {
  const exact = rows.filter(row => row.todo.id === selector || row.todo.title === selector || row.todo.linear?.url === selector);
  const candidates = exact.length ? exact : rows.filter(row => row.todo.id.startsWith(selector));
  if (candidates.length !== 1) throw new Error(candidates.length ? "Ambiguous todo selector; use the full ID" : `Todo not found: ${selector}`);
  return candidates[0];
}
export async function locate(root: string, selector: string): Promise<Located> { return withRead(root, (db, root) => select(readRows(db, root), selector)); }
export async function create(root: string, type: Todo["type"], title: string, outcome: string, parent?: string, signal?: AbortSignal, depends_on: string[] = []) {
  return withWrite(root, (db, root) => {
    const todo = createTodo(type, title, outcome); const rows = readRows(db, root); let parent_id: string | undefined;
    if (parent) {
      const p = select(rows, parent);
      if (p.todo.type !== "project" || p.parent_id || type !== "simple") throw new Error("Only root projects can hold simple todos");
      parent_id = p.todo.id;
    }
    todo.depends_on = depends_on; validate(todo);
    const item = { todo, parent_id, directory: locator(root, todo.id, parent_id) };
    rows.push(item); validateGraph(rows); insertOwner(db, todo, parent_id); return effects(rows, item);
  }, signal);
}
function saveUpdate(db: DatabaseSync, rows: Located[], item: Located, activity: boolean) {
  updateOwner(db, item);
  const parent = activity ? rows.find(row => row.todo.id === item.parent_id) : undefined;
  let updated_parent: Pick<Todo, "id" | "revision" | "status"> | undefined;
  if (parent?.todo.status === "todo") {
    parent.todo = { ...parent.todo, status: "in_progress", revision: parent.todo.revision + 1, updated_at: item.todo.updated_at };
    updateOwner(db, parent);
    updated_parent = { id: parent.todo.id, revision: parent.todo.revision, status: parent.todo.status };
  }
  return { ...effects(rows, item), updated_parent };
}
export type MutationContext = { rows: Located[]; writeArtifact: (version: string, bytes: Uint8Array) => void };
export async function mutate(root: string, id: string, revision: number, transform: (todo: Todo, item: Located, context: MutationContext) => Todo, signal?: AbortSignal, activity = false) {
  return withWrite(root, (db, root) => {
    const rows = readRows(db, root); const item = select(rows, id);
    if (item.todo.revision !== revision) throw new Error(`Stale revision: expected ${revision}, current ${item.todo.revision}. Read again before retrying.`);
    const proposed = synchronous(transform(structuredClone(item.todo), item, { rows, writeArtifact: (version, bytes) => { db.prepare("INSERT INTO artifact_revisions(owner_id,version,body) VALUES(?,?,?)").run(item.todo.id, version, bytes); } }));
    if ("blockers" in proposed || (proposed.status as string) === "blocked") throw new Error("Use depends_on instead of legacy blockers/blocked status");
    const next = validate(proposed);
    if (activity && next.status === "todo") next.status = "in_progress";
    if (next.id !== item.todo.id || next.type !== item.todo.type) throw new Error("Cannot change identity/type");
    const updated = { ...item, todo: next }; const nextRows = rows.map(row => row.todo.id === item.todo.id ? updated : row);
    validateTransition(item, updated, nextRows);
    next.revision++; next.updated_at = new Date().toISOString();
    return saveUpdate(db, nextRows, updated, activity);
  }, signal);
}
export function digest(changes: Changes): string { return createHash("sha256").update(JSON.stringify(changes)).digest("hex"); }
export async function checkpoint(root: string, id: string, revision: number, changes: Changes, key: string, session_id: string, signal?: AbortSignal) {
  rejectRetiredCurrentState(changes);
  return withWrite(root, (db, root) => {
    const rows = readRows(db, root); const item = select(rows, id); const hash = digest(changes);
    if (item.todo.last_checkpoint?.key === key) {
      if (item.todo.last_checkpoint.digest !== hash || item.todo.last_checkpoint.session_id !== session_id) throw new Error("Checkpoint key reused with different content/owner");
      return effects(rows, item);
    }
    if (item.todo.revision !== revision) throw new Error("Stale revision; read the todo before checkpointing");
    const next = applyChanges(item.todo, changes); const now = new Date().toISOString();
    const activity = Object.keys(changes).some(key => !["status", "approval_evidence"].includes(key)) || changes.status === "in_progress" || changes.status === "done";
    if (activity && changes.status === undefined && next.status === "todo") next.status = "in_progress";
    const updated = { ...item, todo: next }; const nextRows = rows.map(row => row.todo.id === item.todo.id ? updated : row);
    validateTransition(item, updated, nextRows, changes.status !== undefined);
    next.revision++; next.updated_at = now; next.last_checkpoint = { key, digest: hash, session_id, at: now, base_revision: item.todo.revision }; validate(next);
    return saveUpdate(db, nextRows, updated, activity);
  }, signal);
}
