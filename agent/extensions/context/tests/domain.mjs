// Actual domain + child-Node CLI proof. All state is synthetic and private before any source import.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const scratch = mkdtempSync(join(tmpdir(), "pi-context-domain-"));
const feature = dirname(dirname(fileURLToPath(import.meta.url)));
Object.assign(process.env, { HOME: join(scratch, "home"), PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TODO_PATH: join(scratch, "unused") });
mkdirSync(process.env.HOME); mkdirSync(process.env.PI_CODING_AGENT_DIR);
const { DatabaseSync } = await import("node:sqlite");
const legacy = await import("../legacy-database.ts");
const oldState = await import("../legacy-state.ts");
const database = await import("../database.ts");
const storage = await import("../storage.ts");
const artifacts = await import("../artifacts.ts");
const links = await import("../links.ts");
const session = await import("../session.ts");
const upgrade = await import("../sqlite-upgrade.ts");
const knowledge = await import("../knowledge.ts");
const records = await import("../records.ts");
const authority = { session_id: "synthetic-session", approval_evidence: "Synthetic test scoped maintenance request" };
function cli(module, args, ok = true) {
  const result = spawnSync(process.execPath, [join(feature, module), ...args], { cwd: scratch, env: process.env, encoding: "utf8" });
  if (ok) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
  assert.notEqual(result.status, 0, result.stdout); return result.stderr;
}
function fixture(name) {
  const root = join(scratch, name); mkdirSync(root);
  const parent = oldState.createTodo("project", "Synthetic parent", "Legacy goal");
  const child = oldState.createTodo("simple", "Synthetic child", "Child goal");
  const sibling = oldState.createTodo("simple", "Synthetic sibling", "Sibling goal");
  const external = oldState.createTodo("simple", "Synthetic external", "Other goal");
  sibling.depends_on = [child.id];
  child.revision = 7;
  child.current_state.evidence = [{ id: randomUUID(), text: "evidence exact text" }];
  child.last_checkpoint = { key: "historical", digest: "f".repeat(64), session_id: "old", at: child.created_at };
  parent.current_state.evidence = [{ id: randomUUID(), text: "source-grounding-needle" }];
  const scoped = { id: randomUUID(), title: "Child-only design", kind: "design", path: "", description: "scoped-doc-needle", lifecycle: "current", required: true, applies_to: [child.id] };
  scoped.path = `artifacts/${scoped.id}-2.md`;
  const wide = { id: randomUUID(), title: "Ownerwide research", kind: "research", path: "", description: "wide-doc-needle", lifecycle: "current", required: true, applies_to: [] };
  wide.path = `artifacts/${wide.id}-3.md`;
  parent.artifacts = [scoped, wide];
  const historical = `artifacts/${wide.id}-1.md`;
  const bytes = Buffer.from([0x00, 0xff, 0x41, 0x0a]);
  const db = new DatabaseSync(join(root, "todo.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  legacy.initialize(db, "synthetic-origin", "old-fingerprint");
  for (const [todo, placement] of [[parent], [child, parent.id], [sibling, parent.id], [external]]) legacy.insertOwner(db, todo, placement);
  for (const [version, body] of [[scoped.path, Buffer.from("child required body\n")], [wide.path, Buffer.from("wide required body\n")], [historical, Buffer.from("old committed body\n")]]) db.prepare("INSERT INTO artifact_revisions VALUES(?,?,?)").run(parent.id, version, body);
  db.prepare("INSERT INTO retained_legacy_files VALUES(?,?,?)").run(parent.id, "artifacts/unknown.bin", bytes);
  db.exec("COMMIT");
  // Keep the connection open: WAL-resident writes must be included by backup().
  return { root, db, parent, child, sibling, external, scoped, wide, historical, bytes };
}
function definitions(db) { return db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all(); }
function snapshot(db) { return upgrade.logicalFingerprint(db); }
try {
  const f = fixture("legacy");
  const original = snapshot(f.db);
  await assert.rejects(storage.list(f.root), /explicit sqlite-upgrade/);
  assert.equal(snapshot(f.db), original);
  assert.equal(cli("sqlite-upgrade.ts", ["inspect", "--root", f.root]).schema, 1);
  assert.match(cli("sqlite-upgrade.ts", ["inspect", "--root", f.root, "--backup", "no"], false), /Unknown/);
  const insideBackup = join(f.root, "..backup", "preimage.sqlite");
  assert.match(cli("sqlite-upgrade.ts", ["apply", "--root", f.root, "--backup", insideBackup, "--apply"], false), /outside root/);
  assert(!existsSync(dirname(insideBackup)), "rejected backup reserves no output inside root");
  const insideWorkspace = join(f.root, "..workspace");
  assert.match(cli("sqlite-upgrade.ts", ["rehearse", "--root", f.root, "--workspace", insideWorkspace], false), /outside root/);
  assert(!existsSync(insideWorkspace), "rejected rehearsal reserves no workspace inside root");
  assert.equal(snapshot(f.db), original, "rejected paths leave source unchanged");
  const rehearsal = cli("sqlite-upgrade.ts", ["rehearse", "--root", f.root, "--workspace", join(scratch, "rehearsal")]);
  assert.equal(snapshot(f.db), original, "rehearsal did not alter source logical rows");
  const preserved = new DatabaseSync(rehearsal.backup); legacy.validateDatabase(preserved); assert.equal(snapshot(preserved), original); preserved.close();
  const backup = join(scratch, "backup", "preimage.sqlite");
  const applied = cli("sqlite-upgrade.ts", ["apply", "--root", f.root, "--backup", backup, "--apply"]);
  assert.equal(applied.status, "upgraded"); assert.equal(statSync(backup).mode & 0o777, 0o600);
  const preimage = new DatabaseSync(backup); legacy.validateDatabase(preimage); assert.equal(snapshot(preimage), original); preimage.close();
  const rows = await storage.list(f.root); assert.equal(rows.length, 4);
  const mappingDb = new DatabaseSync(backup);
  const mapped = upgrade.normalizeLegacy(legacy.readRows(mappingDb, "")); mappingDb.close();
  assert.deepEqual(rows.map(r => r.todo), [...mapped.projects].sort((a,b) => a.id.localeCompare(b.id)));
  for (const original of [f.parent, f.child, f.sibling, f.external]) {
    const { version: oldVersion, type: oldType, ...oldCore } = original;
    const { version, type, context_refs, legacy: provenance, ...core } = rows.find(row => row.todo.id === original.id).todo;
    assert.deepEqual(core, oldCore, "owner IDs, revisions, times, ordered content, evidence/retry IDs and all old catalog metadata survive unchanged");
    assert.equal(provenance.type, oldType);
  }
  const rehearsalRows = await storage.list(rehearsal.root);
  assert.deepEqual(rehearsalRows.map(row => row.todo), rows.map(row => row.todo), "rehearsal/apply materialize exactly the same deterministic references");
  const migratedLinks = links.listLinks(f.root, { endpoint: { kind: "project", id: f.parent.id }, direction: "incoming" }).items;
  assert.deepEqual(migratedLinks.map(link => link.from_id).sort(), [f.child.id, f.sibling.id].sort());
  assert(migratedLinks.every(link => link.relation === "contributes-to" && link.to_id === f.parent.id));
  assert(rows.every(r => !r.parent_id && r.todo.version === 3 && r.todo.type === "project"));
  assert.equal(f.db.prepare("SELECT value FROM store_metadata WHERE key='origin'").get().value, "synthetic-origin");
  assert.equal(f.db.prepare("SELECT count(*) n FROM knowledge_entries").get().n, 0);
  assert.deepEqual(Buffer.from(f.db.prepare("SELECT body FROM artifact_revisions WHERE owner_id=? AND version=?").get(f.parent.id, f.historical).body), Buffer.from("old committed body\n"));
  assert.deepEqual(Buffer.from(f.db.prepare("SELECT body FROM retained_legacy_files").get().body), f.bytes);
  const parentBundle = await session.resumeBundle(f.root, f.parent.id);
  const childBundle = await session.resumeBundle(f.root, f.child.id);
  const siblingBundle = await session.resumeBundle(f.root, f.sibling.id);
  assert.deepEqual(parentBundle.required_artifacts.map(a => a.artifact_id), [f.wide.id]);
  assert.deepEqual(childBundle.required_artifacts.map(a => a.artifact_id), [f.scoped.id, f.wide.id]);
  assert.deepEqual(siblingBundle.required_artifacts.map(a => a.artifact_id), [f.wide.id]);
  assert.equal(childBundle.context_model, 2); assert.equal(childBundle.grounding[0].source_owner_id, f.parent.id);
  assert(!("artifacts" in childBundle.grounding[0].context));
  assert(childBundle.required_artifacts.every(a => a.read.id === f.parent.id && a.read.expected_version === a.version));
  assert.equal((await records.readRecordPage(f.root, { id: f.child.id, expected_revision: 7, source_kind: "evidence", index: 0 })).body, "evidence exact text");
  const restart = cli("sqlite-upgrade.ts", ["apply", "--root", f.root, "--backup", join(scratch, "should-not-exist"), "--apply"]);
  assert.equal(restart.status, "already_upgraded"); assert(!existsSync(join(scratch, "should-not-exist")));
  assert.throws(() => legacy.validateDatabase(f.db), /Unsupported/);
  const fresh = join(scratch, "fresh"); await storage.create(fresh, "simple", "Independent", "Goal");
  database.withRead(fresh, db => assert.deepEqual(definitions(f.db), definitions(db), "fresh/upgraded sqlite_schema SQL is byte-identical"));
  // Global DAG, transitive completion and no association status effects.
  await assert.rejects(storage.create(f.root, "simple", "Rejected nested", "Goal", f.parent.id), /retired/);
  await assert.rejects(storage.move(f.root, { id: f.external.id, parent: f.parent.id, revision: 1 }), /retired/);
  let external = await storage.checkpoint(f.root, f.external.id, 1, { depends_on: [f.sibling.id], status: "in_progress" }, "external-wait", "test");
  assert.equal(external.todo.status, "in_progress", "start allowed while waiting");
  await assert.rejects(storage.checkpoint(f.root, f.external.id, external.todo.revision, { status: "done" }, "premature", "test"), /waiting/);
  await assert.rejects(storage.checkpoint(f.root, f.child.id, 7, { depends_on: [f.external.id] }, "cycle", "test"), /cycle/);
  await assert.rejects(storage.checkpoint(f.root, f.child.id, 7, { depends_on: [randomUUID()] }, "missing", "test"), /does not exist/);
  await assert.rejects(storage.checkpoint(f.root, f.child.id, 7, { depends_on: [f.child.id] }, "self", "test"), /itself/);
  let child = await storage.checkpoint(f.root, f.child.id, 7, { status: "canceled" }, "cancel", "test");
  await assert.rejects(storage.checkpoint(f.root, f.sibling.id, 1, { status: "done" }, "blocked-canceled", "test"), /waiting/);
  child = await storage.checkpoint(f.root, f.child.id, child.todo.revision, { status: "done" }, "child-done", "test");
  let sibling = await storage.checkpoint(f.root, f.sibling.id, 1, { status: "done" }, "sibling-done", "test");
  external = await storage.checkpoint(f.root, f.external.id, external.todo.revision, { status: "done" }, "external-done", "test");
  assert.equal((await storage.locate(f.root, f.parent.id)).todo.status, "todo", "no parent rollup/autostart");
  // Associations/ref edits use real transactional receipts and preserve unrelated owners.
  const linkInput = { action: "link", from: { kind: "project", id: f.parent.id }, to: { kind: "project", id: f.external.id }, relation: "related", reason: "Synthetic navigation only", key: "link" };
  assert.throws(() => links.writeLink(f.root, linkInput, { session_id: "no-authority" }), /approval/);
  const receipt = links.writeLink(f.root, linkInput, authority);
  assert.throws(() => links.writeLink(f.root, { ...linkInput, key: "duplicate" }, authority), /already exists/);
  assert.throws(() => links.writeLink(f.root, { ...linkInput, to: linkInput.from, key: "self-link" }, authority), /Self/);
  assert.throws(() => links.writeLink(f.root, { ...linkInput, to: { kind: "project", id: randomUUID() }, key: "missing-link" }, authority), /Missing/);
  links.writeLink(f.root, { action: "update_reason", id: receipt.id, expected_revision: 1, reason: "Revised navigation", key: "reason" }, authority);
  assert.deepEqual(links.writeLink(f.root, linkInput, authority), { ...receipt, current_revision: 2 });
  assert.throws(() => links.writeLink(f.root, { ...linkInput, reason: "changed retry" }, authority), /reused/);
  links.writeLink(f.root, { action: "unlink", id: receipt.id, expected_revision: 2, change_note: "Removed", key: "unlink" }, authority);
  links.writeLink(f.root, { action: "restore", id: receipt.id, expected_revision: 3, change_note: "Restored", key: "restore" }, authority);
  assert.equal((await storage.locate(f.root, f.parent.id)).todo.revision, 1);
  database.withRead(f.root, db => assert.equal(db.prepare("SELECT count(*) n FROM context_link_revisions WHERE link_id=?").get(receipt.id).n, 4));
  const outgoing = links.listLinks(f.root, { endpoint: linkInput.from, direction: "outgoing", limit: 1 });
  assert.equal(outgoing.items[0].id, receipt.id); assert.equal(outgoing.items[0].to.title, f.external.title);
  assert(links.listLinks(f.root, { endpoint: linkInput.to, direction: "incoming" }).items.some(link => link.id === receipt.id), "backlinks derive from the same row");
  const history = links.linkHistory(f.root, { id: receipt.id, limit: 2 });
  assert.deepEqual(history.items.map(link => link.revision), [4, 3]);
  assert.deepEqual(links.linkHistory(f.root, { id: receipt.id, limit: 2, cursor: history.next_cursor }).items.map(link => link.revision), [2, 1]);
  assert.throws(() => links.linkHistory(f.root, { id: randomUUID(), cursor: history.next_cursor }), /not found/);
  const incomingPage = links.listLinks(f.root, { endpoint: { kind: "project", id: f.parent.id }, direction: "incoming", limit: 1 });
  assert(incomingPage.next_cursor);
  assert.throws(() => links.listLinks(f.root, { endpoint: { kind: "project", id: f.parent.id }, direction: "both", cursor: incomingPage.next_cursor }), /filters changed/);
  const sourceBefore = (await storage.locate(f.root, f.parent.id)).todo;
  let consumer = await storage.create(f.root, "project", "Consumer", "Direct scope only");
  let ref = links.writeReference(f.root, { action: "reference_add", project_id: consumer.todo.id, expected_revision: 1, reference: { kind: "project-grounding", source_project_id: f.parent.id, reason: "Use source understanding" }, key: "ground" }, authority);
  assert((await knowledge.searchKnowledge(f.root, { selector: consumer.todo.id, query: "source-grounding-needle" })).results.some(r => r.owner_id === f.parent.id));
  assert.equal((await knowledge.searchKnowledge(f.root, { selector: consumer.todo.id, query: "wide required body" })).results.length, 0, "grounding does not enroll artifacts");
  links.writeReference(f.root, { action: "reference_remove", project_id: consumer.todo.id, expected_revision: ref.accepted_revision, reference_id: ref.reference_id, change_note: "Only artifact now", key: "remove-ground" }, authority);
  ref = links.writeReference(f.root, { action: "reference_add", project_id: consumer.todo.id, expected_revision: 3, reference: { kind: "artifact", source_owner_id: f.parent.id, artifact_id: f.wide.id, follow: "current", requirement: "source", reason: "Explicit doc" }, key: "doc" }, authority);
  assert.equal((await knowledge.searchKnowledge(f.root, { selector: consumer.todo.id, query: "source-grounding-needle" })).results.length, 0, "artifact does not enroll source records");
  assert.equal((await knowledge.searchKnowledge(f.root, { selector: consumer.todo.id, query: "wide required body" })).results.length, 1);
  assert.equal((await knowledge.searchKnowledge(f.root, { selector: consumer.todo.id, query: "child required body" })).results.length, 0, "an artifact reference enrolls only the referenced artifact");
  assert.deepEqual((await storage.locate(f.root, f.parent.id)).todo, sourceBefore, "consumer references never mutate source");
  assert.equal((await session.resumeBundle(f.root, consumer.todo.id)).watch.length, 2);
  const referenceBefore = snapshot(f.db);
  const receiptsBefore = f.db.prepare("SELECT count(*) n FROM context_operations").get().n;
  for (const reference of [
    { kind: "project-grounding", source_project_id: consumer.todo.id, reason: "No self" },
    { kind: "project-grounding", source_project_id: randomUUID(), reason: "Missing source" },
    { kind: "artifact", source_owner_id: f.parent.id, artifact_id: randomUUID(), follow: "current", requirement: "source", reason: "Missing artifact" },
    { kind: "artifact", source_owner_id: f.parent.id, artifact_id: f.wide.id, follow: "current", requirement: "source", reason: "Duplicate ref" },
  ]) assert.throws(() => links.writeReference(f.root, { action: "reference_add", project_id: consumer.todo.id, expected_revision: 4, reference, key: randomUUID() }, authority));
  assert.equal(snapshot(f.db), referenceBefore, "invalid refs leave owners unchanged");
  assert.equal(f.db.prepare("SELECT count(*) n FROM context_operations").get().n, receiptsBefore, "invalid refs do not accept receipts");
  assert.throws(() => links.writeReference(f.root, { action: "reference_remove", project_id: consumer.todo.id, expected_revision: 3, reference_id: ref.reference_id, change_note: "Stale", key: "stale-ref" }, authority), /Stale/);
  // Mutual direct grounding is legal but never expands recursively.
  let mutual = links.writeReference(f.root, { action: "reference_add", project_id: consumer.todo.id, expected_revision: 4, reference: { kind: "project-grounding", source_project_id: f.external.id, reason: "Direct external" }, key: "mutual-one" }, authority);
  links.writeReference(f.root, { action: "reference_add", project_id: f.external.id, expected_revision: external.todo.revision, reference: { kind: "project-grounding", source_project_id: consumer.todo.id, reason: "Mutual direct" }, key: "mutual-two" }, authority);
  const mutualBundle = await session.resumeBundle(f.root, consumer.todo.id);
  assert.equal(mutualBundle.grounding.length, 1); assert.equal(mutualBundle.grounding[0].source_owner_id, f.external.id);
  assert(!("context_refs" in mutualBundle.grounding[0].context));
  assert(!("depends_on" in mutualBundle.grounding[0].context));
  const beforeArtifact = await storage.locate(f.root, f.parent.id);
  const newArtifact = await artifacts.saveArtifact(f.root, f.parent.id, beforeArtifact.todo.revision, { title: "New unrelated", kind: "research", description: "new", lifecycle: "current", required: true, applies_to: [], body: "New source body" });
  assert.equal(newArtifact.todo.context_refs.length, beforeArtifact.todo.context_refs.length + 1);
  const ownRef = newArtifact.todo.context_refs.find(r => r.kind === "artifact" && r.artifact_id === newArtifact.todo.artifacts.at(-1).id);
  links.writeReference(f.root, { action: "reference_remove", project_id: f.parent.id, expected_revision: newArtifact.todo.revision, reference_id: ownRef.id, change_note: "Remove from brief, not catalog", key: "remove-own" }, authority);
  assert.equal((await session.resumeBundle(f.root, f.parent.id)).required_artifacts.length, 1);
  assert.equal(await artifacts.readArtifact(f.root, await storage.locate(f.root, f.parent.id), ownRef.artifact_id), "New source body\n");
  const beforeSourceEdit = await storage.locate(f.root, f.parent.id);
  const consumerBeforeSourceEdit = await storage.locate(f.root, consumer.todo.id);
  const sourceEdit = await artifacts.saveArtifact(f.root, f.parent.id, beforeSourceEdit.todo.revision, { ...f.wide, body: "Updated current source body" });
  const wideCurrentPath = sourceEdit.todo.artifacts.find(a => a.id === f.wide.id).path;
  assert.notEqual(wideCurrentPath, f.wide.path);
  const followed = await session.resumeBundle(f.root, consumer.todo.id);
  assert.equal(followed.required_artifacts[0].version, wideCurrentPath);
  assert.equal(followed.required_artifacts[0].read.id, f.parent.id);
  assert.equal(followed.watch.find(row => row.id === f.parent.id).revision, sourceEdit.todo.revision);
  assert.deepEqual((await storage.locate(f.root, consumer.todo.id)).todo, consumerBeforeSourceEdit.todo, "source change does not silently refresh/write consumer");
  assert.equal(Buffer.from(f.db.prepare("SELECT body FROM artifact_revisions WHERE owner_id=? AND version=?").get(f.parent.id, f.wide.path).body).toString(), "wide required body\n");
  const currentParentRevision = sourceEdit.todo.revision;
  assert.equal((await session.resumeBundle(f.root, f.child.id)).required_artifacts.length, 2, "new source artifact does not fan out");
  assert.equal((await storage.locate(f.root, f.child.id)).todo.revision, child.todo.revision);
  await assert.rejects(artifacts.saveArtifact(f.root, f.parent.id, currentParentRevision, { ...f.scoped, applies_to: [], body: "wrong scoped mutation" }), /applies_to is retired/);
  // Body/current-pointer/ref commit rolls back on cancellation; required missing bytes fail visibly.
  const controller = new AbortController(); const beforeCancel = snapshot(f.db);
  await assert.rejects(storage.mutate(f.root, f.parent.id, currentParentRevision, (todo, _item, context) => { context.writeArtifact("artifacts/cancel-9.md", Buffer.from("not committed")); controller.abort(); return todo; }, controller.signal), /abort/i);
  assert.equal(snapshot(f.db), beforeCancel);
  f.db.prepare("DELETE FROM artifact_revisions WHERE owner_id=? AND version=?").run(f.parent.id, wideCurrentPath);
  await assert.rejects(session.resumeBundle(f.root, consumer.todo.id), /Missing current artifact body/);
  f.db.prepare("INSERT INTO artifact_revisions VALUES(?,?,?)").run(f.parent.id, wideCurrentPath, Buffer.from("Updated current source body\n"));
  f.db.close();
  // Refusals, locked-source freshness and rollback before COMMIT on real SQLite.
  const failure = fixture("failure"); const failureBefore = snapshot(failure.db);
  const existing = join(scratch, "existing.sqlite"); writeFileSync(existing, "do not overwrite");
  assert.match(cli("sqlite-upgrade.ts", ["apply", "--root", failure.root, "--backup", existing, "--apply"], false), /EEXIST/);
  assert.equal(readFileSync(existing, "utf8"), "do not overwrite");
  assert.match(cli("sqlite-upgrade.ts", ["apply", "--root", failure.root, "--backup", join(failure.root, "backup.sqlite"), "--apply"], false), /outside/);
  assert.throws(() => upgrade.upgradeSchema1InTransaction(failure.db), /existing write transaction/);
  failure.db.exec("BEGIN IMMEDIATE");
  assert.throws(() => upgrade.upgradeSchema1InTransaction(failure.db), /foreign_keys disabled/); failure.db.exec("ROLLBACK");
  await assert.rejects(upgrade.apply(failure.root, join(scratch, "rollback.sqlite"), true, { beforeCommit: db => { database.validateDatabase(db); assert.equal(database.readRows(db, failure.root).length, 4); throw new Error("synthetic cancel before commit"); } }), /synthetic cancel/);
  assert.equal(snapshot(failure.db), failureBefore); legacy.validateDatabase(failure.db); legacy.readRows(failure.db, failure.root);
  await assert.rejects(upgrade.apply(failure.root, join(scratch, "stale.sqlite"), true, { afterBackup: () => { failure.db.prepare("UPDATE owners SET document=json_set(document,'$.title','Changed after backup') WHERE id=?").run(failure.parent.id); } }), /Source changed/);
  legacy.validateDatabase(failure.db); const changed = snapshot(failure.db);
  failure.db.exec("BEGIN IMMEDIATE");
  assert.match(cli("sqlite-upgrade.ts", ["apply", "--root", failure.root, "--backup", join(scratch, "busy.sqlite"), "--apply"], false), /locked|busy/);
  failure.db.exec("ROLLBACK"); assert.equal(snapshot(failure.db), changed);
  const unknown = join(scratch, "unknown"); mkdirSync(unknown); const unknownDb = new DatabaseSync(join(unknown, "todo.sqlite")); unknownDb.exec("PRAGMA user_version=99"); unknownDb.close();
  const unknownBackup = join(scratch, "unknown-backup");
  assert.match(cli("sqlite-upgrade.ts", ["apply", "--root", unknown, "--backup", unknownBackup, "--apply"], false), /Unsupported/); assert(!existsSync(unknownBackup));
  failure.db.close();
  // JSON importer composes the exact same core on a private schema1 candidate.
  const jsonFixture = fixture("json-fixture"); jsonFixture.db.close();
  const jsonRoot = join(scratch, "json-source"); mkdirSync(jsonRoot);
  for (const [todo, parent] of [[jsonFixture.parent], [jsonFixture.child, jsonFixture.parent.id], [jsonFixture.sibling, jsonFixture.parent.id], [jsonFixture.external]]) {
    const dir = parent ? join(jsonRoot, parent, "todos", todo.id) : join(jsonRoot, todo.id);
    const document = todo.id === jsonFixture.child.id ? { ...todo, version: 1, current_state: { evidence: todo.current_state.evidence.map(row => row.text) } } : todo;
    mkdirSync(join(dir, "artifacts"), { recursive: true }); writeFileSync(join(dir, "todo.json"), JSON.stringify(document));
    for (const artifact of todo.artifacts) writeFileSync(join(dir, artifact.path), artifact.id === jsonFixture.scoped.id ? "child required body\n" : "wide required body\n");
    if (todo.id === jsonFixture.parent.id) writeFileSync(join(dir, "artifacts", "unknown.bin"), jsonFixture.bytes);
  }
  const jsonBefore = readFileSync(join(jsonRoot, jsonFixture.parent.id, "todo.json"));
  const insideJsonWorkspace = join(jsonRoot, "..workspace");
  assert.match(cli("migration.ts", ["rehearse", "--source", jsonRoot, "--workspace", insideJsonWorkspace], false), /outside source/);
  assert(!existsSync(insideJsonWorkspace), "rejected JSON rehearsal creates no workspace, copies or reports");
  assert(!existsSync(join(jsonRoot, "todo.sqlite"))); assert(!existsSync(join(jsonRoot, ".write-lock")));
  assert.deepEqual(readFileSync(join(jsonRoot, jsonFixture.parent.id, "todo.json")), jsonBefore);
  const jsonRehearse = cli("migration.ts", ["rehearse", "--source", jsonRoot, "--workspace", join(scratch, "json-rehearse")]);
  assert.equal(jsonRehearse.owners, 4); assert(!existsSync(join(jsonRoot, "todo.sqlite")));
  const jsonCutover = cli("migration.ts", ["cutover", "--source", jsonRoot, "--workspace", join(scratch, "json-cutover"), "--apply"]);
  assert.equal(jsonCutover.published, true); assert(existsSync(join(jsonRoot, ".write-lock")));
  assert.deepEqual(readFileSync(join(jsonRoot, jsonFixture.parent.id, "todo.json")), jsonBefore);
  assert.equal((await session.resumeBundle(jsonRoot, jsonFixture.child.id)).required_artifacts.length, 2);
  database.withRead(jsonRoot, db => database.withRead(fresh, freshDb => assert.deepEqual(definitions(db), definitions(freshDb))));
  cli("migration.ts", ["verify", "--root", jsonRoot]); cli("sqlite-upgrade.ts", ["verify", "--root", jsonRoot]);
  console.log("PASS: Project3/schema2 real domain, SQLite upgrade CLI, backup/freshness/rollback, direct scope and JSON importer");
} finally { rmSync(scratch, { recursive: true, force: true }); }
