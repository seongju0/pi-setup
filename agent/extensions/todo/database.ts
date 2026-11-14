import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { validate, type Todo } from "./state.ts";
import { validateGraph } from "./dependencies.ts";
import type { Located } from "./storage.ts";

export const application = "pi-todo";
export const schema = `
CREATE TABLE owners(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES owners(id) DEFERRABLE INITIALLY DEFERRED, document TEXT NOT NULL CHECK(json_valid(document)) CHECK(json_extract(document,'$.id')=id) CHECK(json_extract(document,'$.version')=2));
CREATE INDEX owners_parent ON owners(parent_id);
CREATE TABLE artifact_revisions(owner_id TEXT NOT NULL REFERENCES owners(id), version TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(owner_id,version));
CREATE TABLE retained_legacy_files(owner_id TEXT NOT NULL REFERENCES owners(id), relative_path TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(owner_id,relative_path));
CREATE TABLE store_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
export function canonicalRoot(root: string): string { mkdirSync(root, { recursive: true, mode: 0o700 }); return realpathSync(root); }
export function privateDatabase(root: string): string {
  const file = join(root, "todo.sqlite");
  try { closeSync(openSync(file, "wx", 0o600)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe todo database: ${file}`);
  return file;
}
function version(db: DatabaseSync): number { return Number(db.prepare("PRAGMA user_version").get()!.user_version); }
function objects(db: DatabaseSync): string[] { return db.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => String(row.name)); }
export function validateDatabase(db: DatabaseSync) {
  if (version(db) !== 1 || JSON.stringify(objects(db)) !== JSON.stringify(["artifact_revisions", "owners", "owners_parent", "retained_legacy_files", "store_metadata"])) throw new Error("Unsupported todo database schema; do not reset or fall back to JSON");
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, " ");
  const expected = schema.split(";").map(normalize).filter(Boolean).sort();
  const actual = db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all().map(row => normalize(String(row.sql))).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unsupported todo database schema objects");
  if (db.prepare("SELECT value FROM store_metadata WHERE key='application'").get()?.value !== application) throw new Error("Not a supported todo database");
  if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "wal") throw new Error("Unsupported todo database journal mode; expected WAL");
}
function freshGuard(root: string) {
  if (readdirSync(root).some(name => /^[a-f0-9-]{36}(\.creating)?$/.test(name) || name === ".write-lock" || name.startsWith(".todo-import-"))) throw new Error("Todo migration required or incomplete cutover; inspect legacy source/fence/staging before initializing");
}
export function initialize(db: DatabaseSync, origin: string, fingerprint?: string) {
  db.exec(schema);
  const insert = db.prepare("INSERT INTO store_metadata(key,value) VALUES(?,?)");
  insert.run("application", application); insert.run("origin", origin);
  if (fingerprint) insert.run("source_fingerprint", fingerprint);
  db.exec("PRAGMA user_version=1");
}
function open(root: string, write: boolean): { root: string; db: DatabaseSync } {
  root = canonicalRoot(resolve(root));
  if (!existsSync(join(root, "todo.sqlite"))) freshGuard(root);
  const file = privateDatabase(root);
  let db = new DatabaseSync(file, { timeout: write ? 0 : 1000 });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL");
    if (version(db) === 0 && objects(db).length === 0) {
      if (!write) { db.close(); db = new DatabaseSync(file, { timeout: 0 }); db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL"); }
      freshGuard(root); db.exec("PRAGMA journal_mode=WAL"); db.exec("BEGIN IMMEDIATE");
      try {
        if (version(db) === 0 && objects(db).length === 0) { freshGuard(root); initialize(db, "fresh"); }
        else validateDatabase(db);
        db.exec("COMMIT");
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
      if (!write) { db.close(); db = new DatabaseSync(file, { timeout: 1000 }); db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL"); }
    }
    validateDatabase(db);
    return { root, db };
  } catch (error) { if (db.isOpen) db.close(); throw error; }
}
export function synchronous<T>(value: T): T {
  if (value && typeof (value as any).then === "function") throw new Error("Todo transaction callbacks must be synchronous");
  return value;
}
function transaction<T>(root: string, write: boolean, operation: (db: DatabaseSync, root: string) => T, signal?: AbortSignal): T {
  let db: DatabaseSync | undefined;
  try {
    signal?.throwIfAborted(); const opened = open(root, write); db = opened.db;
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { const result = synchronous(operation(db, opened.root)); signal?.throwIfAborted(); db.exec("COMMIT"); return result; }
    catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    const sqliteCode = Number((error as Error & { errcode?: number }).errcode) & 0xff;
    if (sqliteCode === 5 || sqliteCode === 6) throw new Error("Todo store is busy; retry", { cause: error });
    throw error;
  } finally { db?.close(); }
}
export function withRead<T>(root: string, operation: (db: DatabaseSync, root: string) => T): T { return transaction(root, false, operation); }
export function withWrite<T>(root: string, operation: (db: DatabaseSync, root: string) => T, signal?: AbortSignal): T { return transaction(root, true, operation, signal); }
export function locator(root: string, id: string, parent?: string): string { return parent ? join(root, parent, "todos", id) : join(root, id); }
export function decodeOwner(root: string, row: Record<string, unknown>): Located {
  const document = JSON.parse(String(row.document));
  if (document.version !== 2) throw new Error("Invalid canonical owner version");
  const todo = validate(document); const parent_id = row.parent_id === null ? undefined : String(row.parent_id);
  if (todo.id !== row.id) throw new Error("Invalid canonical owner");
  return { todo, parent_id, directory: locator(root, todo.id, parent_id) };
}
export function readRows(db: DatabaseSync, root: string): Located[] {
  const rows = db.prepare("SELECT id,parent_id,document FROM owners ORDER BY COALESCE(parent_id,id), parent_id IS NOT NULL, id").all().map(row => decodeOwner(root, row));
  for (const row of rows) if (row.parent_id && (row.todo.type !== "simple" || !rows.some(parent => parent.todo.id === row.parent_id && parent.todo.type === "project" && !parent.parent_id))) throw new Error("Only root projects can hold simple todos");
  validateGraph(rows); return rows;
}
export function insertOwner(db: DatabaseSync, todo: Todo, parent?: string) { db.prepare("INSERT INTO owners(id,parent_id,document) VALUES(?,?,?)").run(todo.id, parent ?? null, JSON.stringify(validate(todo))); }
export function updateOwner(db: DatabaseSync, item: Located) { db.prepare("UPDATE owners SET document=? WHERE id=?").run(JSON.stringify(validate(item.todo)), item.todo.id); }
export function artifactBytes(db: DatabaseSync, owner: string, version: string): Buffer {
  const row = db.prepare("SELECT body FROM artifact_revisions WHERE owner_id=? AND version=?").get(owner, version);
  if (!row) throw new Error(`Missing current artifact body: ${owner}/${version}`);
  return Buffer.from(row.body as Uint8Array);
}
