import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { legacyRows, safePath } from "./legacy.ts";
import { artifactBytes, initialize, insertOwner, privateDatabase, readRows, validateDatabase, withRead } from "./database.ts";
import { resumeBundle } from "./session.ts";
import { readArtifactPage } from "./artifacts.ts";
import { searchKnowledge } from "./knowledge.ts";
import { readRecordPage } from "./records.ts";
import type { Located } from "./storage.ts";

type File = { path: string; bytes: Buffer };
type Inventory = { rows: Located[]; files: File[]; directories: string[]; fingerprint: string; schemas: Record<string, number>; unpublished: string[] };
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function inside(root: string, path: string) { const rel = relative(root, path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); }
async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function absent(path: string) { if (await exists(path)) throw new Error(`Refusing existing destination: ${path}`); }
async function inventory(source: string, excluded = new Set<string>()): Promise<Inventory> {
  source = await realpath(source); const rows = await legacyRows(source); const files: File[] = []; const directories: string[] = []; const unpublished: string[] = []; const schemas: Record<string, number> = {};
  async function walk(base: string) {
    for (const name of (await readdir(base)).sort()) {
      if (base === source && excluded.has(name)) continue;
      const path = join(base, name); const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Symlinks are not allowed inside todo storage: ${path}`);
      const rel = relative(source, path);
      if (name.endsWith(".creating") || name.endsWith(".tmp")) unpublished.push(rel);
      if (info.isDirectory()) { directories.push(rel); await walk(path); }
      else if (info.isFile()) files.push({ path: rel, bytes: await readFile(path) });
      else throw new Error(`Unsupported source entry: ${path}`);
    }
  }
  await walk(source);
  for (const row of rows) {
    const file = files.find(file => file.path === relative(source, join(row.directory, "todo.json")))!;
    const v = String(JSON.parse(file.bytes.toString("utf8")).version); schemas[v] = (schemas[v] ?? 0) + 1;
    for (const artifact of row.todo.artifacts) {
      const path = await safePath(source, `${relative(source, row.directory)}/${artifact.path}`);
      if (!files.some(file => file.path === relative(source, path))) throw new Error(`Missing current artifact body: ${path}`);
    }
  }
  const digest = createHash("sha256").update(JSON.stringify(directories)); for (const file of files) { digest.update(JSON.stringify([file.path, file.bytes.length])); digest.update(file.bytes); }
  return { rows, files, directories, fingerprint: digest.digest("hex"), schemas, unpublished };
}
function summary(data: Inventory) { return { fingerprint: data.fingerprint, owners: data.rows.length, directories: data.directories, files: data.files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: hash(file.bytes) })), schemas: data.schemas, unpublished: data.unpublished }; }
async function report(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
async function outside(source: string, target: string) {
  let ancestor = resolve(target); const missing: string[] = [];
  while (!await exists(ancestor)) { missing.unshift(ancestor.split(/[\\/]/).at(-1)!); ancestor = dirname(ancestor); }
  if (inside(source, join(await realpath(ancestor), ...missing))) throw new Error("Workspace/report must be outside source root");
}
export async function inspect(source: string, reportPath: string) {
  source = await realpath(source); const target = resolve(reportPath);
  await outside(source, target); await absent(join(source, "todo.sqlite"));
  const data = await inventory(source); const result = { source, ...summary(data) }; await report(target, result); return result;
}
async function workspace(source: string, path: string) {
  path = resolve(path); await outside(source, path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(path, { mode: 0o700 }); return await realpath(path);
}
async function snapshot(source: string, work: string, excluded = new Set<string>()): Promise<Inventory> {
  const before = await inventory(source, excluded); const backup = join(work, "source"); await mkdir(backup, { mode: 0o700 });
  for (const directory of before.directories) await mkdir(join(backup, directory), { recursive: true, mode: 0o700 });
  for (const file of before.files) { const dest = join(backup, file.path); await mkdir(dirname(dest), { recursive: true, mode: 0o700 }); await writeFile(dest, file.bytes, { flag: "wx", mode: 0o600 }); }
  const copied = await inventory(backup); const after = await inventory(source, excluded);
  if (before.fingerprint !== after.fingerprint || before.fingerprint !== copied.fingerprint) throw new Error("Source changed during snapshot; stopped-writer baseline required");
  await report(join(work, "inventory.json"), { source, backup, ...summary(before) }); return copied;
}
function fileBodies(data: Inventory, row: Located) {
  // Owner directories in a snapshot are stable; use their raw manifest suffix to locate bytes.
  const suffix = row.parent_id ? join(row.parent_id, "todos", row.todo.id) : row.todo.id;
  return data.files.filter(file => file.path.startsWith(suffix + "/artifacts/"));
}
async function importCandidate(root: string, data: Inventory) {
  await mkdir(root, { mode: 0o700 }); const db = new DatabaseSync(privateDatabase(root), { timeout: 0 });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL; BEGIN IMMEDIATE");
    try {
      initialize(db, "import", data.fingerprint);
      for (const row of data.rows) insertOwner(db, row.todo, row.parent_id);
      for (const row of data.rows) {
        const suffix = row.parent_id ? join(row.parent_id, "todos", row.todo.id) : row.todo.id;
        const current = new Set(row.todo.artifacts.map(a => a.path));
        for (const file of fileBodies(data, row)) {
          const path = relative(suffix, file.path);
          db.prepare(current.has(path) ? "INSERT INTO artifact_revisions(owner_id,version,body) VALUES(?,?,?)" : "INSERT INTO retained_legacy_files(owner_id,relative_path,body) VALUES(?,?,?)").run(row.todo.id, path, file.bytes);
        }
      }
      if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Import foreign key validation failed");
      db.exec("COMMIT");
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
  await compare(root, data);
}
async function compare(root: string, data: Inventory) {
  const canonical = (rows: Located[]) => rows.map(row => ({ todo: row.todo, parent_id: row.parent_id })).sort((a,b) => a.todo.id.localeCompare(b.todo.id));
  withRead(root, (db, canonicalRoot) => {
    if (JSON.stringify(canonical(readRows(db, canonicalRoot))) !== JSON.stringify(canonical(data.rows))) throw new Error("Imported canonical owner/placement mismatch");
    let currentCount = 0; let retainedCount = 0;
    for (const row of data.rows) {
      const suffix = row.parent_id ? join(row.parent_id, "todos", row.todo.id) : row.todo.id;
      const current = new Set(row.todo.artifacts.map(a => a.path));
      for (const file of fileBodies(data, row)) {
        if (current.has(relative(suffix, file.path))) currentCount++; else retainedCount++;
        const path = relative(suffix, file.path);
        const bytes = current.has(path) ? artifactBytes(db, row.todo.id, path) : Buffer.from(db.prepare("SELECT body FROM retained_legacy_files WHERE owner_id=? AND relative_path=?").get(row.todo.id, path)!.body as Uint8Array);
        if (!bytes.equals(file.bytes)) throw new Error(`Imported bytes mismatch: ${file.path}`);
      }
    }
    if (Number(db.prepare("SELECT count(*) AS n FROM artifact_revisions").get()!.n) !== currentCount || Number(db.prepare("SELECT count(*) AS n FROM retained_legacy_files").get()!.n) !== retainedCount) throw new Error("Imported document counts mismatch");
    if (db.prepare("SELECT value FROM store_metadata WHERE key='source_fingerprint'").get()?.value !== data.fingerprint) throw new Error("Imported source fingerprint mismatch");
  });
  await verify(root);
  for (const row of data.rows) {
    await resumeBundle(root, row.todo.id);
    const record = row.todo.current_state.evidence[0];
    if (record) {
      const page = await readRecordPage(root, { id: row.todo.id, expected_revision: row.todo.revision, source_kind: "evidence", index: 0 });
      if (page.body !== record.text.slice(0, 12000)) throw new Error("Imported record readback mismatch");
    }
    await searchKnowledge(root, { selector: row.todo.id, query: row.todo.title, view: "full" });
    for (const artifact of row.todo.artifacts) await readArtifactPage(root, row, artifact.id);
  }
}
export async function verify(root: string) {
  if (!await exists(join(root, "todo.sqlite"))) throw new Error("No todo database to verify");
  return withRead(root, (db, root) => {
    validateDatabase(db); const rows = readRows(db, root);
    if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Todo database integrity validation failed");
    const artifacts = rows.flatMap(row => row.todo.artifacts.map(a => ({ owner: row.todo.id, version: a.path, sha256: hash(artifactBytes(db, row.todo.id, a.path)) })));
    return { database: join(root, "todo.sqlite"), owners: rows.length, artifacts, retained_legacy_files: Number(db.prepare("SELECT count(*) AS n FROM retained_legacy_files").get()!.n), integrity: "ok" };
  });
}
function checkpointCandidate(root: string) {
  const db = new DatabaseSync(join(root, "todo.sqlite"), { timeout: 0 });
  try { const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()!; if (Number(result.busy) || Number(result.log) > 0) throw new Error("Candidate WAL checkpoint is busy/incomplete"); }
  finally { db.close(); }
}
export async function rehearse(source: string, work: string) {
  source = await realpath(source); await absent(join(source, "todo.sqlite")); work = await workspace(source, work); const data = await snapshot(source, work); const root = join(work, "root");
  await importCandidate(root, data); checkpointCandidate(root);
  const result = { ...(await verify(root)), source_fingerprint: data.fingerprint, backup: join(work, "source"), report: join(work, "result.json"), inventory_report: join(work, "inventory.json"), published: false };
  await report(join(work, "result.json"), result); return result;
}
export async function cutover(source: string, work: string, apply = false) {
  if (!apply) throw new Error("Cutover requires --apply and operator authorization/quiesced writers");
  source = await realpath(source); await absent(join(source, "todo.sqlite"));
  if ((await readdir(source)).some(name => name.startsWith(".todo-import-"))) throw new Error("Unresolved cutover staging; inspect before retry");
  await absent(join(source, ".write-lock")); work = await workspace(source, work);
  const operation = randomUUID(); const staging = join(source, `.todo-import-${operation}`); const fence = join(source, ".write-lock"); let published = false;
  await mkdir(fence, { mode: 0o700 });
  try {
    await writeFile(join(fence, "owner.json"), JSON.stringify({ purpose: "migrated-to-sqlite", operation, at: new Date().toISOString(), destination: join(source, "todo.sqlite") }), { flag: "wx", mode: 0o600 });
    const excluded = new Set([".write-lock", `.todo-import-${operation}`]);
    const data = await snapshot(source, work, excluded); await importCandidate(staging, data);
    if ((await inventory(source, excluded)).fingerprint !== data.fingerprint) throw new Error("Source changed after stopped snapshot; refusing publication");
    checkpointCandidate(staging); await absent(join(source, "todo.sqlite"));
    await rename(join(staging, "todo.sqlite"), join(source, "todo.sqlite")); published = true;
    await rmdir(staging); await compare(source, data);
    const result = { ...(await verify(source)), source_fingerprint: data.fingerprint, backup: join(work, "source"), report: join(work, "result.json"), inventory_report: join(work, "inventory.json"), fence, published };
    await report(join(work, "result.json"), result); return result;
  } catch (error) {
    await report(join(work, "failure.json"), { published, fence, staging, error: (error as Error).message });
    throw new Error(`Cutover failed (published=${published}); inspect ${work}/failure.json and retained fence/staging before retry: ${(error as Error).message}`, { cause: error });
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2); const option = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i+1]) throw new Error(`${name} required`); return args[i+1]; };
  let result: unknown;
  if (command === "inspect") result = await inspect(option("--source"), option("--report"));
  else if (command === "rehearse") result = await rehearse(option("--source"), option("--workspace"));
  else if (command === "cutover") result = await cutover(option("--source"), option("--workspace"), args.includes("--apply"));
  else if (command === "verify") result = await verify(option("--root"));
  else throw new Error("Expected inspect, rehearse, cutover or verify");
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
