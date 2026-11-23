import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { contextSchema, readRows, schema, validateDatabase, artifactBytes, withRead } from "./database.ts";
import { readRows as readLegacyRows, validateDatabase as validateLegacyDatabase } from "./legacy-database.ts";
import { validate as validateProject, type Todo, type ContextReference } from "./state.ts";
import type { Located as LegacyLocated } from "./legacy.ts";
import { insertLink, type Link } from "./links.ts";
import { resumeBundle } from "./session.ts";

function derivedId(...parts: string[]): string {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** Deterministic mapping is also the JSON import comparison contract. No timestamps are invented for owners. */
export function normalizeLegacy(rows: LegacyLocated[]): { projects: Todo[]; links: Link[] } {
  const projects: Todo[] = rows.map(row => ({ ...structuredClone(row.todo), version: 3, type: "project", context_refs: [], legacy: { type: row.todo.type, ...(row.parent_id ? { parent_id: row.parent_id } : {}) } }));
  const links: Link[] = [];
  const add = (consumer: string, ref: ContextReference) => {
    const project = projects.find(p => p.id === consumer); if (!project) throw new Error(`Missing legacy artifact audience: ${consumer}`);
    project.context_refs.push(ref);
  };
  for (const row of rows) {
    if (row.parent_id) {
      const origin = { type: "schema1-parent", parent_id: row.parent_id };
      add(row.todo.id, { id: derivedId("grounding", row.todo.id, row.parent_id), kind: "project-grounding", source_project_id: row.parent_id, reason: "Former parent working context", origin });
      links.push({ id: derivedId("contributes-to", row.todo.id, row.parent_id), revision: 1, from_kind: "project", from_id: row.todo.id, to_kind: "project", to_id: row.parent_id, relation: "contributes-to", reason: "Former parent association", active: true, created_at: row.todo.created_at, updated_at: row.todo.updated_at, origin });
    }
    for (const artifact of row.todo.artifacts) {
      const children = rows.filter(child => child.parent_id === row.todo.id).map(child => child.todo.id);
      if (artifact.applies_to.some(id => !children.includes(id))) throw new Error("Legacy artifact audience must reference direct children");
      const audience = artifact.applies_to.length ? artifact.applies_to : [row.todo.id, ...children];
      for (const id of audience) add(id, { id: derivedId("artifact", id, row.todo.id, artifact.id), kind: "artifact", source_owner_id: row.todo.id, artifact_id: artifact.id, follow: "current", requirement: "source", reason: "Materialized legacy artifact audience", origin: { type: "schema1-artifact", owner_id: row.todo.id } });
    }
  }
  projects.forEach(validateProject);
  return { projects, links };
}
function hashRows(db: DatabaseSync, tables: [string, string][]): string {
  const hash = createHash("sha256");
  const frame = (bytes: Uint8Array | string) => { const value = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes); hash.update(`${value.length}:`); hash.update(value); };
  for (const [table, order] of tables) {
    frame(table);
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()) {
      frame("row");
      for (const [key, value] of Object.entries(row)) { frame(key); frame(value === null ? "null" : value instanceof Uint8Array ? "blob" : typeof value); frame(value instanceof Uint8Array ? value : String(value)); }
    }
  }
  return hash.digest("hex");
}
const bodyTables: [string, string][] = [["artifact_revisions", "owner_id,version"], ["retained_legacy_files", "owner_id,relative_path"]];
export function logicalFingerprint(db: DatabaseSync): string { return hashRows(db, [["owners", "id"], ...bodyTables, ["store_metadata", "key"]]); }
function integrity(db: DatabaseSync) {
  if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity/foreign key validation failed");
}
/** Caller owns FK OFF before BEGIN, transaction, backup, paths and COMMIT. Never await here. */
export function upgradeSchema1InTransaction(db: DatabaseSync) {
  if (!db.isTransaction || Number(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys) !== 0) throw new Error("Upgrade requires an existing write transaction with foreign_keys disabled before BEGIN");
  validateLegacyDatabase(db); integrity(db);
  const legacy = readLegacyRows(db, "");
  // Every current catalog pointer must identify actual committed bytes, optional included.
  for (const row of legacy) for (const artifact of row.todo.artifacts) artifactBytes(db, row.todo.id, artifact.path);
  const bytesBefore = hashRows(db, bodyTables);
  const mapped = normalizeLegacy(legacy);
  const ownersSql = schema.split(";").map(s => s.trim()).find(s => s.startsWith('CREATE TABLE "owners"'))!;
  db.exec(ownersSql.replace('CREATE TABLE "owners"', "CREATE TABLE owners_new"));
  const insert = db.prepare("INSERT INTO owners_new(id,document) VALUES(?,?)");
  for (const project of mapped.projects) insert.run(project.id, JSON.stringify(project));
  db.exec("DROP TABLE owners; ALTER TABLE owners_new RENAME TO owners;");
  db.exec(contextSchema);
  for (const link of mapped.links) insertLink(db, link);
  db.prepare("INSERT INTO store_metadata(key,value) VALUES('context_model','3')").run();
  db.prepare("INSERT INTO store_metadata(key,value) VALUES('schema_upgrade',?)").run(JSON.stringify({ from: 1, to: 2, at: new Date().toISOString() }));
  db.exec("PRAGMA user_version=2");
  validateDatabase(db); readRows(db, ""); integrity(db);
  if (hashRows(db, bodyTables) !== bytesBefore) throw new Error("Upgrade changed artifact/retained bytes");
  return { owners: mapped.projects.length, links: mapped.links.length, knowledge: 0 };
}
function database(root: string): DatabaseSync {
  const file = join(root, "todo.sqlite");
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error("Expected existing regular todo.sqlite");
  const db = new DatabaseSync(file, { timeout: 0 });
  db.exec("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON"); return db;
}
function supported(db: DatabaseSync): 1 | 2 {
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version === 1) { validateLegacyDatabase(db); return 1; }
  if (version === 2) { validateDatabase(db); return 2; }
  throw new Error("Unsupported todo database schema");
}
export function inspect(root: string) {
  root = realpathSync(root); const db = database(root);
  try {
    const version = supported(db); integrity(db);
    const rows = version === 1 ? readLegacyRows(db, root) : readRows(db, root);
    if (version === 1) normalizeLegacy(rows as LegacyLocated[]);
    for (const row of rows) for (const artifact of row.todo.artifacts) artifactBytes(db, row.todo.id, artifact.path);
    return { root, schema: version, owners: rows.length, fingerprint: logicalFingerprint(db) };
  }
  finally { db.close(); }
}
export async function verify(root: string) {
  root = realpathSync(root);
  const db = database(root);
  try { validateDatabase(db); } finally { db.close(); }
  const result = withRead(root, (db, root) => {
    integrity(db); const rows = readRows(db, root);
    for (const row of rows) for (const artifact of row.todo.artifacts) artifactBytes(db, row.todo.id, artifact.path);
    return { root, schema: 2, owners: rows.length, fingerprint: logicalFingerprint(db), integrity: "ok" };
  });
  for (const row of withRead(root, readRows)) await resumeBundle(root, row.todo.id);
  return result;
}
function outside(root: string, path: string) {
  let ancestor = resolve(path); const missing: string[] = [];
  while (!existsSync(ancestor)) { missing.unshift(ancestor.split(/[\\/]/).at(-1)!); ancestor = dirname(ancestor); }
  const resolved = join(realpathSync(ancestor), ...missing); const rel = relative(root, resolved);
  if (!rel || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error("Backup/workspace must be outside root");
}
async function exclusiveBackup(db: DatabaseSync, path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, "wx", 0o600));
  await backup(db, path);
  const copy = new DatabaseSync(path, { timeout: 0 });
  try {
    // Backup API creates a self-contained image; WAL mode is part of the supported schema.
    validateLegacyDatabase(copy); integrity(copy); readLegacyRows(copy, dirname(path));
    return logicalFingerprint(copy);
  } finally { copy.close(); }
}
export async function rehearse(root: string, workspace: string) {
  root = realpathSync(root); workspace = resolve(workspace); outside(root, workspace);
  const source = database(root);
  try {
    if (supported(source) !== 1) throw new Error("Rehearsal requires schema1");
    mkdirSync(dirname(workspace), { recursive: true, mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
    const preimage = join(workspace, "backup", "todo.sqlite");
    const fingerprint = await exclusiveBackup(source, preimage);
    const preserved = database(dirname(preimage)); const candidate = join(workspace, "candidate");
    try { await exclusiveBackup(preserved, join(candidate, "todo.sqlite")); } finally { preserved.close(); }
    const db = database(candidate);
    try {
      db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
      try { upgradeSchema1InTransaction(db); db.exec("COMMIT"); }
      catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
      finally { db.exec("PRAGMA foreign_keys=ON"); }
    } finally { db.close(); }
    return { ...(await verify(candidate)), backup: preimage, preimage_fingerprint: fingerprint, published: false };
  } finally { source.close(); }
}
/** Hooks are explicit in-process test seams at real transaction boundaries, never CLI options. */
export async function apply(root: string, backupPath: string, authorized = false, hooks: { afterBackup?: () => void; beforeCommit?: (db: DatabaseSync) => void } = {}) {
  root = realpathSync(root); const source = database(root);
  try {
    if (supported(source) === 2) return { status: "already_upgraded", ...(await verify(root)) };
    if (!authorized) throw new Error("Apply requires --apply, exact-root authorization and stopped writers");
    backupPath = resolve(backupPath); outside(root, backupPath);
    const fingerprint = await exclusiveBackup(source, backupPath);
    hooks.afterBackup?.();
    source.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
    try {
      validateLegacyDatabase(source);
      if (logicalFingerprint(source) !== fingerprint) throw new Error("Source changed after backup; refusing upgrade");
      upgradeSchema1InTransaction(source); hooks.beforeCommit?.(source);
      integrity(source); source.exec("COMMIT");
    } catch (error) { if (source.isTransaction) source.exec("ROLLBACK"); throw error; }
    finally { source.exec("PRAGMA foreign_keys=ON"); }
    return { status: "upgraded", backup: backupPath, preimage_fingerprint: fingerprint, ...(await verify(root)) };
  } finally { source.close(); }
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!["inspect", "rehearse", "apply", "verify"].includes(action)) throw new Error("Expected inspect, rehearse, apply or verify");
  const allowed = action === "rehearse" ? ["--root", "--workspace"] : action === "apply" ? ["--root", "--backup", "--apply"] : ["--root"];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (!allowed.includes(flag) || options.has(flag)) throw new Error(`Unknown/duplicate option: ${flag}`);
    if (flag === "--apply") options.set(flag, "true");
    else { const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value: ${flag}`); options.set(flag, value); }
  }
  for (const flag of allowed) if (!options.has(flag)) throw new Error(`${flag} required`);
  const root = options.get("--root")!;
  const result = action === "inspect" ? inspect(root) : action === "verify" ? await verify(root) : action === "rehearse" ? await rehearse(root, options.get("--workspace")!) : await apply(root, options.get("--backup")!, options.has("--apply"));
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
