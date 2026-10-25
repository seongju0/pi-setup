import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { applyChanges, createTodo, requireId, validate, type Changes, type Todo } from "./state.ts";

import { effects, validateGraph, validateTransition } from "./dependencies.ts";

export type Located = { directory: string; todo: Todo; parent_id?: string };
export function configuredRoot(): string { return resolve(process.env.PI_TODO_PATH?.trim() || join(homedir(), ".pi", "agent", "todos")); }
export async function rootPath(root: string): Promise<string> { await mkdir(root, { recursive: true, mode: 0o700 }); return realpath(root); }
export async function safePath(root: string, relative: string): Promise<string> {
  const parts = relative.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes("\\")) || relative.startsWith("/")) throw new Error("Unsafe todo path");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlinks are not allowed inside todo storage: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return current;
}
export async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function readLocated(root: string, relative: string, parent_id?: string): Promise<Located> {
  const directory = await safePath(root, relative);
  const file = await safePath(root, `${relative}/todo.json`);
  try {
    const todo = validate(JSON.parse(await readFile(file, "utf8")));
    if (todo.id !== relative.split("/").at(-1)) throw new Error("Directory ID mismatch");
    if (parent_id && todo.type !== "simple") throw new Error("Nested projects are not supported");
    return { directory, todo, parent_id };
  } catch (error) { throw new Error(`Cannot read ${file}: ${(error as Error).message}`); }
}
export async function readKnown(root: string, item: Located): Promise<Located> {
  root = await rootPath(root);
  return readLocated(root, relative(root, item.directory), item.parent_id);
}
export async function list(root: string): Promise<Located[]> {
  root = await rootPath(root); const rows: Located[] = [];
  for (const entry of await readdir(root)) {
    if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
    const item = await readLocated(root, entry); rows.push(item);
    const children = await safePath(root, `${entry}/todos`);
    let entries: string[];
    try { entries = await readdir(children); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (item.todo.type !== "project" && entries.length) throw new Error("Simple todo cannot contain children");
    for (const child of entries) {
      if (/^[a-f0-9-]{36}\.creating$/.test(child)) continue; // Interrupted creates are unpublished and safe to inspect/remove.
      requireId(child); rows.push(await readLocated(root, `${entry}/todos/${child}`, entry));
    }
  }
  if (new Set(rows.map(row => row.todo.id)).size !== rows.length) throw new Error("Duplicate todo IDs");
  validateGraph(rows);
  return rows;
}
export async function locate(root: string, selector: string): Promise<Located> {
  const rows = await list(root);
  const exact = rows.filter(row => row.todo.id === selector || row.todo.title === selector || row.todo.linear?.url === selector);
  const candidates = exact.length ? exact : rows.filter(row => row.todo.id.startsWith(selector));
  if (candidates.length !== 1) throw new Error(candidates.length ? "Ambiguous todo selector; use the full ID" : `Todo not found: ${selector}`);
  return candidates[0];
}
export async function withStoreLock<T>(root: string, operation: (canonical: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  root = await rootPath(root); signal?.throwIfAborted();
  const lock = join(root, ".write-lock");
  // ponytail: one short global write lock. Use per-item locks if actual contention warrants it.
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Todo store is busy. Retry; after a crash verify the owner in ${lock}/owner.json before removing the lock.`); throw error; }
  try {
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
    signal?.throwIfAborted(); return await operation(root);
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export async function create(root: string, type: Todo["type"], title: string, outcome: string, parent?: string, signal?: AbortSignal, depends_on: string[] = []) {
  return withStoreLock(root, async root => {
    const todo = createTodo(type, title, outcome);
    let relative = todo.id; let parent_id: string | undefined;
    if (parent) {
      const p = await locate(root, parent);
      if (p.todo.type !== "project" || p.parent_id || type !== "simple") throw new Error("Only root projects can hold simple todos");
      parent_id = p.todo.id; relative = `${parent_id}/todos/${todo.id}`;
    }
    todo.depends_on = depends_on; validate(todo);
    const directory = await safePath(root, relative);
    const rows = [...await list(root), { directory, todo, parent_id }]; validateGraph(rows);
    const staging = await safePath(root, `${relative}.creating`);
    // Incomplete creates are never visible to directory scans.
    await mkdir(staging, { recursive: true, mode: 0o700 });
    try { await writeFile(join(staging, "todo.json"), `${JSON.stringify(todo, null, 2)}\n`, { mode: 0o600 }); signal?.throwIfAborted(); await rename(staging, directory); }
    finally { await rm(staging, { recursive: true, force: true }); }
    return effects(rows, { directory, todo, parent_id });
  }, signal);
}
// Both manifests are written under the caller's existing store lock; parent progress is not a rollup of children.
async function saveUpdate(rows: Located[], item: Located, activity: boolean) {
  await atomicWrite(join(item.directory, "todo.json"), `${JSON.stringify(item.todo, null, 2)}\n`);
  const parent = activity ? rows.find(row => row.todo.id === item.parent_id) : undefined;
  let updated_parent: Pick<Todo, "id" | "revision" | "status"> | undefined;
  if (parent?.todo.status === "todo") {
    parent.todo = { ...parent.todo, status: "in_progress", revision: parent.todo.revision + 1, updated_at: item.todo.updated_at };
    await atomicWrite(join(parent.directory, "todo.json"), `${JSON.stringify(parent.todo, null, 2)}\n`);
    updated_parent = { id: parent.todo.id, revision: parent.todo.revision, status: parent.todo.status };
  }
  return { ...effects(rows, item), updated_parent };
}
export async function mutate(root: string, id: string, revision: number, transform: (todo: Todo, item: Located) => Promise<Todo> | Todo, signal?: AbortSignal, activity = false) {
  return withStoreLock(root, async root => {
    const item = await locate(root, id);
    if (item.todo.revision !== revision) throw new Error(`Stale revision: expected ${revision}, current ${item.todo.revision}. Read again before retrying.`);
    const proposed = await transform(structuredClone(item.todo), item);
    if ("blockers" in proposed || (proposed.status as string) === "blocked") throw new Error("Use depends_on instead of legacy blockers/blocked status");
    const next = validate(proposed);
    if (activity && next.status === "todo") next.status = "in_progress";
    if (next.id !== item.todo.id || next.type !== item.todo.type) throw new Error("Cannot change identity/type");
    const updated = { ...item, todo: next };
    const rows = (await list(root)).map(row => row.todo.id === id ? updated : row);
    validateTransition(item, updated, rows);
    next.revision++; next.updated_at = new Date().toISOString();
    signal?.throwIfAborted();
    return saveUpdate(rows, updated, activity);
  }, signal);
}
export function digest(changes: Changes): string { return createHash("sha256").update(JSON.stringify(changes)).digest("hex"); }
export async function checkpoint(root: string, id: string, revision: number, changes: Changes, key: string, session_id: string, signal?: AbortSignal) {
  // Check the retry key while locked, before revision checking: a successful retry has an old revision.
  return withStoreLock(root, async root => {
    const item = await locate(root, id); const hash = digest(changes);
    if (item.todo.last_checkpoint?.key === key) {
      if (item.todo.last_checkpoint.digest !== hash || item.todo.last_checkpoint.session_id !== session_id) throw new Error("Checkpoint key reused with different content/owner");
      return effects(await list(root), item);
    }
    if (item.todo.revision !== revision) throw new Error("Stale revision; read the todo before checkpointing");
    const next = applyChanges(item.todo, changes); const now = new Date().toISOString();
    const activity = Object.keys(changes).some(key => !["status", "approval_evidence"].includes(key)) || changes.status === "in_progress" || changes.status === "done";
    if (activity && changes.status === undefined && next.status === "todo") next.status = "in_progress";
    const updated = { ...item, todo: next };
    const rows = (await list(root)).map(row => row.todo.id === id ? updated : row);
    validateTransition(item, updated, rows, changes.status !== undefined);
    next.revision++; next.updated_at = now; next.last_checkpoint = { key, digest: hash, session_id, at: now }; validate(next);
    signal?.throwIfAborted();
    return saveUpdate(rows, updated, activity);
  }, signal);
}
