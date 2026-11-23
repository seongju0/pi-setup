import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { requireId, validate } from "./legacy-state.ts";
import { validateGraph } from "./legacy-dependencies.ts";
export type Located = { directory: string; todo: import("./legacy-state.ts").Todo; parent_id?: string };
async function rootPath(root: string) { return realpath(root); }
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
export async function legacyRows(root: string): Promise<Located[]> {
  root = await rootPath(root); const rows: Located[] = [];
  for (const entry of await readdir(root)) {
    if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
    const item = await readLocated(root, entry); rows.push(item);
    const children = await safePath(root, `${entry}/todos`);
    let entries: string[];
    try { entries = await readdir(children); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const child of entries) {
      if (/^[a-f0-9-]{36}\.creating$/.test(child) || child.endsWith(".tmp")) continue; // Unpublished debris is inventoried/backed up, never task data.
      if (item.todo.type !== "project") throw new Error("Simple todo cannot contain children");
      requireId(child); rows.push(await readLocated(root, `${entry}/todos/${child}`, entry));
    }
  }
  if (new Set(rows.map(row => row.todo.id)).size !== rows.length) throw new Error("Duplicate todo IDs");
  validateGraph(rows);
  return rows;
}
