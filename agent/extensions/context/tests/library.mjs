// Domain boundary proof: real private SQLite/filesystem, no host SDK, internal stubs or services.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const scratch = mkdtempSync(join(tmpdir(), "pi-context-library-"));
Object.assign(process.env, { HOME: join(scratch, "home"), PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TODO_PATH: join(scratch, "unused") });
mkdirSync(process.env.HOME); mkdirSync(process.env.PI_CODING_AGENT_DIR);
const { knowledgeOperation: kb, readKnowledge: read, validateKnowledgeInput, currentKnowledge } = await import("../library.ts");
const { contextOperation: context, validateContextInput } = await import("../discovery.ts");
const { withRead } = await import("../database.ts");
const { create, locate, mutate, list } = await import("../storage.ts");
const { saveArtifact } = await import("../artifacts.ts");
const { writeLink, writeReference, preflightOperation, listLinks } = await import("../links.ts");
const { readRecordPage } = await import("../records.ts");
const { readArtifactPage } = await import("../artifacts.ts");
const { searchKnowledge } = await import("../knowledge.ts");
const { compact } = await import("../session.ts");
const { effects } = await import("../dependencies.ts");
const root = join(scratch, "store");
const authority = { session_id: "synthetic-library-session", approval_evidence: "Synthetic user request to create and maintain these test entries" };
let key = 0;
const write = input => kb(root, { ...input, key: `knowledge-${++key}` }, authority);
const fields = (title, explanation = "Synthetic explanation") => ({ title, summary: "Synthetic summary", scope: "Synthetic scope", explanation });
const document = id => withRead(root, db => currentKnowledge(db, id));
const counts = () => withRead(root, db => Object.fromEntries(["knowledge_entries", "knowledge_revisions", "context_links", "context_link_revisions", "context_operations"].map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n])));
function unchanged(operation, pattern) { const before = counts(); assert.throws(operation, pattern); assert.deepEqual(counts(), before); }
function readTarget(target) { const { tool, ...input } = target; assert.equal(tool, "context"); return read(root, input); }
function allContent(input) {
  let page = read(root, { ...input, section: "content", limit: 12000 }), result = page.body;
  const first = page;
  while (page.next_offset !== null) {
    assert(page.body.length <= 12000);
    assert(!("payload" in page));
    const { tool, ...target } = page.read;
    page = read(root, target); result += page.body;
  }
  return { text: result, first };
}
try {
  // K1: strict pure validators precede any reads/approval; no UI/evidence is not authority.
  for (const input of [
    { action: "create", fields: fields("bad"), key: "k", id: randomUUID() },
    { action: "history", id: randomUUID(), key: "k" },
    { action: "update", id: randomUUID(), expected_revision: 1, fields: { sources: [] }, change_note: "bad", key: "k" },
    { action: "create", fields: { ...fields("bad"), related_context: "not writable" }, key: "k" },
    { action: "create", fields: { ...fields("bad"), sources: [{ id: randomUUID(), citation: "invented id" }] }, key: "k" },
  ]) assert.throws(() => validateKnowledgeInput(input));
  for (const input of [
    { action: "status", kind: "project" }, { action: "read", kind: "project", selector: "p", offset: 0 },
    { action: "read", kind: "knowledge", id: "a", view: "full" }, { action: "read", kind: "knowledge", id: "a", limit: 1 },
    { action: "search", query: "q", include_closed: true }, { action: "attach", selector: "p", kind: "project" },
  ]) assert.throws(() => validateContextInput(input));
  await create(root, "project", "Origin project", "Original goal");
  unchanged(() => kb(root, { action: "create", fields: fields("No authority"), key: "no-authority", approval_evidence: authority.approval_evidence }), /authority|approval/);
  unchanged(() => kb(root, { action: "create", fields: fields("No evidence"), key: "no-evidence", approval_evidence: authority.approval_evidence }, { session_id: "non-ui" }), /approval|confirmation/);
  const project = (await list(root))[0];
  const beforeProject = structuredClone(project.todo);
  const long = `Original correction spot\n${"unread-tail-".repeat(3700)}\nUNREAD END`;
  const createInput = { action: "create", fields: { ...fields("Long knowledge", long), sources: [{ citation: "Synthetic source A", note: "Old note", verified_at: "2026-01-01T00:00:00Z" }, { citation: "Synthetic source B" }] }, key: "replay-create", approval_evidence: authority.approval_evidence };
  const attached = { ...authority, session_project_id: project.todo.id };
  const first = kb(root, createInput, attached);
  assert.equal(first.accepted_revision, 1);
  assert.equal(document(first.id).provenance.session_project_id, project.todo.id);
  assert.equal(listLinks(root, { endpoint: { kind: "knowledge", id: first.id } }).items.length, 0, "Attachment is provenance, not inferred origin");
  assert.deepEqual((await locate(root, project.todo.id)).todo, beforeProject, "KB does not start or rewrite a project");
  const full = allContent({ id: first.id });
  assert(full.text.includes("UNREAD END"));
  assert.match(full.first.version, new RegExp(`^knowledge/${first.id}/1/[a-f0-9]{64}$`));
  assert.equal(full.first.version.split("/").at(-1), createHash("sha256").update(full.text, "utf8").digest("hex"), "Hash covers complete rendering, not first page");
  for (const section of ["## Knowledge", "## Scope and limits", "## Sources", "## Related context"]) assert(full.text.includes(section));
  const summary = read(root, { id: first.id.slice(0, 8) });
  assert.equal(summary.section, "summary"); assert(!JSON.stringify(summary).includes("UNREAD END"));
  assert.equal(summary.section_sizes.explanation, long.length);
  assert.throws(() => read(root, { id: "Long knowledge" }), /UUID|prefix/);
  assert.throws(() => read(root, { id: first.id, section: "summary", offset: 0 }), /paging/);
  assert.throws(() => read(root, { id: first.id, section: "content", offset: 1 }), /expected_version/);

  // K2: scalar/source/targeted corrections preserve unread tails, IDs, review assertions and history.
  const [sourceA, sourceB] = document(first.id).payload.sources;
  const updateInput = { action: "update", id: first.id, expected_revision: 1, fields: { summary: "Corrected summary" }, sources: { update: [{ id: sourceA.id, citation: "Corrected source A" }], remove: [sourceB.id], add: [{ citation: "New source C", verified_at: "2026-02-01T00:00:00Z" }] }, explanation_edits: [{ old_text: "Original correction spot", new_text: "Corrected spot" }], change_note: "Partial correction only", key: "replay-update" };
  const updated = kb(root, updateInput, authority);
  const after = document(first.id);
  assert.equal(updated.accepted_revision, 2);
  assert.equal(after.payload.explanation, long.replace("Original correction spot", "Corrected spot"));
  assert.equal(after.payload.sources[0].id, sourceA.id);
  assert.deepEqual(after.payload.sources[0], { id: sourceA.id, citation: "Corrected source A" }, "Source update is complete replacement; optional fields clear");
  assert(!after.payload.sources.some(s => s.id === sourceB.id)); assert.notEqual(after.payload.sources[1].id, sourceB.id);
  write({ action: "review", id: first.id, expected_revision: 2, checked: "Synthetic review of scope and source assertions" });
  const reviewed = document(first.id).last_reviewed;
  write({ action: "update", id: first.id, expected_revision: 3, fields: { limits: "Synthetic limit" }, change_note: "Wording only" });
  assert.deepEqual(document(first.id).last_reviewed, reviewed);
  assert.equal(document(first.id).payload.sources[1].verified_at, "2026-02-01T00:00:00Z", "Ordinary wording/review preserves source assertions");
  assert.throws(() => readTarget(full.first.read), /changed.*restart/);
  const beforeReplay = counts();
  assert.deepEqual(kb(root, createInput, attached), { ...first, current_revision: 4 });
  assert.deepEqual(kb(root, createInput, authority), { ...first, current_revision: 4 }, "Attachment is transient metadata, not part of retry digest");
  assert.deepEqual(kb(root, updateInput, authority), { ...updated, current_revision: 4 });
  assert.deepEqual(counts(), beforeReplay);
  assert.equal(preflightOperation(root, updateInput.action, updateInput, authority, updateInput.key).id, first.id, "Adapter preflight and write digest agree");
  unchanged(() => kb(root, { ...createInput, fields: fields("changed") }, attached), /key reused/);
  unchanged(() => kb(root, { action: "review", id: first.id, expected_revision: 4, checked: "collision", key: createInput.key }, authority), /key reused/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 1, fields: { title: "stale" }, change_note: "stale" }), /Stale/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, explanation_edits: [{ old_text: "unread-tail-", new_text: "ambiguous" }], change_note: "ambiguous" }), /exactly once/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, explanation_edits: [{ old_text: "Corrected spot", new_text: "A" }, { old_text: "spot", new_text: "B" }], change_note: "overlap" }), /overlap/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, fields: { explanation: "replacement" }, explanation_edits: [{ old_text: "Corrected spot", new_text: "A" }], change_note: "both" }), /combine/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, fields: { title: document(first.id).payload.title }, change_note: "no change" }), /Empty/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, sources: { remove: [randomUUID()] }, change_note: "unknown source" }), /Unknown source/);
  unchanged(() => write({ action: "update", id: first.id, expected_revision: 4, sources: { update: [{ id: sourceA.id, citation: "A" }], remove: [sourceA.id] }, change_note: "conflict" }), /conflicting/);
  const exact = write({ action: "create", fields: fields("Original edits", "alpha beta unread suffix") });
  write({ action: "update", id: exact.id, expected_revision: 1, explanation_edits: [{ old_text: "alpha", new_text: "beta" }, { old_text: "beta", new_text: "gamma" }], change_note: "Match original, not earlier replacements" });
  assert.equal(document(exact.id).payload.explanation, "beta gamma unread suffix");
  unchanged(() => write({ action: "update", id: exact.id, expected_revision: 2, explanation_edits: [{ old_text: "beta gamma unread suffix", new_text: "" }], change_note: "Cannot delete complete explanation" }), /explanation/);
  unchanged(() => write({ action: "update", id: exact.id, expected_revision: 2, fields: { explanation: "x".repeat(100001) }, change_note: "Bounds" }), /explanation/);
  const confirmedInput = { action: "create", fields: fields("Native-confirmed domain call"), key: "native-confirmed" };
  const confirmed = kb(root, confirmedInput, { session_id: "synthetic-native-session", confirmed: true });
  assert.deepEqual(kb(root, confirmedInput, { session_id: "synthetic-native-session" }), confirmed, "Confirmed flag is transient and accepted replay requires no repeated approval");
  const controller = new AbortController(); controller.abort();
  unchanged(() => kb(root, { action: "create", fields: fields("canceled"), key: "canceled" }, authority, controller.signal));
  const history = kb(root, { action: "history", id: first.id, limit: 2 });
  assert.deepEqual(history.items.map(i => i.revision), [4, 3]);
  const older = kb(root, { action: "history", id: first.id, limit: 2, cursor: history.next_cursor });
  assert.deepEqual(older.items.map(i => i.revision), [2, 1]);
  assert.equal(readTarget(older.items[1].read).version, `knowledge/${first.id}/1/core`);
  assert.equal(allContent({ id: first.id, revision: 1 }).text.includes(long), true);

  // Explicit extraction validates a real committed artifact version and creates one atomic origin link.
  const artifactItem = await saveArtifact(root, project.todo.id, project.todo.revision, { title: "Origin research", kind: "research", description: "Synthetic origin", lifecycle: "current", required: false, applies_to: [], body: "Committed source body" });
  const artifact = artifactItem.todo.artifacts[0];
  unchanged(() => write({ action: "create", fields: fields("Invalid origin"), origin: { project_id: project.todo.id, artifact_id: artifact.id, artifact_version: `artifacts/${artifact.id}-999.md` } }), /actual committed/);
  const origin = write({ action: "create", fields: fields("Extracted knowledge"), origin: { project_id: project.todo.id, artifact_id: artifact.id, artifact_version: artifact.path } });
  assert.equal(listLinks(root, { endpoint: { kind: "knowledge", id: origin.id } }).items[0].relation, "originated-in");
  assert.equal(document(origin.id).provenance.origin.artifact_version, artifact.path);
  assert.equal((await locate(root, project.todo.id)).todo.revision, artifactItem.todo.revision);

  // Historical core remains immutable; current page token includes bounded dynamic neighbor summaries.
  const historicalBefore = allContent({ id: first.id, revision: 4 });
  const beforeLinks = read(root, { id: first.id, section: "content", limit: 90 });
  const linkInput = { action: "link", from: { kind: "knowledge", id: first.id }, to: { kind: "knowledge", id: origin.id }, relation: "uses", reason: "Synthetic relationship", key: "neighbor-link" };
  const linked = writeLink(root, linkInput, authority);
  assert.throws(() => readTarget(beforeLinks.read), /changed.*restart/);
  const beforeNeighbor = read(root, { id: first.id, section: "content", limit: 90 });
  write({ action: "update", id: origin.id, expected_revision: 1, fields: { title: "Renamed neighbor" }, change_note: "Rename" });
  assert.throws(() => readTarget(beforeNeighbor.read), /changed.*restart/);
  const beforeReason = read(root, { id: first.id, section: "content", limit: 90 });
  writeLink(root, { action: "update_reason", id: linked.id, expected_revision: 1, reason: "Updated reason", key: "reason-edit" }, authority);
  assert.throws(() => readTarget(beforeReason.read), /changed.*restart/);
  assert.equal(allContent({ id: first.id, revision: 4 }).text, historicalBefore.text);
  assert.equal(read(root, { id: first.id, section: "content", revision: 4 }).version, `knowledge/${first.id}/4/core`, "Explicit current revision is immutable core too");
  const replacement = write({ action: "create", fields: fields("Current replacement") });
  const beforeSupersession = read(root, { id: first.id, section: "content", limit: 90 });
  write({ action: "supersede", id: origin.id, expected_revision: 2, replacement_id: replacement.id, change_note: "Synthetic replacement" });
  assert.throws(() => readTarget(beforeSupersession.read), /changed.*restart/);
  unchanged(() => write({ action: "update", id: origin.id, expected_revision: 3, fields: { title: "forbidden" }, change_note: "forbidden" }), /Superseded/);
  unchanged(() => write({ action: "supersede", id: replacement.id, expected_revision: 1, replacement_id: origin.id, change_note: "cycle" }), /different current/);
  assert.equal(listLinks(root, { endpoint: { kind: "knowledge", id: origin.id } }).items.length, 2, "Supersession retains incoming and origin links");

  // Bounded Related context is navigation, not recursive neighbor content.
  for (let n = 0; n < 21; n++) {
    const neighbor = write({ action: "create", fields: fields(`Neighbor ${n}`, "SECRET NEIGHBOR BODY") });
    writeLink(root, { action: "link", from: { kind: "knowledge", id: first.id }, to: { kind: "knowledge", id: neighbor.id }, relation: "related", reason: `Reason ${n}`, key: `bounded-${n}` }, authority);
  }
  const navigation = read(root, { id: first.id });
  assert.equal(navigation.links.items.length, 20); assert(navigation.links.next_cursor);
  assert(!allContent({ id: first.id }).text.includes("SECRET NEIGHBOR BODY"));
  const nextLinks = listLinks(root, { endpoint: navigation.links.read.endpoint, direction: "both", cursor: navigation.links.read.cursor });
  assert.equal(nextLinks.items.length, 2);
  const prefixes = new Map();
  for (const item of (await context(root, { action: "list", kind: "knowledge", limit: 50, include_closed: true })).items) prefixes.set(item.id[0], (prefixes.get(item.id[0]) ?? 0) + 1);
  const ambiguous = [...prefixes].find(([, count]) => count > 1)[0];
  assert.throws(() => read(root, { id: ambiguous }), /Ambiguous/);

  // D1/P1: real direct scope, literal ranking, best-per-entity, provenance and positioned native readers.
  const consumer = await create(root, "project", "Consumer", "Scoped source lookup");
  const grounded = await create(root, "project", "Grounded", "Grounded goal");
  const associated = await create(root, "project", "Ordinary neighbor", "No body scope");
  const artifactOnly = await create(root, "project", "Artifact-only", "Do not search this goal");
  async function evidence(item, value) {
    return mutate(root, item.todo.id, item.todo.revision, todo => { todo.current_state.evidence.push({ id: randomUUID(), text: value }); return todo; });
  }
  const groundedWithRecord = await mutate(root, grounded.todo.id, grounded.todo.revision, todo => {
    todo.current_state.evidence.push(...Array.from({ length: 25 }, (_, n) => ({ id: randomUUID(), text: `Prefix ${"x".repeat(1000)} SCOPE.NEEDLE grounded record ${n}` })));
    return todo;
  });
  await evidence(associated, "SCOPE.NEEDLE ordinary neighbor body");
  const artifactOnlyWithRecord = await evidence(artifactOnly, "SCOPE.NEEDLE excluded artifact-only records");
  const artifactSource = await saveArtifact(root, artifactOnly.todo.id, artifactOnlyWithRecord.todo.revision, { title: "Referenced document", description: "Synthetic source", kind: "design", lifecycle: "current", required: false, applies_to: [], body: `${"z".repeat(15000)} SCOPE.NEEDLE referenced document` });
  const otherSource = await saveArtifact(root, artifactOnly.todo.id, artifactSource.todo.revision, { title: "Unreferenced document", description: "Not in scope", kind: "design", lifecycle: "current", required: false, applies_to: [], body: "SCOPE.NEEDLE unreferenced document" });
  const groundedArtifact = await saveArtifact(root, grounded.todo.id, groundedWithRecord.todo.revision, { title: "Grounding-only document", description: "Not enrolled by grounding", kind: "research", lifecycle: "current", required: false, applies_to: [], body: "SCOPE.NEEDLE excluded grounding document" });
  let consumerRevision = consumer.todo.revision;
  for (const reference of [
    { kind: "project-grounding", source_project_id: grounded.todo.id, reason: "Direct grounding" },
    { kind: "artifact", source_owner_id: artifactOnly.todo.id, artifact_id: artifactSource.todo.artifacts[0].id, follow: "current", requirement: "source", reason: "Individual artifact" },
  ]) { const saved = writeReference(root, { action: "reference_add", project_id: consumer.todo.id, expected_revision: consumerRevision, reference, key: `ref-${consumerRevision}` }, authority); consumerRevision = saved.accepted_revision; }
  writeLink(root, { action: "link", from: { kind: "project", id: consumer.todo.id }, to: { kind: "project", id: associated.todo.id }, relation: "related", reason: "Association is not scope", key: "association" }, authority);
  const scopedKB = write({ action: "create", fields: fields("SCOPE.NEEDLE", "Linked library body SCOPE.NEEDLE") });
  const unlinkedKB = write({ action: "create", fields: fields("Unlinked library", "SCOPE.NEEDLE excluded unlinked") });
  writeLink(root, { action: "link", from: { kind: "knowledge", id: scopedKB.id }, to: { kind: "project", id: consumer.todo.id }, relation: "related", reason: "Direct KB scope", key: "scoped-kb" }, authority);
  // Mutual grounding does not recurse into a source's own references or artifacts.
  writeReference(root, { action: "reference_add", project_id: grounded.todo.id, expected_revision: groundedArtifact.todo.revision, reference: { kind: "project-grounding", source_project_id: consumer.todo.id, reason: "Mutual but one-hop" }, key: "mutual" }, authority);
  const scoped = await context(root, { action: "search", query: "SCOPE.NEEDLE", scope_project_id: consumer.todo.id, limit: 20 });
  assert.equal(scoped.results[0].id, scopedKB.id, "Exact title outranks body matches");
  assert.deepEqual(new Set(scoped.results.map(r => r.id)), new Set([scopedKB.id, grounded.todo.id, artifactOnly.todo.id]));
  assert.equal(scoped.results.length, 3, "Best source per entity across more than one project-memory page");
  const memoryPage = await searchKnowledge(root, { query: "SCOPE.NEEDLE", selector: consumer.todo.id, limit: 20 });
  assert.equal(memoryPage.results.length, 20); assert(memoryPage.next_cursor);
  const memoryNext = await searchKnowledge(root, { query: "SCOPE.NEEDLE", selector: consumer.todo.id, limit: 20, cursor: memoryPage.next_cursor });
  assert.equal(memoryNext.results.length, 6); assert.equal(memoryNext.next_cursor, null);
  const recordHit = scoped.results.find(r => r.id === grounded.todo.id);
  assert.equal(recordHit.read.tool, "todo_record"); assert(recordHit.read.offset > 0);
  assert((await readRecordPage(root, recordHit.read)).body.includes("SCOPE.NEEDLE grounded record"));
  const artifactHit = scoped.results.find(r => r.id === artifactOnly.todo.id);
  assert.equal(artifactHit.read.tool, "todo_artifact"); assert.equal(artifactHit.read.artifact_id, artifactSource.todo.artifacts[0].id);
  assert((await readArtifactPage(root, await locate(root, artifactHit.read.id), artifactHit.read.artifact_id, artifactHit.read.offset, undefined, artifactHit.read.expected_version)).body.includes("SCOPE.NEEDLE referenced document"));
  assert(readTarget(scoped.results[0].read).body.includes("SCOPE.NEEDLE"));
  const global = await context(root, { action: "search", query: "SCOPE.NEEDLE", limit: 20 });
  assert(global.results.some(r => r.id === unlinkedKB.id)); assert(global.results.some(r => r.id === associated.todo.id));
  const literal = await context(root, { action: "search", query: ".NEEDLE", kind: "knowledge", limit: 20 }); assert(literal.results.length >= 2, "Punctuation is literal, not stripped");
  const noMatch = await context(root, { action: "search", query: "scope needle" }); assert.equal(noMatch.results.length, 0);
  const searchedFull = await context(root, { action: "search", kind: "knowledge", query: "Renamed neighbor", view: "full", limit: 20 });
  assert(searchedFull.results.some(r => r.id === origin.id && r.replacement_id === replacement.id));
  const searchedActive = await context(root, { action: "search", kind: "knowledge", query: "Renamed neighbor", limit: 20 }); assert(!searchedActive.results.some(r => r.id === origin.id));
  const discoveryPage = await context(root, { action: "list", kind: "all", include_closed: true, limit: 2 });
  assert.equal(discoveryPage.items.length, 2); assert(discoveryPage.items.every(i => i.kind === "project"));
  await assert.rejects(context(root, { action: "list", kind: "knowledge", include_closed: true, limit: 2, cursor: discoveryPage.next_cursor }), /restart/);
  const searchPage = await context(root, { action: "search", query: "Synthetic", kind: "knowledge", limit: 1 });
  assert(searchPage.next_cursor);
  await assert.rejects(context(root, { action: "search", query: "different", kind: "knowledge", limit: 1, cursor: searchPage.next_cursor }), /restart/);
  const anchor = searchPage.results[0];
  write({ action: "supersede", id: anchor.id, expected_revision: document(anchor.id).revision, replacement_id: replacement.id === anchor.id ? first.id : replacement.id, change_note: "Remove active search anchor" });
  await assert.rejects(context(root, { action: "search", query: "Synthetic", kind: "knowledge", limit: 1, cursor: searchPage.next_cursor }), /anchor.*restart/);
  const freshConsumer = await locate(root, consumer.todo.id);
  assert.deepEqual(await context(root, { action: "read", kind: "project", selector: consumer.todo.id, view: "full" }), effects(await list(root), freshConsumer));
  assert.deepEqual((await context(root, { action: "read", kind: "project", selector: consumer.todo.id })).todo, compact(freshConsumer.todo));
  assert.equal((await locate(root, consumer.todo.id)).todo.revision, consumerRevision, "Discovery did not attach, start or revise anything");
  const completed = await mutate(root, associated.todo.id, (await locate(root, associated.todo.id)).todo.revision, todo => { todo.status = "done"; return todo; });
  assert(!(await context(root, { action: "list", kind: "project", limit: 50 })).items.some(i => i.id === completed.todo.id));
  assert((await context(root, { action: "list", kind: "project", include_closed: true, limit: 50 })).items.some(i => i.id === completed.todo.id));
  assert((await context(root, { action: "search", query: "Ordinary neighbor", kind: "project" })).results.some(i => i.id === completed.todo.id), "Search includes completed projects");
  console.log("PASS Context library/discovery: pure imports, strict validation/authority, atomic revisions/replay, partial corrections/sources/history, origins, immutable/current paging and direct-scope discovery");
} finally { rmSync(scratch, { recursive: true, force: true }); }
