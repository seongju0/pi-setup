// Run from the repository root: npm test. Direct: node agent/extensions/context/tests/test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile, stat, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configuredRoot, create, digest, list, locate, readKnown, checkpoint, mutate, move } from "../storage.ts";
import { DatabaseSync } from "node:sqlite";
import { artifactBytes, withRead, withWrite } from "../database.ts";
import { inspect, rehearse, cutover, verify } from "../migration.ts";
import { applyChanges, evidenceId, needsApproval, validate } from "../state.ts";
import { createTodo, validate as validateLegacy } from "../legacy-state.ts";
import { normalizeLegacy } from "../sqlite-upgrade.ts";
import { writeReference } from "../links.ts";
import { readArtifact, saveArtifact } from "../artifacts.ts";
import { tighten } from "../tightening.ts";
import { prepareArtifactDelegation, readDelegatedArtifactPage, validateArtifactDelegation } from "../delegation.ts";
import { restoreSelection, resumeBundle, selectionEntry, checkpointMessage } from "../session.ts";
import { compactionEntry, acknowledgementEntry, pendingReconciliation, preservationType, preservationState } from "../compaction.ts";

const scratch = await mkdtemp(join(tmpdir(), "pi-todo-test-"));
const root = join(scratch, "todos");
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const { estimateTokens } = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/core/session-manager.js")));
const themeModule = await import(pathToFileURL(join(packageRoot, "dist/modes/interactive/theme/theme.js")));
const { visibleWidth } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")));
themeModule.initTheme("dark", false);
const { validateToolArguments } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/utils/validation.js")));
const oldRoot = process.env.PI_TODO_PATH;
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_TODO_PATH = root;
process.env.PI_CODING_AGENT_DIR = scratch;

function itemRoot(item) { return item.parent_id ? dirname(dirname(dirname(item.directory))) : dirname(item.directory); }
function savedJSON(item) { return withRead(itemRoot(item), db => db.prepare("SELECT document FROM owners WHERE id=?").get(item.todo.id).document); }
function replaceJSON(item, value) { return withWrite(itemRoot(item), db => db.prepare("UPDATE owners SET document=? WHERE id=?").run(value, item.todo.id)); }
function bodyBytes(item, version) { return withRead(itemRoot(item), db => artifactBytes(db, item.todo.id, version)); }
function removeBody(item, version) { return withWrite(itemRoot(item), db => db.prepare("DELETE FROM artifact_revisions WHERE owner_id=? AND version=?").run(item.todo.id, version)); }
function restoreBody(item, version, bytes) { return withWrite(itemRoot(item), db => db.prepare("INSERT INTO artifact_revisions(owner_id,version,body) VALUES(?,?,?)").run(item.todo.id, version, Buffer.from(bytes))); }

async function instance(branch = [], interactive = false, deferMessages = false, persistentSession = false) {
  const runtime = createExtensionRuntime();
  const stored = [...branch]; const warnings = []; const statuses = []; const confirmations = []; const selects = []; const inputs = []; const editors = []; const panels = []; const customSteps = [];
  runtime.getSettings = () => ctx.settings ?? {};
  runtime.appendEntry = (customType, data) => stored.push({ type: "custom", customType, data });
  const pending = [];
  runtime.sendMessage = (message) => (deferMessages ? pending : stored).push({ type: "custom_message", ...message });
  const flush = () => stored.push(...pending.splice(0));
  runtime.sendUserMessage = (content) => stored.push({ type: "user_request", content });
  const loaded = await loadExtensions([join(directory, "index.ts")], scratch, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find(extension => extension.tools.has("context_project"));
  const ctx = {
    cwd: scratch, hasUI: interactive, mode: interactive ? "tui" : "print", tools: [], waitForIdle: async () => {},
    sessionManager: { getSessionId: () => "test-session", getBranch: () => stored, buildContextEntries: () => stored, getSessionFile: () => persistentSession ? join(scratch, "combined.jsonl") : undefined },
    ui: {
      notify: text => warnings.push(text), setStatus: (_, text) => statuses.push(text), setWidget() {}, confirm: async () => confirmations.shift() ?? false,
      select: async (title, labels) => { panels.push({ title, labels }); const choice = selects.shift(); return typeof choice === "number" ? labels[choice] : choice; },
      input: async () => inputs.shift(), editor: async () => editors.shift(),
      custom: async (factory, options) => new Promise(resolve => {
        assert.equal(options.overlay, true);
        const terminal = { rows: 36 };
        const component = factory({ terminal, requestRender() {} }, themeModule.theme, {}, resolve);
        for (const width of [12, 40, 80, 120]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
        component.invalidate();
        panels.push({ component, terminal });
        const step = customSteps.shift();
        if (step) step(component, terminal); else component.handleInput("\x1b");
      }),
    },
    abort: () => { ctx.aborted = true; },
  };
  const emit = async (type, fields = {}) => {
    const results = [];
    let messages = fields.messages;
    for (const owner of loaded.extensions) for (const handler of owner.handlers.get(type) ?? []) {
      const result = await handler({ type, ...fields, ...(messages ? { messages } : {}) }, ctx);
      results.push(result);
      if (type === "context" && result?.messages) messages = result.messages;
      // Pi persists before-agent messages before context hooks; sendMessage may still be queued.
      if (type === "before_agent_start" && result?.message) stored.push({ type: "custom_message", ...result.message, timestamp: 9000 + stored.length });
    }
    return type === "context" ? [{ messages }] : results;
  };
  const callRaw = async (name, params, context = ctx) => {
    const tool = loaded.extensions.find(owner => owner.tools.has(name)).tools.get(name).definition;
    const args = validateToolArguments(tool, { id: "check", name, arguments: params });
    return tool.execute("check", args, undefined, undefined, context);
  };
  const call = async (...args) => (await callRaw(...args)).structuredContent;
  await emit("session_start");
  return { call, callRaw, emit, stored, flush, warnings, statuses, confirmations, selects, inputs, editors, panels, customSteps, ctx, extension };
}
try {
  delete process.env.PI_TODO_PATH;
  assert.equal(configuredRoot(), join(homedir(), ".pi", "agent", "todos"));
  process.env.PI_TODO_PATH = root;
  assert.equal(configuredRoot(), root);
  // Real loader + reader + SQLite: only fixed artifact targets, no full Context registration.
  {
    const root = join(scratch, "reader-store"); process.env.PI_TODO_PATH = root;
    const readerOwner = await create(root, "project", "Reader owner", "Synthetic assigned sources");
    const readerOther = await create(root, "project", "Reader other", "Unrelated source");
    const readerMetadata = { title: "untrusted-reader-title", kind: "design", description: "untrusted-reader-description", lifecycle: "current", required: false, applies_to: [] };
    let assigned = await saveArtifact(root, readerOwner.todo.id, 1, { ...readerMetadata, body: "assigned-page-".repeat(2000) });
    assigned = await saveArtifact(root, readerOwner.todo.id, assigned.todo.revision, { ...readerMetadata, lifecycle: "reference", body: "retained historical supporting body" });
    assigned = await saveArtifact(root, readerOwner.todo.id, assigned.todo.revision, { ...readerMetadata, body: "UNRELATED-SAME-OWNER" });
    const otherDoc = await saveArtifact(root, readerOther.todo.id, 1, { ...readerMetadata, body: "UNRELATED-CROSS-OWNER" });
    const targets = assigned.todo.artifacts.slice(0, 2).map(a => ({ id: readerOwner.todo.id, artifact_id: a.id, expected_version: a.path }));
    const delegation = prepareArtifactDelegation(targets);
    assert.throws(() => prepareArtifactDelegation([]), /nonempty/);
    assert.throws(() => prepareArtifactDelegation([...targets, targets[0]]), /Duplicate/);
    assert.throws(() => prepareArtifactDelegation([{ ...targets[0], expected_version: "../bad" }]), /expected_version/);
    assert.throws(() => prepareArtifactDelegation([{ ...targets[0], id: targets[0].id.slice(0, 8) }]), /UUID/);
    assert.throws(() => prepareArtifactDelegation([{ ...targets[0], expected_version: `artifacts/${"a".repeat(2000)}-1.md` }]), /expected_version/);
    assert.throws(() => prepareArtifactDelegation([{ ...targets[0], id: "00000000-0000-0000-0000-000000000000" }]), /unavailable/);
    const retainedBytes = bodyBytes(readerOwner, targets[1].expected_version);
    removeBody(readerOwner, targets[1].expected_version);
    assert.throws(() => prepareArtifactDelegation([targets[1]]), /Missing current artifact body/);
    restoreBody(readerOwner, targets[1].expected_version, retainedBytes);
    const readerWrapper = join(scratch, "reader.ts");
    await writeFile(readerWrapper, `import { scopedArtifactReader } from ${JSON.stringify(join(directory, "reader.ts"))}; export default scopedArtifactReader(${JSON.stringify(delegation)});`);
    const readerRuntime = createExtensionRuntime();
    const readerLoaded = await loadExtensions([readerWrapper], scratch, undefined, readerRuntime);
    assert.deepEqual(readerLoaded.errors, []);
    const readerExtension = readerLoaded.extensions[0];
    assert.deepEqual([...readerExtension.tools.keys()], ["context_project_artifact"]);
    assert.equal(readerExtension.handlers.size, 0); assert.equal(readerExtension.commands.size, 0);
    const readerTool = readerExtension.tools.get("context_project_artifact").definition;
    const readerCall = async input => readerTool.execute("reader", validateToolArguments(readerTool, { id: "reader", name: readerTool.name, arguments: { action: "read", ...input } }), undefined, undefined, {});
    for (const bad of [{ action: "upsert", ...targets[0] }, { id: targets[0].id, artifact_id: targets[0].artifact_id }, { ...targets[0], root }]) {
      await assert.rejects(readerCall(bad));
    }
    const logicalReaderState = () => withRead(root, db => JSON.stringify([db.prepare("SELECT * FROM owners ORDER BY id").all(), db.prepare("SELECT owner_id,version,hex(body) body FROM artifact_revisions ORDER BY owner_id,version").all(), db.prepare("SELECT * FROM context_operations").all()]));
    const beforeReader = logicalReaderState();
    let assembled = "", readerOffset = 0;
    do {
      const result = await readerCall({ ...targets[0], offset: readerOffset });
      const page = result.structuredContent;
      assert.equal(result.content[0].text.split("\n\n").slice(1).join("\n\n"), page.body);
      assert.deepEqual(result.details, page); assert(page.body.length <= 12000);
      assembled += page.body; readerOffset = page.next_offset;
    } while (readerOffset !== null);
    assert.equal(assembled, "assigned-page-".repeat(2000) + "\n");
    assert.equal((await readerCall(targets[1])).structuredContent.body, "retained historical supporting body\n");
    for (const denied of [{ ...targets[0], artifact_id: assigned.todo.artifacts[2].id }, { ...targets[0], id: readerOther.todo.id, artifact_id: otherDoc.todo.artifacts[0].id }, { ...targets[0], expected_version: targets[1].expected_version }]) {
      await assert.rejects(readerCall(denied), /outside the assigned scope/);
      assert.throws(() => readDelegatedArtifactPage(delegation, denied), /outside the assigned scope/);
    }
    assert.equal(logicalReaderState(), beforeReader);
    await checkpoint(root, readerOther.todo.id, otherDoc.todo.revision, { title: "unrelated update" }, "reader-other", "reader-session");
    assigned = await saveArtifact(root, readerOwner.todo.id, assigned.todo.revision, { ...readerMetadata, id: targets[0].artifact_id, title: "Metadata only" });
    assert.equal((await readerCall(targets[0])).structuredContent.body, assembled.slice(0, 12000));
    assigned = await saveArtifact(root, readerOwner.todo.id, assigned.todo.revision, { ...readerMetadata, id: targets[0].artifact_id, body: "NEW-BYTES-MUST-NOT-LEAK" });
    for (const offset of [0, 12000]) await assert.rejects(readerCall({ ...targets[0], offset }), /changed.*parent/);
    assert.throws(() => prepareArtifactDelegation(targets), /changed/);
    assert.deepEqual(validateArtifactDelegation(delegation), delegation, "registration/reopen validation is pure, not a freshness check");
  }
  process.env.PI_TODO_PATH = root;
  const project = await create(root, "project", "Rollout", "Complete the rollout");
  assert.deepEqual(project.todo.current_state, { evidence: [] });
  assert.equal("next_actions" in project.todo, false);
  const child = await create(root, "simple", "Migrate", "Convert unresolved work", undefined);
  const sibling = await create(root, "simple", "Observe", "Validate operations", undefined);
  await assert.rejects(create(root, "project", "Nested", "No", project.todo.id), /retired|association/i);
  await assert.rejects(create(root, "simple", "Grandchild", "No", child.todo.id), /retired|association/i);
  assert.deepEqual((await list(root)).map(row => row.todo.id), [project.todo.id, child.todo.id, sibling.todo.id].sort());
  await assert.rejects(stat(project.directory), /ENOENT/); // No owner folders or canonical Markdown files.
  const changes = { evidence: { add: ["Converter tested", "https://example.com/pr/1"] }, decisions: [{ summary: "Preserve IDs", rationale: "Avoid duplicate work", approval: "draft", evidence: [] }] };
  const updated = await checkpoint(root, child.todo.id, 1, changes, "checkpoint-1", "test-session");
  assert.equal(updated.todo.revision, 2);
  assert.equal(updated.todo.status, "in_progress");
  assert.equal((await locate(root, project.todo.id)).todo.status, "todo"); // No associated-project rollup.
  assert.equal((await locate(root, sibling.todo.id)).todo.status, "todo");
  assert.deepEqual((await checkpoint(root, child.todo.id, 1, changes, "checkpoint-1", "test-session")).todo, updated.todo);
  await assert.rejects(checkpoint(root, child.todo.id, 2, {}, "checkpoint-1", "test-session"), /different content/);
  await assert.rejects(checkpoint(root, child.todo.id, 1, {}, "checkpoint-2", "test-session"), /Stale revision/);
  assert.equal((await stat(join(root, "todo.sqlite"))).mode & 0o777, 0o600);
  const approved = applyChanges(updated.todo, { decisions: [{ ...updated.todo.decisions[0], approval: "approved" }] });
  assert.ok(needsApproval(updated.todo, { outcome: "Different outcome" }));
  assert.ok(needsApproval(approved, { decisions: [{ summary: "New direction", rationale: "Changed evidence", approval: "draft", evidence: [], supersedes: approved.decisions[0].id }] }));
  assert.throws(() => applyChanges(updated.todo, { surprise: true }), /unknown/);

  const metadata = { title: "Migration design", kind: "design", description: "Conversion contracts", lifecycle: "current", required: true, applies_to: [], body: "# Migration\n\nPreserve IDs." };
  await checkpoint(root, project.todo.id, 1, {}, "project-empty", "test-session");
  const withArtifact = await saveArtifact(root, project.todo.id, 2, metadata);
  const artifact = withArtifact.todo.artifacts[0];
  assert.equal((await resumeBundle(root, child.todo.id)).required_artifacts.length, 0);
  assert.equal((await resumeBundle(root, sibling.todo.id)).required_artifacts.length, 0);
  assert.equal((await resumeBundle(root, project.todo.id)).required_artifacts.length, 1);
  const revised = await saveArtifact(root, project.todo.id, 3, { ...metadata, id: artifact.id, body: "# Revised design" });
  assert.notEqual(revised.todo.artifacts[0].path, artifact.path);
  assert.match(bodyBytes(project, artifact.path).toString("utf8"), /Preserve IDs/);
  await assert.rejects(saveArtifact(root, child.todo.id, 2, { ...metadata, applies_to: [sibling.todo.id] }), /context.*ref|applies_to/i);
  const childArtifact = await saveArtifact(root, child.todo.id, 2, { ...metadata, applies_to: [], required: false });
  assert.match(await readArtifact(root, childArtifact, childArtifact.todo.artifacts[0].id), /Preserve IDs/);
  const beforeInvalid = await savedJSON(child);
  const beforeInvalidBodies = withRead(root, db => db.prepare("SELECT count(*) AS n FROM artifact_revisions").get().n);
  await assert.rejects(saveArtifact(root, child.todo.id, 3, { ...metadata, kind: "runbook", applies_to: [] }), /research or design/);
  await assert.rejects(saveArtifact(root, child.todo.id, 3, { ...metadata, applies_to: [], lifecycle: "superseded", required: true }), /Only current/);
  assert.equal(await savedJSON(child), beforeInvalid);
  await assert.rejects(saveArtifact(root, child.todo.id, 1, { ...metadata, applies_to: [] }), /Stale revision/);
  assert.equal(withRead(root, db => db.prepare("SELECT count(*) AS n FROM artifact_revisions").get().n), beforeInvalidBodies);

  // Cross-process locking, abort safety, and path confinement.
  const held = new DatabaseSync(join(root, "todo.sqlite")); held.exec("BEGIN IMMEDIATE");
  try {
    const script = `import { checkpoint } from ${JSON.stringify(pathToFileURL(join(directory, "storage.ts")).href)}; try { await checkpoint(${JSON.stringify(root)}, ${JSON.stringify(child.todo.id)}, 3, {}, 'parallel', 'other'); process.exit(1); } catch(e) { if (!e.message.includes('busy')) throw e; }`;
    const worker = spawn(process.execPath, ["--input-type=module", "-e", script]);
    let stderr = ""; worker.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => worker.on("exit", resolve)); assert.equal(code, 0, stderr);
  } finally { held.exec("ROLLBACK"); held.close(); }
  await assert.rejects(checkpoint(root, child.todo.id, 3, {}, "abort", "test-session", AbortSignal.abort()), /abort/i);
  const hostile = structuredClone(childArtifact.todo); hostile.artifacts[0].path = "../../escape.md";
  await assert.rejects(mutate(root, child.todo.id, 3, () => hostile), /Invalid artifact/);
  await assert.rejects(mutate(root, child.todo.id, 3, async todo => todo), /synchronous/);

  // Bootstrap is restartable, incompatible stores fail closed, and transaction failures are atomic.
  {
    const empty = join(scratch, "empty-database"); await mkdir(empty); await writeFile(join(empty, "todo.sqlite"), "", { mode: 0o600 });
    assert.deepEqual(await list(empty), []);
    const rolled = join(scratch, "rolled-initialization"); await mkdir(rolled);
    const db = new DatabaseSync(join(rolled, "todo.sqlite"));
    db.exec("BEGIN IMMEDIATE; CREATE TABLE abandoned(id TEXT); PRAGMA user_version=1; ROLLBACK"); db.close();
    assert.deepEqual(await list(rolled), []);
    const foreign = join(scratch, "foreign-database"); await mkdir(foreign);
    const unknown = new DatabaseSync(join(foreign, "todo.sqlite")); unknown.exec("CREATE TABLE sqlitexforeign(id TEXT)"); unknown.close();
    await assert.rejects(list(foreign), /Unsupported/);
    const raceRoot = join(scratch, "concurrent-bootstrap");
    const script = `import { create } from ${JSON.stringify(pathToFileURL(join(directory, "storage.ts")).href)}; try { await create(${JSON.stringify(raceRoot)}, 'simple', process.argv[1], 'Preserve both commits'); } catch(e) { if (!e.message.includes('busy')) throw e; process.exitCode=2; }`;
    const run = title => new Promise(resolve => { const p = spawn(process.execPath, ["--input-type=module", "-e", script, title]); let error = ""; p.stderr.on("data", data => error += data); p.on("exit", code => resolve({ code, error })); });
    const races = await Promise.all([run("First"), run("Second")]);
    assert.ok(races.every(result => [0, 2].includes(result.code)), JSON.stringify(races));
    const before = await list(raceRoot); assert.equal(before.length, races.filter(result => result.code === 0).length);
    await create(raceRoot, "simple", "Retry", "Caller retry succeeds");
    assert.equal((await list(raceRoot)).length, before.length + 1);
    const atomicRoot = join(scratch, "atomic");
    const parent = await create(atomicRoot, "project", "Atomic parent", "No partial effects");
    const child = await create(atomicRoot, "simple", "Atomic child", "No orphan bytes", undefined);
    const beforeRows = await list(atomicRoot);
    // The real mutation owner rolls back staged bytes and the owner on validation failure.
    await assert.rejects(mutate(atomicRoot, child.todo.id, 1, (todo, item, context) => {
      context.writeArtifact("artifacts/staged.md", Buffer.from("staged"));
      todo.title = "";
      return todo;
    }, undefined, true), /nonempty text/i);
    assert.deepEqual(await list(atomicRoot), beforeRows);
    assert.equal(withRead(atomicRoot, db => db.prepare("SELECT count(*) AS n FROM artifact_revisions").get().n), 0);
    const controller = new AbortController();
    await assert.rejects(mutate(atomicRoot, child.todo.id, 1, todo => { controller.abort(); return todo; }, controller.signal), /abort/i);
    assert.deepEqual(await list(atomicRoot), beforeRows);
    const hostileDB = join(scratch, "symlink-db"); await mkdir(hostileDB); await symlink(join(empty, "todo.sqlite"), join(hostileDB, "todo.sqlite"));
    await assert.rejects(list(hostileDB), /Unsafe project database/);
  }

  // Real extension loader, schema validation, selection restoration and nonforcing bookkeeping guidance.
  const pi = await instance([], true);
  await pi.call("context_project", { action: "resume", selector: child.todo.id });
  assert.equal(restoreSelection(pi.stored), child.todo.id);
  const [context] = await pi.emit("context", { messages: [] });
  assert.match(context.messages.at(-1).content, /Converter tested/);
  assert.match(context.messages.at(-1).content, /Is this new understanding rather than derivable state or a receipt\?/); // Semantic save check reaches the main agent through the real brief loader, not proof of adherence.
  assert.doesNotMatch(context.messages.at(-1).content, /Observe.*current_state/);
  // A malformed unrelated owner must not prevent an attached session from watching its own scope.
  const siblingJSON = savedJSON(sibling);
  replaceJSON(sibling, JSON.stringify({ ...JSON.parse(siblingJSON), title: "" }));
  try {
    assert.equal((await readKnown(root, child)).todo.id, child.todo.id);
    const [isolatedContext] = await pi.emit("context", { messages: context.messages });
    assert.equal(pi.ctx.aborted, undefined);
    assert.match(isolatedContext.messages.at(-1).content, /Converter tested/);
    await assert.rejects(readKnown(root, sibling), /nonempty text/i);
  } finally { replaceJSON(sibling, siblingJSON); }
  const loadCount = () => pi.stored.filter(entry => entry.customType === "todo-context-v1").length;
  const initialLoads = loadCount();
  const [continued] = await pi.emit("context", { messages: context.messages });
  assert.equal(loadCount(), initialLoads);
  assert.equal(continued.messages.filter(message => message.customType === "todo-context-v1").length, 1);
  assert.equal(continued.messages.find(message => message.customType === "todo-context-v1").details.load_id, context.messages.at(-1).details.load_id);
  await pi.emit("before_agent_start");
  assert.equal((await pi.emit("agent_before_settle", { outcome: "aborted", context: { canContinue: true, pendingMessages: [] } }))[0], undefined);
  const boundary = { outcome: "completed", context: { canContinue: true, pendingMessages: [] } };
  assert.deepEqual(await pi.emit("agent_before_settle", boundary), []);
  const savedRevision = (await locate(root, child.todo.id)).todo.revision;
  const warningCount = pi.warnings.length;
  await pi.emit("agent_settled");
  assert.equal(pi.warnings.length, warningCount); // Pure discussion causes no UI nag or extra model turn.
  assert.equal((await locate(root, child.todo.id)).todo.revision, savedRevision);
  const [reminderContext] = await pi.emit("context", { messages: [{ role: "custom", customType: checkpointMessage, content: "Old forced reminder" }] });
  assert.ok(!reminderContext.messages.some(message => message.customType === checkpointMessage));
  await pi.extension.commands.get("context").handler("checkpoint", pi.ctx);
  assert.equal(pi.stored.at(-1).type, "user_request");
  await pi.call("context_project_ack", { id: child.todo.id, reason: "no_change", explanation: "Only inspected context" });
  const resumed = await instance(pi.stored);
  assert.equal(restoreSelection(resumed.stored), child.todo.id);
  await resumed.emit("session_tree"); assert.equal((await locate(root, child.todo.id)).todo.revision, 3);
  const blank = await instance();
  assert.equal((await blank.emit("context", { messages: [] }))[0].messages.length, 0);
  const beforeSearchErrors = await list(root);
  await assert.rejects(blank.call("context_project", { action: "search" }), /query required/);
  await assert.rejects(blank.call("context_project", { action: "search", query: " --!? " }), /letters or numbers/);
  await assert.rejects(blank.call("context_project", { action: "search", query: "Migrate", status: "blocked" }), /validation/i);
  await assert.rejects(blank.call("context", { action: "read", selector: child.todo.id, view: "full" }), /kind.*project.*selector.*knowledge.*id/i);
  await assert.rejects(blank.call("context", { action: "read", kind: "all", view: "full" }), /kind.*project.*knowledge/i);
  await assert.rejects(blank.call("context", { action: "read", kind: "project", id: child.todo.id }), /selector.*id.*forbidden/i);
  await assert.rejects(blank.call("context", { action: "read", kind: "project", selector: child.todo.id, offset: 0 }), /forbidden.*fields/i);
  await assert.rejects(blank.call("context_project_artifact", { action: "upsert", id: child.todo.id, revision: 3, title: "Incomplete", kind: "design", required: false, applies_to: [] }), /missing: description, lifecycle/);
  await assert.rejects(blank.call("context_project_artifact", { action: "upsert", id: child.todo.id, ...metadata, applies_to: undefined }), /missing: revision, applies_to/);
  assert.equal((await blank.call("context", { action: "read", kind: "project", selector: child.todo.id, view: "full" })).todo.id, child.todo.id);
  assert.deepEqual(await list(root), beforeSearchErrors);
  assert.deepEqual(blank.stored, []);
  await assert.rejects(blank.call("context_project_checkpoint", { id: child.todo.id, revision: 3, key: "invalid", changes: { arbitrary: true } }), /validation|additional/i);
  const retiredActions = { next_actions: ["Retired instruction"] };
  await assert.rejects(blank.call("context_project_checkpoint", { id: child.todo.id, revision: 3, key: "retired", changes: retiredActions }), /validation|additional/i);
  await assert.rejects(blank.call("context_project_tighten", { id: child.todo.id, revision: 3, reason: "Maintenance", ...retiredActions }), /validation|additional/i);
  assert.throws(() => applyChanges(updated.todo, retiredActions), /unknown/);
  await assert.rejects(blank.call("context_project_artifact", { action: "upsert", id: child.todo.id, revision: 3, ...metadata, kind: "runbook", applies_to: [] }), /validation/i);
  await assert.rejects(blank.call("context_project_checkpoint", { id: child.todo.id, revision: 3, key: "unapproved", changes: { outcome: "New outcome" } }), /sign-off/);
  await assert.rejects(pi.call("context_project_checkpoint", { id: child.todo.id, revision: 3, key: "declined", changes: { outcome: "New outcome" } }), /sign-off/);
  pi.confirmations.push(true);
  const accepted = await pi.call("context_project_checkpoint", { id: child.todo.id, revision: 3, key: "approved", changes: { outcome: "New outcome" } });
  assert.equal(accepted.todo.outcome, "New outcome");
  await pi.extension.commands.get("context").handler("new simple", pi.ctx);
  assert.match(pi.warnings.at(-1), /chat.*context_project action create/);
  assert.equal((await list(root)).length, 3);
  await pi.call("context_project", { action: "create", title: "Chore", outcome: "Finish chore" });

  // Task memory survives a fresh session and removal of its temporary design source.
  const continuationRoot = join(scratch, "continuation-todos");
  process.env.PI_TODO_PATH = continuationRoot;
  const author = await instance();
  assert.deepEqual(await author.call("context_project", { action: "status" }), { selected: null });
  assert.deepEqual(author.stored, []);
  const owner = await author.call("context_project", { action: "create", type: "simple", title: "Versioned identifiers", outcome: "Preserve record identity across conversion" });
  const candidates = await author.call("context_project", { action: "search", query: "versioned identifiers" });
  assert.equal(candidates[0].id, owner.todo.id);
  await author.call("context_project", { action: "get", selector: candidates[0].id, view: "active" });
  assert.deepEqual(await author.call("context_project", { action: "status" }), { selected: null }); // Discovery/inspection is not attachment.
  await author.call("context_project", { action: "resume", selector: candidates[0].id });
  const finding = "Verified identifier ownership; deployment remains unverified.";
  const preserved = await author.call("context_project_checkpoint", { id: owner.todo.id, revision: 1, key: "identifier-owner", changes: { evidence: { add: [finding] } } });
  const temporaryDesign = join(scratch, "temporary-design.md");
  const designBody = "# Durable design\n\nRetain the original record identifier during conversion.\n";
  await writeFile(temporaryDesign, designBody);
  const designed = await author.call("context_project_artifact", { action: "upsert", id: owner.todo.id, revision: preserved.todo.revision, title: "Identifier migration design", kind: "design", description: "Stable identity contract", lifecycle: "current", required: true, applies_to: [], body: await readFile(temporaryDesign, "utf8") });
  await rm(temporaryDesign);
  const fresh = await instance(); // No inherited transcript, selection or temporary source document.
  fresh.ctx.sessionManager.getSessionId = () => "fresh-task-session";
  assert.deepEqual(await fresh.call("context_project", { action: "status" }), { selected: null });
  const rediscovered = await fresh.call("context_project", { action: "search", query: "versioned identifiers" });
  await fresh.call("context_project", { action: "resume", selector: rediscovered[0].id });
  const [freshContext] = await fresh.emit("context", { messages: [] });
  const brief = freshContext.messages.find(message => message.customType === "todo-context-v1").content;
  assert.ok(brief.includes(finding));
  assert.ok(brief.includes("Identifier migration design"));
  assert.ok(!brief.includes("Retain the original record identifier during conversion.")); // Catalog first, body on demand.
  const durableBody = await fresh.call("context_project_artifact", { action: "read", id: owner.todo.id, artifact_id: designed.todo.artifacts[0].id });
  assert.equal(durableBody.body, designBody);
  assert.equal(durableBody.complete, true);
  const externalUpdate = await author.call("context_project_checkpoint", { id: owner.todo.id, revision: designed.todo.revision, key: "external-nuance", changes: { evidence: { add: ["External discovery: preserve imported aliases too."] } } });
  const beforeStatus = await savedJSON(owner);
  const beforeStatusEntries = fresh.stored.length;
  const attachment = await fresh.call("context_project", { action: "status" });
  assert.equal(attachment.selected.id, owner.todo.id);
  assert.equal(attachment.selected.revision, externalUpdate.todo.revision);
  assert.equal(attachment.selected.status, "in_progress");
  assert.equal("current_state" in attachment.selected, false);
  assert.equal(fresh.stored.length, beforeStatusEntries);
  assert.equal(await savedJSON(owner), beforeStatus);
  const [afterStatusContext] = await fresh.emit("context", { messages: freshContext.messages });
  assert.match(afterStatusContext.messages.find(message => message.customType === "todo-context-drift-v1").content, /changed outside this session/);
  assert.equal(afterStatusContext.messages.find(message => message.customType === "todo-context-v1").content, brief); // Status neither observes the external write nor refreshes the brief.
  await assert.rejects(fresh.call("context_project", { action: "leave" }), /Checkpoint or acknowledge/); // Status is not acknowledgement.
  await fresh.call("context_project_ack", { id: owner.todo.id, reason: "no_change", explanation: "Only recovered saved understanding" });
  await fresh.call("context_project", { action: "leave" });
  assert.deepEqual(await fresh.call("context_project", { action: "status" }), { selected: null });
  assert.equal(await savedJSON(owner), beforeStatus);

  // Recap joins live scoped memory to bounded native journal evidence without observing or saving it.
  {
    const root = join(scratch, "recap-todos");
    process.env.PI_TODO_PATH = root;
    const recapProject = await create(root, "project", "Recap rollout", "Preserve identity across conversion");
    const recapChild = await create(root, "simple", "Recap conversion", "Convert identifiers", undefined);
    const recapPrereq = await create(root, "simple", "Recap prerequisite", "Review compatibility", undefined);
    let recapParent = await saveArtifact(root, recapProject.todo.id, 1, { ...metadata, title: "Scoped recap design", applies_to: [], body: "RECAP_BODY_NOT_EAGERLY_READ" });
    recapParent = await saveArtifact(root, recapProject.todo.id, recapParent.todo.revision, { ...metadata, title: "Other child design", applies_to: [] });
    const refAuthority = { session_id: "recap-fixture", approval_evidence: "Synthetic request: use the direct source and scoped design" };
    writeReference(root, { action: "reference_add", project_id: recapChild.todo.id, expected_revision: 1, reference: { kind: "project-grounding", source_project_id: recapProject.todo.id, reason: "Shared constraint" }, key: "recap-grounding" }, refAuthority);
    writeReference(root, { action: "reference_add", project_id: recapChild.todo.id, expected_revision: 2, reference: { kind: "artifact", source_owner_id: recapProject.todo.id, artifact_id: recapParent.todo.artifacts[0].id, follow: "current", requirement: "source", reason: "Required source design" }, key: "recap-artifact" }, refAuthority);
    let recapSaved = await checkpoint(root, recapChild.todo.id, 3, { ...changes, depends_on: [recapPrereq.todo.id] }, "recap-saved", "earlier-session");
    recapSaved = await saveArtifact(root, recapChild.todo.id, recapSaved.todo.revision, { ...metadata, title: "Hidden recap research", required: false, applies_to: [] });
    const recapPi = await instance();
    await recapPi.call("context_project", { action: "resume", selector: recapChild.todo.id });
    await recapPi.call("context_project_tighten", { id: recapChild.todo.id, revision: recapSaved.todo.revision, reason: "No longer needed in orientation", consult_on_demand_artifacts: [recapSaved.todo.artifacts[0].id] });
    await recapPi.call("context_project", { action: "refresh" });
    await recapPi.emit("before_agent_start"); // A read-only recap must not acknowledge pending work.
    const [recapContext] = await recapPi.emit("context", { messages: [] });
    const marker = { id: recapChild.todo.id, revision: recapSaved.todo.revision, pending: true, reason: "manual" };
    recapPi.stored.push(
      ...Array.from({ length: 15 }, (_, i) => ({ type: "message", id: `recap-old-${i}`, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: [{ type: "text", text: `Earlier request ${i}` }] } })),
      { type: "compaction", id: "recap-compact", timestamp: "2026-01-01T00:01:00Z", summary: "Earlier work summarized, not freshly verified", firstKeptEntryId: "recap-user" },
      { type: "custom", customType: compactionEntry, data: marker },
      { type: "message", id: "recap-user", timestamp: "2026-01-01T00:02:00Z", message: { role: "user", content: [{ type: "text", text: "Check conversion only" }] } },
      { type: "message", id: "recap-assistant", timestamp: "2026-01-01T00:03:00Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_RECAP_THINKING" }, { type: "text", text: "Inspecting conversion" }] } },
      { type: "message", id: "recap-tool", timestamp: "2026-01-01T00:04:00Z", message: { role: "toolResult", toolName: "bash", toolCallId: "failed-test", isError: true, content: [{ type: "text", text: "Test failed: " + "x".repeat(1500) }] } },
      { type: "custom_message", id: "recap-hidden", display: false, content: "PRIVATE_RECAP_NOTE" },
    );
    recapSaved = await checkpoint(root, recapChild.todo.id, (await locate(root, recapChild.todo.id)).todo.revision, { evidence: { remove: recapSaved.todo.current_state.evidence.map(row => row.id), add: ["External finding: deployment remains unverified"] } }, "recap-external", "another-session");
    const recapFiles = await Promise.all([recapParent, recapSaved, recapPrereq].map(row => savedJSON(row)));
    const requiredRecapPath = recapParent.todo.artifacts[0].path;
    const requiredRecapBody = bodyBytes(recapParent, requiredRecapPath);
    removeBody(recapParent, requiredRecapPath); // Even a required artifact body is not opened by recap.
    const beforeRecapEntries = structuredClone(recapPi.stored);
    const unavailableRecap = await recapPi.call("context_project_recap", {});
    assert.deepEqual(unavailableRecap.session_evidence.retrieval, { tool: "session_history", available: false });
    assert.ok(unavailableRecap.session_evidence.entries.every(entry => !Object.hasOwn(entry, "read")));
    assert.match(unavailableRecap.session_evidence.coverage, /not callable/);
    // External callable-tool boundary only: no sibling history source or archive reads.
    recapPi.ctx.tools = [{ name: "session_history" }];
    const recapData = await recapPi.call("context_project_recap", {});
    assert.deepEqual(recapData.session_evidence.retrieval, { tool: "session_history", available: true });
    assert.deepEqual(recapData.session_evidence.entries.map(({ read, ...entry }) => entry), unavailableRecap.session_evidence.entries);
    assert.equal(recapData.selected, recapChild.todo.id);
    assert.equal(recapData.context_model, 2);
    assert.deepEqual(recapData.grounding.map(source => source.source_owner_id), [recapProject.todo.id]);
    assert.equal(recapData.project.context.revision, recapSaved.todo.revision);
    assert.deepEqual(recapData.project.context.current_state.evidence.map(row => row.text), ["External finding: deployment remains unverified"]);
    assert.equal(recapData.project.context.decisions[0].approval, "draft");
    assert.deepEqual(recapData.artifact_catalog.map(source => source.artifact.title), ["Scoped recap design"]);
    assert.deepEqual(recapData.artifact_catalog[0].read, { tool: "context_project_artifact", action: "read", id: recapProject.todo.id, artifact_id: recapParent.todo.artifacts[0].id, expected_version: recapParent.todo.artifacts[0].path });
    assert.deepEqual(recapData.prerequisites.map(row => row.id), [recapPrereq.todo.id]);
    assert.equal("children" in recapData, false);
    assert.equal(recapData.session_evidence.entries.length, 12);
    assert.equal(recapData.session_evidence.compaction_present, true);
    assert.match(recapData.session_evidence.coverage, /Bounded sample.*inherited/);
    const recapFailure = recapData.session_evidence.entries.at(-1);
    assert.equal(recapFailure.is_error, true);
    assert.equal(recapFailure.tool_name, "bash");
    assert.equal(recapFailure.tool_call_id, "failed-test");
    assert.equal(recapFailure.truncated, true);
    assert.equal(recapFailure.ref, "pi-history:v1/test-session/recap-tool");
    assert.equal(recapFailure.read.arguments.ref, recapFailure.ref);
    assert.equal(recapData.session_evidence.entries.find(row => row.entry_id === "recap-compact").provenance, "derived_summary");
    assert.doesNotMatch(JSON.stringify(recapData), /PRIVATE_RECAP|RECAP_BODY_NOT_EAGERLY_READ|Earlier request 0/);
    assert.deepEqual(await recapPi.call("context_project_recap", {}), recapData);
    assert.deepEqual(recapPi.stored, beforeRecapEntries);
    assert.deepEqual(await Promise.all([recapParent, recapSaved, recapPrereq].map(row => savedJSON(row))), recapFiles);
    await assert.rejects(resumeBundle(root, recapChild.todo.id), /Missing current artifact/); // Resume still validates mandatory bodies.
    restoreBody(recapParent, requiredRecapPath, requiredRecapBody);
    const [recapDrift] = await recapPi.emit("context", { messages: recapContext.messages });
    assert.match(recapDrift.messages.find(message => message.customType === "todo-context-drift-v1").content, /changed outside this session/);
    await recapPi.call("context_project_recap", {});
    const [recapDriftAgain] = await recapPi.emit("context", { messages: recapDrift.messages });
    assert.equal(recapDriftAgain.messages.find(message => message.customType === "todo-context-drift-v1").content, recapDrift.messages.find(message => message.customType === "todo-context-drift-v1").content);
    await assert.rejects(recapPi.call("context_project", { action: "leave" }), /Checkpoint or acknowledge/);
    assert.deepEqual(pendingReconciliation(recapPi.stored, recapChild.todo.id), marker);
    const recapTool = recapPi.extension.tools.get("context_project_recap").definition;
    assert.equal(recapTool.annotations.readOnlyHint, true);
    assert.match(recapTool.promptGuidelines.join(" "), /generic service or Git status/);
    const recapCommand = recapPi.extension.commands.get("context");
    assert.ok(recapCommand.getArgumentCompletions("rec").some(row => row.value === "recap"));
    const beforeRecapCommand = structuredClone(recapPi.stored);
    let recapWaited = false;
    await recapCommand.handler("recap", { ...recapPi.ctx, waitForIdle: async () => { recapWaited = true; } });
    assert.equal(recapWaited, true);
    assert.deepEqual(recapPi.stored.slice(0, -1), beforeRecapCommand);
    assert.equal(recapPi.stored.at(-1).type, "user_request");
    assert.match(recapPi.stored.at(-1).content, /Call context_project_recap.*read-only/s);
    for (const heading of ["## Status —", "### This session", "### Preserved understanding", "### Artifacts to know", "### Remaining"]) assert.ok(recapPi.stored.at(-1).content.includes(heading));
    assert.match(recapPi.stored.at(-1).content, /do not save, refresh, acknowledge, change progress or begin implementation/);
    const unattachedRecap = await instance();
    assert.equal((await unattachedRecap.call("context_project_recap", {})).attached, false);
    await unattachedRecap.extension.commands.get("context").handler("recap", unattachedRecap.ctx);
    assert.match(unattachedRecap.warnings.at(-1), /No project attached/);
    assert.deepEqual(unattachedRecap.stored, []);
    process.env.PI_TODO_PATH = continuationRoot;
  }

  // Saved activity starts only its owner, never associated projects; reads/retries/terminal edits do not restart work.
  const activityRoot = join(scratch, "activity-todos");
  process.env.PI_TODO_PATH = activityRoot;
  const activity = await instance([], true);
  const createdRaw = await activity.callRaw("context_project", { action: "create", type: "project", title: "Activity", outcome: "Track real work" });
  const activityProject = createdRaw.structuredContent;
  assert.deepEqual(JSON.parse(createdRaw.content[0].text), { saved: true, id: activityProject.todo.id, revision: 1 });
  assert.deepEqual(createdRaw.details, activityProject);
  const prerequisite = await activity.call("context_project", { action: "create", type: "simple", title: "Prerequisite", outcome: "Prepare delivery" });
  const activityChild = await activity.call("context_project", { action: "create", type: "simple", title: "Working child", outcome: "Save findings", depends_on: [prerequisite.todo.id] });
  await activity.call("context_project", { action: "resume", selector: activityChild.todo.id });
  await activity.call("context_project", { action: "get", selector: activityChild.todo.id });
  await activity.call("context_project_ack", { id: activityChild.todo.id, reason: "no_change", explanation: "Only read context" });
  const empty = await activity.call("context_project_checkpoint", { id: activityChild.todo.id, revision: 1, key: "empty", changes: {} });
  assert.equal(empty.todo.status, "todo");
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.revision, 1);
  const activityChanges = {
    evidence: { add: ["Research saved. Delivery still depends on preparation.", "Native report: preparation remains unverified"] },
    decisions: [{ summary: "Preserve exact owner IDs", rationale: "Avoid routing to an unrelated owner", approval: "draft", evidence: ["Discovery: ID spelling is significant"] }],
    questions: [{ text: "Does preparation cover the revised scope?" }],
  };
  const startedRaw = await activity.callRaw("context_project_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  const started = startedRaw.structuredContent;
  assert.deepEqual(startedRaw.details, started);
  assert.deepEqual(started.todo, (await locate(activityRoot, activityChild.todo.id)).todo);
  const startedReceipt = JSON.parse(startedRaw.content[0].text);
  assert.deepEqual(startedReceipt, {
    saved: true, revision: 3, evidence_ids: started.todo.current_state.evidence.map(row => row.id), decision_ids: [started.todo.decisions[0].id], question_ids: [started.todo.open_questions[0].id], status: "in_progress",
    dependency: started.dependency, affected_dependents: started.affected_dependents,
  });
  assert.ok(startedRaw.content[0].text.length < JSON.stringify(started).length / 2);
  const routineRaw = await activity.callRaw("context_project_checkpoint", { id: prerequisite.todo.id, revision: 1, key: "routine-empty", changes: {} });
  assert.deepEqual(JSON.parse(routineRaw.content[0].text), { saved: true, revision: 2 });
  assert.equal(started.todo.status, "in_progress");
  assert.equal(started.dependency.dependencies_satisfied, false);
  assert.equal(started.dependency.review_required, false);
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.status, "todo");
  assert.equal((await locate(activityRoot, prerequisite.todo.id)).todo.status, "todo");
  const replayRaw = await activity.callRaw("context_project_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  const replay = replayRaw.structuredContent;
  assert.deepEqual(replay.todo, started.todo);
  assert.deepEqual(replayRaw.details, replay);
  assert.deepEqual(JSON.parse(replayRaw.content[0].text), {
    saved: true, revision: startedReceipt.revision, evidence_ids: startedReceipt.evidence_ids, decision_ids: startedReceipt.decision_ids, question_ids: startedReceipt.question_ids,
  });
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.revision, 1);
  await activity.emit("context", { messages: activity.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-drift-v1").length, 0);
  assert.match(activity.statuses.at(-1), /^project · in progress · /);
  await assert.rejects(activity.call("context_project_checkpoint", { id: activityChild.todo.id, revision: 3, key: "too-soon", changes: { status: "done" } }), /waiting on/);
  const activityDiscovery = await instance([], true);
  const activityRows = await activityDiscovery.call("context_project", { action: "list" });
  assert.equal(activityRows.find(row => row.id === activityChild.todo.id).status, "in_progress");
  assert.equal(activityRows.find(row => row.id === activityChild.todo.id).dependency.review_required, false);
  await activityDiscovery.extension.commands.get("context").handler("", activityDiscovery.ctx);
  assert.equal(activityDiscovery.panels.length, 0);

  // Artifact-first activity starts only its owner, even when another project is attached.
  await activity.call("context_project_checkpoint", { id: activityProject.todo.id, revision: 1, key: "reset-project", changes: { status: "todo" } });
  await activity.call("context_project", { action: "resume", selector: activityProject.todo.id });
  const artifactChild = await activity.call("context_project", { action: "create", type: "simple", title: "Artifact owner", outcome: "Write a plan" });
  const activityMetadata = { title: "Plan", kind: "design", description: "Draft plan", lifecycle: "current", required: false, applies_to: [], body: "# Draft plan" };
  const artifactRaw = await activity.callRaw("context_project_artifact", { action: "upsert", id: artifactChild.todo.id, revision: 1, ...activityMetadata });
  const artifactStarted = artifactRaw.structuredContent;
  assert.deepEqual(artifactRaw.details, artifactStarted);
  assert.deepEqual(artifactStarted.todo, (await locate(activityRoot, artifactChild.todo.id)).todo);
  assert.deepEqual(JSON.parse(artifactRaw.content[0].text), {
    saved: true, revision: 2, artifact_id: artifactStarted.todo.artifacts[0].id, path: artifactStarted.todo.artifacts[0].path, status: "in_progress",

  });
  assert.ok(artifactRaw.content[0].text.length < JSON.stringify(artifactStarted).length / 2);
  const metadataOnly = await activity.callRaw("context_project_artifact", { action: "upsert", id: artifactChild.todo.id, revision: 2, artifact_id: artifactStarted.todo.artifacts[0].id, ...activityMetadata, body: undefined });
  assert.equal(JSON.parse(metadataOnly.content[0].text).artifact_id, undefined);
  assert.equal(JSON.parse(metadataOnly.content[0].text).path, undefined);
  const artifactRead = await activity.callRaw("context_project_artifact", { action: "read", id: artifactChild.todo.id, artifact_id: artifactStarted.todo.artifacts[0].id });
  assert.equal(artifactRead.structuredContent.body, "# Draft plan\n");
  assert.equal(artifactRead.structuredContent.complete, true);
  assert.ok(artifactRead.content[0].text.endsWith(artifactRead.structuredContent.body));
  assert.equal(artifactStarted.todo.status, "in_progress");
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.status, "todo");
  assert.match(activity.statuses.at(-1), /^project · todo · .* · Activity$/);
  await activity.emit("context", { messages: activity.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-drift-v1").length, 0);
  for (const status of ["done", "canceled"]) {
    const parent = await locate(activityRoot, activityProject.todo.id);
    const terminalParent = await activity.call("context_project_checkpoint", { id: parent.todo.id, revision: parent.todo.revision, key: `parent-${status}`, changes: { status } });
    const child = await locate(activityRoot, artifactChild.todo.id);
    const terminalChild = await activity.call("context_project_checkpoint", { id: child.todo.id, revision: child.todo.revision, key: `child-${status}`, changes: { status } });
    const noted = await activity.call("context_project_checkpoint", { id: child.todo.id, revision: terminalChild.todo.revision, key: `note-${status}`, changes: { evidence: { add: ["Keep historical notes"] } } });
    const archived = await activity.call("context_project_artifact", { action: "upsert", id: child.todo.id, revision: noted.todo.revision, ...activityMetadata, artifact_id: artifactStarted.todo.artifacts[0].id, body: `# ${status} notes` });
    assert.equal(archived.todo.status, status);
    assert.deepEqual((await locate(activityRoot, parent.todo.id)).todo, terminalParent.todo);
  }
  process.env.PI_TODO_PATH = root;

  // Flat title/goal discovery recalls a completed child, then explicitly loads its scoped context.
  const recallRoot = join(scratch, "recall-todos");
  const recallParent = await create(recallRoot, "project", "Operations", "Own care coordination");
  const recallChild = await create(recallRoot, "simple", "Referral routing", "Remember referral ownership", undefined);
  await checkpoint(recallRoot, recallChild.todo.id, 1, { status: "done", evidence: { add: ["Routing delivery verified"] } }, "recall-done", "test");
  const phraseProject = await create(recallRoot, "project", "Improve referral routing", "Own deployment");
  await create(recallRoot, "simple", "Telemetry", "Count events", undefined);
  const goalOnly = await create(recallRoot, "simple", "Handoff", "Own referral routing");
  const goalTwin = await create(recallRoot, "simple", "Handoff", "Own referral routing safely");
  const titleTerms = await create(recallRoot, "simple", "Routing for referrals", "Coordinate care", undefined, undefined, [goalOnly.todo.id]);
  const recallLink = { url: "https://linear.app/example-team/issue/EX-456/routing", coverage: "partial" };
  await checkpoint(recallRoot, titleTerms.todo.id, 1, { linear: recallLink }, "recall-link", "test");
  const mixed = await create(recallRoot, "simple", "Referral intake", "Preserve routing exclusions");
  await checkpoint(recallRoot, mixed.todo.id, 1, { status: "canceled" }, "recall-canceled", "test");
  const recallRows = await list(recallRoot);
  const recallBytes = await Promise.all(recallRows.map(row => savedJSON(row)));
  process.env.PI_TODO_PATH = recallRoot;
  const recall = await instance();
  const recallQuery = { action: "search", query: "REFERRAL--Routing!" };
  const found = await recall.call("context_project", recallQuery);
  const goalIds = [goalOnly.todo.id, goalTwin.todo.id].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(found.map(row => row.id), [recallChild.todo.id, phraseProject.todo.id, titleTerms.todo.id, mixed.todo.id, ...goalIds]);
  assert.deepEqual(found.map(row => row.matched_in), ["both", "title", "title", "both", "goal", "goal"]);
  assert.deepEqual([found[0].parent_id, found[0].parent_title, found[0].outcome, found[0].status], [null, null, "Remember referral ownership", "done"]);
  assert.ok(found.slice(1).every(row => row.parent_id === null && row.parent_title === null));
  assert.deepEqual(await recall.call("context_project", recallQuery), found);
  assert.deepEqual((await recall.call("context_project", { ...recallQuery, include_done: false, status: "done", type: "simple" })).map(row => row.id), []);
  assert.deepEqual((await recall.call("context_project", { ...recallQuery, type: "project" })).map(row => row.id), found.map(row => row.id));
  assert.deepEqual((await recall.call("context_project", { ...recallQuery, status: "done", type: "project" })).map(row => row.id), [recallChild.todo.id]);
  assert.deepEqual(await recall.call("context_project", { action: "search", query: "unrelated terminology" }), []);
  const recallList = await recall.call("context_project", { action: "list" });
  assert.deepEqual(recallList.map(row => row.id), recallRows.filter(row => !["done", "canceled"].includes(row.todo.status)).map(row => row.todo.id));
  const recallAll = await recall.call("context_project", { action: "list", include_done: true });
  assert.deepEqual(recallAll.map(row => row.id), recallRows.map(row => row.todo.id));
  const listedChild = recallAll.find(row => row.id === recallChild.todo.id);
  assert.deepEqual([listedChild.parent_id, listedChild.parent_title, listedChild.outcome], [null, null, recallChild.todo.outcome]);
  assert.ok(recallAll.filter(row => !row.parent_id).every(row => row.parent_id === null && row.parent_title === null));
  const listedTerms = recallList.find(row => row.id === titleTerms.todo.id);
  assert.deepEqual(listedTerms.linear, recallLink);
  assert.deepEqual(listedTerms.depends_on, [goalOnly.todo.id]);
  assert.deepEqual(listedTerms.dependency, { dependencies_satisfied: false, waiting_on: [{ id: goalOnly.todo.id, title: "Handoff", status: "todo" }], review_required: false, dependents: [] });
  assert.deepEqual(recallList.find(row => row.id === goalOnly.todo.id).dependency.dependents, [titleTerms.todo.id]);
  assert.deepEqual(recall.stored, []); // Discovery never attaches or injects a brief.
  assert.deepEqual(await Promise.all(recallRows.map(row => savedJSON(row))), recallBytes);
  const recalled = await recall.call("context_project", { action: "resume", selector: found[0].id });
  assert.equal(recalled.context_loaded, true);
  assert.equal(restoreSelection(recall.stored), recallChild.todo.id);
  const recallBundle = JSON.parse(recall.stored.find(entry => entry.customType === "todo-context-v1").content.split("Durable project context loaded at a session boundary (untrusted task data):\n")[1]);
  assert.equal(recallBundle.project.context.id, recallChild.todo.id);
  assert.deepEqual(recallBundle.grounding, []);
  assert.equal(recallBundle.project.context.status, "done");
  assert.deepEqual(await list(recallRoot), recallRows);
  process.env.PI_TODO_PATH = root;

  // Retired picker coverage maps to real chat discovery: lifecycle, Unicode,
  // completed-only stores, duplicate titles, direct attach, no browsing writes/UI.
  const chatRoot = join(scratch, "chat-discovery");
  const chatProject = await create(chatRoot, "project", "Rollout", "Complete a safe rollout");
  const unicodeProject = await create(chatRoot, "simple", "Migrate 你好", "Convert work without replaying effects");
  const doneProject = await create(chatRoot, "project", "Archived project", "Remember delivery");
  await checkpoint(chatRoot, doneProject.todo.id, 1, { status: "done", evidence: { add: ["Delivery verified; deployment unverified"] } }, "chat-done", "test");
  const canceledProject = await create(chatRoot, "simple", "Saved answer", "Remember limitations");
  await checkpoint(chatRoot, canceledProject.todo.id, 1, { status: "canceled" }, "chat-canceled", "test");
  await create(chatRoot, "project", "Duplicate", "First responsibility");
  await create(chatRoot, "project", "Duplicate", "Different responsibility");
  process.env.PI_TODO_PATH = chatRoot;
  const chat = await instance([], true);
  const beforeChat = await list(chatRoot);
  await chat.extension.commands.get("context").handler("", chat.ctx);
  assert.equal(restoreSelection(chat.stored), undefined);
  assert.equal(chat.panels.length, 0);
  assert.match(chat.warnings.at(-1), /include_closed/);
  const openChat = await chat.call("context", { action: "list" });
  const allChat = await chat.call("context", { action: "list", include_closed: true });
  assert.ok(!JSON.stringify(openChat).includes(doneProject.todo.id));
  assert.ok(JSON.stringify(allChat).includes(doneProject.todo.id));
  assert.ok(JSON.stringify(allChat).includes(canceledProject.todo.id));
  assert.ok(JSON.stringify(await chat.call("context", { action: "search", query: "你好" })).includes(unicodeProject.todo.id));
  assert.ok(JSON.stringify(await chat.call("context", { action: "search", query: "Archived" })).includes(doneProject.todo.id));
  await assert.rejects(chat.call("context", { action: "attach", selector: "Duplicate" }), /ambiguous|multiple/i);
  assert.equal(restoreSelection(chat.stored), undefined);
  await chat.call("context", { action: "read", kind: "project", selector: doneProject.todo.id });
  assert.equal(restoreSelection(chat.stored), undefined);
  await chat.extension.commands.get("context").handler(`resume ${doneProject.todo.id}`, chat.ctx);
  assert.equal(restoreSelection(chat.stored), doneProject.todo.id);
  assert.equal(chat.panels.length, 0);
  assert.deepEqual(await list(chatRoot), beforeChat);
  const completedRoot = join(scratch, "completed-only");
  const onlyClosed = await create(completedRoot, "project", "Closed only", "Retain the answer");
  await checkpoint(completedRoot, onlyClosed.todo.id, 1, { status: "done" }, "closed-only", "test");
  process.env.PI_TODO_PATH = completedRoot;
  const completed = await instance();
  assert.ok(JSON.stringify(await completed.call("context", { action: "list", include_closed: true })).includes(onlyClosed.todo.id));
  await completed.call("context", { action: "attach", selector: onlyClosed.todo.id });
  assert.equal((await locate(completedRoot, onlyClosed.todo.id)).todo.status, "done");
  process.env.PI_TODO_PATH = root;

  // Linear adapter via mock nested MCP calls: read-only refresh, partial coverage, confirmed whole-issue writes and drift.
  let issue = { url: "https://linear.app/example-team/issue/EX-123/example", uuid: "issue-uuid", teamId: "team", status: "In Review", statusType: "started", updatedAt: "one" };
  const linked = await pi.call("context_project_checkpoint", { id: sibling.todo.id, revision: 1, key: "link", changes: { linear: { url: issue.url, coverage: "partial" } } });
  const noLinearSnapshot = savedJSON(sibling);
  await assert.rejects(pi.call("context_project_linear", { id: sibling.todo.id, revision: linked.todo.revision }), /tool unavailable/);
  assert.equal(savedJSON(sibling), noLinearSnapshot);
  const calls = [];
  const linearCtx = { ...pi.ctx, tools: ["get_issue", "list_issue_statuses", "save_issue"].map(name => ({ name: `mcp__linear__${name}` })), executeTool: async (name, args) => {
    calls.push({ name, args });
    let data;
    if (name.endsWith("get_issue")) data = issue;
    if (name.endsWith("list_issue_statuses")) data = [{ id: "done-state", name: "Done" }];
    if (name.endsWith("save_issue")) { issue = { ...issue, status: "Done", statusType: "completed", updatedAt: "two" }; data = issue; }
    return { isError: false, result: { content: [{ type: "text", text: JSON.stringify(data) }] } };
  } };
  const refreshResult = await pi.callRaw("context_project_linear", { id: sibling.todo.id, revision: linked.todo.revision }, linearCtx);
  const refreshed = refreshResult.structuredContent;
  assert.deepEqual(refreshResult.details, refreshed);
  assert.deepEqual(JSON.parse(refreshResult.content[0].text), { saved: true, id: sibling.todo.id, revision: refreshed.todo.revision, linear: refreshed.todo.linear });
  assert.deepEqual(refreshed.todo, (await locate(root, sibling.todo.id)).todo);
  assert.equal(refreshed.todo.revision, linked.todo.revision + 1);
  assert.equal(refreshed.todo.status, linked.todo.status); assert.equal(refreshed.todo.linear.status, "In Review");
  await assert.rejects(pi.call("context_project_linear", { id: sibling.todo.id, revision: refreshed.todo.revision, target_status: "Done" }, linearCtx), /Partial/);
  assert.ok(!calls.some(call => call.name.endsWith("save_issue")));
  const whole = await pi.call("context_project_checkpoint", { id: sibling.todo.id, revision: refreshed.todo.revision, key: "whole", changes: { linear: { url: issue.url, coverage: "whole" } } });
  pi.confirmations.push(true);
  const written = await pi.call("context_project_linear", { id: sibling.todo.id, revision: whole.todo.revision, target_status: "Done" }, linearCtx);
  assert.equal(written.todo.linear.status, "Done"); assert.equal(written.todo.status, whole.todo.status);
  assert.equal(calls.find(call => call.name.endsWith("save_issue")).args.state, "done-state");
  const driftCtx = { ...linearCtx, ui: { ...pi.ctx.ui, confirm: async () => { issue.updatedAt = "external-change"; return true; } } };
  await assert.rejects(pi.call("context_project_linear", { id: sibling.todo.id, revision: written.todo.revision, target_status: "Done" }, driftCtx), /changed during confirmation/);

  // Compaction focus, split-turn preservation, successful/failed boundaries and nonforcing restored reconciliation.
  const preparation = (split = false) => ({ firstKeptEntryId: "retained", messagesToSummarize: [{ role: "user", content: "Evidence discovered" }], turnPrefixMessages: split ? [{ role: "user", content: "Work in progress" }] : [], isSplitTurn: split });
  for (const reason of ["manual", "threshold", "overflow"]) {
    const compacting = await instance();
    await compacting.call("context_project", { action: "resume", selector: sibling.todo.id });
    const prep = preparation(true);
    const [beforeResult] = await compacting.emit("session_before_compact", { preparation: prep, reason, customInstructions: "Keep deployment details", signal: new AbortController().signal });
    assert.equal(beforeResult, undefined); // We do not replace/cancel Pi's compactor.
    for (const messages of [prep.messagesToSummarize, prep.turnPrefixMessages]) {
      assert.equal(messages.length, 2);
      assert.match(messages.at(-1).content[0].text, /pending.*true/);
    }
    await compacting.emit("session_compact", { reason, willRetry: reason === "overflow" });
    assert.equal(pendingReconciliation(compacting.stored, sibling.todo.id).revision, written.todo.revision);
    // Fresh context loads saved state separately from the lossy summary.
    const continuedUser = { role: "user", content: "Continue after compaction", timestamp: 50 };
    compacting.stored.push({ type: "message", message: continuedUser });
    const [afterContext] = await compacting.emit("context", { messages: [continuedUser] });
    assert.match(afterContext.messages.at(-1).content, /Compaction reconciliation pending/);
    assert.match(afterContext.messages.at(-1).content, /Observe/);
    const reopened = await instance(compacting.stored);
    await reopened.emit("before_agent_start");
    const [restoredContext] = await reopened.emit("context", { messages: afterContext.messages });
    assert.match(restoredContext.messages.at(-1).content, /Compaction reconciliation pending/);
    assert.deepEqual(await reopened.emit("agent_before_settle", boundary), []);
    // Repeated compaction preserves reconciliation without introducing bookkeeping continuations.
    await reopened.emit("session_before_compact", { preparation: preparation(), reason, signal: new AbortController().signal });
    await reopened.emit("session_compact", { reason });
    assert.equal((await reopened.emit("agent_before_settle", boundary))[0], undefined);
    await reopened.call("context_project_ack", { id: sibling.todo.id, reason: "no_change", explanation: "Summary has no unsaved facts" });
    assert.equal(pendingReconciliation(reopened.stored, sibling.todo.id), undefined);
    const acknowledgedPreparation = preparation();
    await reopened.emit("session_before_compact", { preparation: acknowledgedPreparation, reason, signal: new AbortController().signal });
    assert.match(acknowledgedPreparation.messagesToSummarize.at(-1).content[0].text, /pending.*false/);
    await reopened.emit("session_compact", { reason });
    const [acknowledgedContext] = await reopened.emit("context", { messages: [] });
    assert.doesNotMatch(acknowledgedContext.messages.at(-1).content, /Compaction reconciliation pending/);
  }
  const failingCompaction = await instance();
  await failingCompaction.call("context_project", { action: "resume", selector: sibling.todo.id });
  await failingCompaction.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await failingCompaction.emit("session_compact_failed", { reason: "manual", aborted: true });
  assert.ok(!failingCompaction.stored.some(entry => entry.customType === compactionEntry));
  await failingCompaction.emit("session_compact", { reason: "manual" });
  assert.ok(!failingCompaction.stored.some(entry => entry.customType === compactionEntry));
  await assert.rejects(failingCompaction.emit("session_before_compact", { preparation: preparation(), reason: "overflow", signal: AbortSignal.abort() }), /abort/i);
  const unselectedPreparation = preparation();
  await blank.emit("session_before_compact", { preparation: unselectedPreparation, reason: "manual", signal: new AbortController().signal });
  assert.equal(unselectedPreparation.messagesToSummarize.length, 1);
  await blank.emit("session_compact", { reason: "manual" });
  assert.ok(!blank.stored.some(entry => entry.customType === compactionEntry));
  // Older versions could append an undefined marker when both selected/prepared IDs were undefined.
  const malformedMarker = { type: "custom", customType: compactionEntry };
  assert.equal(pendingReconciliation([malformedMarker]), undefined);
  const legacyReload = await instance([malformedMarker]);
  await legacyReload.emit("session_tree");
  const validMarker = { id: sibling.todo.id, revision: 1, pending: true, reason: "manual" };
  assert.deepEqual(pendingReconciliation([
    { type: "custom", customType: compactionEntry, data: validMarker },
    malformedMarker,
    { type: "custom", customType: acknowledgementEntry },
  ], sibling.todo.id), validMarker);

  // Actual Pi session manager: compaction hides model history, not the attachment's ancestor entry.
  const realSession = SessionManager.create(scratch, join(scratch, "sessions"));
  realSession.appendCustomEntry(selectionEntry, { id: sibling.todo.id });
  realSession.appendMessage({ role: "user", content: [{ type: "text", text: "Old conversation" }], timestamp: Date.now() });
  realSession.appendCompaction("Shortened conversation", null, 100);
  assert.equal(restoreSelection(realSession.getBranch()), sibling.todo.id);
  assert.ok(!realSession.buildContextEntries().some(entry => entry.customType === selectionEntry));
  const fromRealHistory = await instance(realSession.getBranch());
  assert.match((await fromRealHistory.emit("context", { messages: realSession.buildSessionContext().messages }))[0].messages.at(-1).content, /Observe/);

  // Successful checkpoints clear persisted reconciliation, not just the in-memory prompt.
  const reconciliationTodo = await create(root, "simple", "Checkpoint receipt", "Verify compaction reconciliation");
  const checkpointSession = await instance();
  await checkpointSession.call("context_project", { action: "resume", selector: reconciliationTodo.todo.id });
  await checkpointSession.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await checkpointSession.emit("session_compact", { reason: "manual" });
  await checkpointSession.call("context_project_checkpoint", { id: reconciliationTodo.todo.id, revision: 1, key: "post-compaction", changes: {} });
  assert.equal(pendingReconciliation(checkpointSession.stored, reconciliationTodo.todo.id), undefined);
  const checkpointReopened = await instance(checkpointSession.stored);
  assert.doesNotMatch((await checkpointReopened.emit("context", { messages: [] }))[0].messages.at(-1).content, /Compaction reconciliation pending/);

  // Loaded-brief diagnostics replace size nudges, without changing the immutable provider prefix.
  const statsTodo = await create(root, "simple", `Brief diagnostics ${"long title ".repeat(20)}\n`, "Keep the loaded brief metric accurate");
  const statsArtifact = await saveArtifact(root, statsTodo.todo.id, 1, { title: "Required stats reference", kind: "design", description: "Load boundary proof", lifecycle: "current", required: true, applies_to: [], body: "Required evidence" });
  const smallModel = await instance([], true);
  smallModel.ctx.model = { api: "anthropic-messages", contextWindow: 1000 };
  await smallModel.call("context_project", { action: "resume", selector: statsTodo.todo.id });
  const [smallContext] = await smallModel.emit("context", { messages: [] });
  const statsBrief = smallContext.messages.find(message => message.customType === "todo-context-v1");
  const expectedStats = (message, window) => {
    const tokens = estimateTokens({ role: "user", content: [{ type: "text", text: message.content }], timestamp: message.timestamp });
    const compact = tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`;
    return ` · brief ~${compact}${window ? ` (${(tokens / window * 100).toFixed(1)}%)` : ""} · `;
  };
  const assertStats = (session, message, window) => {
    assert.match(session.statuses.at(-1), /^project · (todo|in progress|done|canceled) · brief /);
    assert.ok(session.statuses.at(-1).includes(expectedStats(message, window)), session.statuses.at(-1));
  };
  assertStats(smallModel, statsBrief, 1000);
  assert.match(smallModel.statuses.at(-1), / · Brief diagnostics/); // Metric precedes long, sanitized title.
  assert.doesNotMatch(smallModel.statuses.at(-1), /\n/);
  const storedBeforeRepeat = smallModel.stored.length;
  const [repeatSmall] = await smallModel.emit("context", { messages: smallContext.messages });
  assert.deepEqual(repeatSmall.messages, smallContext.messages);
  assert.equal(smallModel.stored.length, storedBeforeRepeat);
  assert.deepEqual(smallModel.warnings, []);
  assert.ok(!smallModel.stored.some(entry => entry.customType === "todo-context-size-warning-v1"));
  for (const model of [{ contextWindow: 2000 }, undefined, { contextWindow: NaN }, { api: "pi-virtual", contextWindow: 2000 }]) {
    smallModel.ctx.model = model;
    await smallModel.emit("model_select", { model });
    assertStats(smallModel, statsBrief, model?.api === "pi-virtual" ? undefined : model?.contextWindow);
  }
  await smallModel.call("context_project_checkpoint", { id: statsTodo.todo.id, revision: 2, key: "stats-update", changes: { evidence: { add: ["New understanding ".repeat(100)] } } });
  assertStats(smallModel, statsBrief);
  await smallModel.call("context_project", { action: "refresh" });
  const [refreshedStats] = await smallModel.emit("context", { messages: repeatSmall.messages });
  const refreshedBrief = refreshedStats.messages.find(message => message.customType === "todo-context-v1");
  assert.notEqual(refreshedBrief.content, statsBrief.content);
  assertStats(smallModel, refreshedBrief);
  // Reopen reads current footer metadata but retains the delivered brief/drift baseline.
  await checkpoint(root, statsTodo.todo.id, 3, { title: "Updated diagnostics", status: "done" }, "stats-external", "another-session");
  const statsFile = statsArtifact.todo.artifacts[0].path;
  removeBody(statsArtifact, statsFile); // Restoring the metric must not eagerly reload required artifact bodies.
  const statsReopened = await instance(smallModel.stored, true);
  assertStats(statsReopened, refreshedBrief);
  assert.match(statsReopened.statuses.at(-1), /^project · done · .* · Updated diagnostics$/);
  statsReopened.ctx.model = { api: "anthropic-messages", contextWindow: 272000 };
  await statsReopened.emit("model_select", { model: statsReopened.ctx.model });
  assertStats(statsReopened, refreshedBrief, 272000);
  assert.match(statsReopened.statuses.at(-1), /^project · done · .* · Updated diagnostics$/);
  const [statsDrift] = await statsReopened.emit("context", { messages: refreshedStats.messages });
  assert.match(statsDrift.messages.find(message => message.customType === "todo-context-drift-v1").content, /changed outside this session/);
  await assert.rejects(statsReopened.call("context_project", { action: "refresh" }), /Missing current artifact/);
  restoreBody(statsArtifact, statsFile, "Required evidence\n");
  const prepareStatsCompaction = session => session.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await prepareStatsCompaction(statsReopened);
  await statsReopened.emit("session_compact", { reason: "manual" });
  assert.match(statsReopened.statuses.at(-1), /^project · done · brief pending · Updated diagnostics$/);
  await prepareStatsCompaction(smallModel);
  assertStats(smallModel, refreshedBrief);
  await smallModel.emit("session_compact_failed", { aborted: true });
  assertStats(smallModel, refreshedBrief);
  await prepareStatsCompaction(smallModel);
  await smallModel.emit("session_compact_failed", { errorMessage: "Synthetic failure" });
  assertStats(smallModel, refreshedBrief);
  await prepareStatsCompaction(smallModel);
  await smallModel.emit("session_compact", { reason: "manual" });
  assert.match(smallModel.statuses.at(-1), /^project · (in progress|done) · brief pending · /);
  const [postCompactStats] = await smallModel.emit("context", { messages: refreshedStats.messages });
  assertStats(smallModel, postCompactStats.messages.find(message => message.customType === "todo-context-v1"));
  // Already-delivered legacy size notices keep their immutable anchors until a normal reset.
  const legacyBrief = postCompactStats.messages.find(message => message.customType === "todo-context-v1");
  const legacySize = { type: "custom_message", role: "custom", customType: "todo-context-size-warning-v1", content: "Legacy delivered size warning", display: false, details: { load_id: "legacy-size" }, timestamp: Date.now() };
  smallModel.stored.push(legacySize, { type: "custom", customType: "todo-context-anchor-v1", data: { id: "legacy-size", epoch: legacyBrief.details.load_id, after: null } });
  const legacyStats = await instance(smallModel.stored, true);
  assertStats(legacyStats, legacyBrief);
  const [legacyContext] = await legacyStats.emit("context", { messages: [...postCompactStats.messages, legacySize] });
  assert.equal(legacyContext.messages.filter(message => message.customType === legacySize.customType).length, 1);
  assert.deepEqual(legacyStats.warnings, []);
  const [legacyRepeat] = await legacyStats.emit("context", { messages: legacyContext.messages });
  assert.deepEqual(legacyRepeat.messages, legacyContext.messages);
  await legacyStats.call("context_project", { action: "refresh" });
  assert.ok(!(await legacyStats.emit("context", { messages: legacyContext.messages }))[0].messages.some(message => message.customType === legacySize.customType));
  assert.ok(legacyStats.stored.some(entry => entry.details?.load_id === "legacy-size")); // Raw journal remains intact.
  await statsReopened.emit("session_shutdown");
  assert.equal(statsReopened.statuses.at(-1), undefined);
  await smallModel.call("context_project_ack", { id: statsTodo.todo.id, reason: "no_change", explanation: "Saved understanding is current" });
  await smallModel.call("context_project", { action: "leave" });
  assert.equal(smallModel.statuses.at(-1), undefined);
  // Attachment restored before first delivery is pending, never the detached owner's metric.
  const pendingStats = await instance([{ type: "custom", customType: selectionEntry, data: { id: statsTodo.todo.id } }], true);
  assert.match(pendingStats.statuses.at(-1), /^project · done · brief pending · /);
  await pendingStats.emit("model_select", { model: { contextWindow: 1000000 } });
  assert.match(pendingStats.statuses.at(-1), /^project · done · brief pending · /);
  await smallModel.call("context_project", { action: "resume", selector: sibling.todo.id });
  smallModel.ctx.model = { contextWindow: 1000000 };

  // Usage awareness stays lightweight; preservation is an actionable, persisted one-shot boundary.
  const usageNotes = messages => messages.filter(message => message.customType === "todo-context-usage-warning-v1");
  smallModel.ctx.getContextUsage = () => ({ percent: 79.9, tokens: 799000 });
  assert.equal(usageNotes((await smallModel.emit("context", { messages: [] }))[0].messages).length, 0);
  smallModel.ctx.getContextUsage = () => ({ percent: 95, tokens: 950000 });
  const [usageContext] = await smallModel.emit("context", { messages: [] });
  assert.match(usageNotes(usageContext.messages)[0].content, /80% band.*targeted.*bounded reads/);
  assert.equal(usageNotes(usageContext.messages).length, 1);
  const usageWarnings = smallModel.warnings.length;
  await smallModel.emit("context", { messages: usageContext.messages });
  assert.equal(smallModel.warnings.length, usageWarnings);

  const proactiveTodo = await create(root, "simple", "Preservation", "Keep significant understanding");
  const proactive = await instance();
  await proactive.call("context_project", { action: "resume", selector: proactiveTodo.todo.id });
  proactive.ctx.model = { provider: "synthetic", id: "physical", api: "anthropic-messages", contextWindow: 272000 };
  let tokens = 239231;
  proactive.ctx.getContextUsage = () => ({ tokens });
  const turn = { ...boundary, entries: [], message: { role: "assistant", stopReason: "stop" } };
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined);
  tokens++;
  proactive.ctx.settings = { compaction: { enabled: false } };
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined);
  proactive.ctx.settings = { compaction: { modelOverrides: { "synthetic/physical": { reserveTokens: 0 } } } };
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined);
  proactive.ctx.settings = {};
  proactive.ctx.model.api = "pi-virtual";
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined);
  proactive.ctx.model.api = "anthropic-messages";
  tokens = null;
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined);
  tokens = 239232;
  assert.equal((await proactive.emit("turn_end", { ...turn, outcome: "aborted" }))[0], undefined);
  assert.equal((await proactive.emit("turn_end", { ...turn, message: { role: "assistant", stopReason: "error" } }))[0], undefined);
  assert.equal((await proactive.emit("turn_end", { ...turn, context: { canContinue: false } }))[0], undefined);
  tokens = 255616;
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined); // Native compaction wins a jump.
  tokens = 239232;
  const prior = { type: "custom", customType: "other-extension", data: {} };
  const [draft] = await proactive.emit("turn_end", { ...turn, entries: [prior] });
  assert.equal(draft.continue, true);
  assert.equal(draft.entries[0], prior);
  assert.equal(preservationState(proactive.stored, proactiveTodo.todo.id).request, undefined);
  assert.equal((await proactive.emit("turn_end", turn))[0].continue, true, "uncommitted drafts cannot deduplicate");
  proactive.stored.push(...draft.entries.map(entry => ({ ...entry, timestamp: 8000 })));
  const persistedUser = { role: "user", content: "Work", timestamp: 7000 };
  proactive.stored.push({ type: "message", message: persistedUser });
  const [delivered] = await proactive.emit("context", { messages: [persistedUser] });
  const request = delivered.messages.find(message => message.customType === preservationType);
  assert(request);
  const nextUser = { role: "user", content: "Continue", timestamp: 9000 };
  proactive.stored.push({ type: "message", message: nextUser });
  const [stable] = await proactive.emit("context", { messages: [...delivered.messages, nextUser] });
  assert.equal(stable.messages.indexOf(request), delivered.messages.indexOf(request));
  proactive.ctx.model = { ...proactive.ctx.model, id: "another-physical" };
  proactive.ctx.settings = { compaction: { reserveTokens: 10000 } };
  assert.equal((await proactive.emit("turn_end", turn))[0], undefined, "model/settings changes cannot repeat a committed pass");
  await assert.rejects(proactive.call("context_project_checkpoint", { id: proactiveTodo.todo.id, revision: 99, key: "stale-pass", changes: {} }), /Stale revision/);
  await proactive.call("context_project_checkpoint", { id: reconciliationTodo.todo.id, revision: 2, key: "other-owner", changes: {} });
  await proactive.call("context_project_artifact", { action: "upsert", id: proactiveTodo.todo.id, revision: 1, title: "Understanding", kind: "research", description: "Relevant findings", lifecycle: "current", required: false, applies_to: [], body: "# Findings" });
  await proactive.call("context_project_tighten", { id: proactiveTodo.todo.id, revision: 2, reason: "Verified consolidation" });
  assert.equal(preservationState(proactive.stored, proactiveTodo.todo.id).outcome, undefined);
  const pendingReopened = await instance(proactive.stored);
  pendingReopened.ctx.model = proactive.ctx.model;
  pendingReopened.ctx.getContextUsage = proactive.ctx.getContextUsage;
  const [replayed] = await pendingReopened.emit("context", { messages: stable.messages });
  assert.equal(replayed.messages.filter(message => message.customType === preservationType).length, 1);
  assert.equal((await pendingReopened.emit("turn_end", turn))[0], undefined);
  await pendingReopened.call("context_project", { action: "refresh" });
  const [refreshedPass] = await pendingReopened.emit("context", { messages: replayed.messages });
  assert.equal(refreshedPass.messages.filter(message => message.customType === preservationType).length, 1);
  assert.equal((await pendingReopened.emit("turn_end", turn))[0], undefined);
  await pendingReopened.call("context_project_ack", { id: proactiveTodo.todo.id, reason: "needs_approval", explanation: "May we change direction?" });
  assert.equal(preservationState(pendingReopened.stored, proactiveTodo.todo.id).outcome, "needs_approval");
  assert((await locate(root, proactiveTodo.todo.id)).todo.open_questions.some(question => question.text.includes("May we change direction?")));
  await pendingReopened.call("context_project", { action: "refresh" });
  assert.equal((await pendingReopened.emit("context", { messages: refreshedPass.messages }))[0].messages.filter(message => message.customType === preservationType).length, 0);
  pendingReopened.stored.push({ type: "compaction", id: "native-cycle-2" });
  const [secondPass] = await pendingReopened.emit("turn_end", turn);
  pendingReopened.stored.push(...secondPass.entries);
  await pendingReopened.call("context_project_ack", { id: proactiveTodo.todo.id, reason: "no_change", explanation: "Saved understanding is current" });
  assert.equal(preservationState(pendingReopened.stored, proactiveTodo.todo.id).outcome, "no_change");
  await pendingReopened.call("context_project", { action: "leave" });
  assert.equal((await pendingReopened.emit("context", { messages: refreshedPass.messages }))[0].messages.filter(message => message.customType === preservationType).length, 0);

  // Switching removes pending instructions, without resetting the owner/cycle deduplication.
  pendingReopened.stored.push({ type: "compaction", id: "native-cycle-3" });
  await pendingReopened.call("context_project", { action: "resume", selector: proactiveTodo.todo.id });
  const [thirdPass] = await pendingReopened.emit("turn_end", turn);
  pendingReopened.stored.push(...thirdPass.entries);
  pendingReopened.ctx.hasUI = true;
  pendingReopened.confirmations.push(true); // Explicitly switch without another checkpoint.
  await pendingReopened.call("context_project", { action: "resume", selector: sibling.todo.id });
  assert.equal((await pendingReopened.emit("context", { messages: refreshedPass.messages }))[0].messages.filter(message => message.customType === preservationType).length, 0);
  assert.equal((await pendingReopened.emit("turn_end", turn))[0].continue, true, "another owner has independent eligibility");

  // Legacy passive 90% notes are still restored as owned messages.
  const epoch = usageContext.messages.find(message => message.customType === "todo-context-v1").details.load_id;
  const legacyUsage = await instance([...smallModel.stored,
    { type: "custom_message", customType: "todo-context-usage-warning-v1", content: "Legacy 90%", details: { load_id: "legacy-90" }, timestamp: 1 },
    { type: "custom", customType: "todo-context-anchor-v1", data: { id: "legacy-90", epoch, after: null } },
  ]);
  assert((await legacyUsage.emit("context", { messages: usageContext.messages }))[0].messages.some(message => message.content === "Legacy 90%"));

  // Real SDK scheduling, tools and saver; only the provider transport is synthetic (including summaries).
  const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SettingsManager } = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
  const { AssistantMessageEventStream } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")));
  const sdkTodo = await create(root, "simple", "SDK preservation", "Verify ordinary-agent persistence and native priority");
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: true, reserveTokens: 10000, keepRecentTokens: 1000 }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(scratch, "sdk-auth.json"), modelsPath: null, modelsStorePath: join(scratch, "sdk-models.json"), allowModelNetwork: false });
  let phase = "preserve"; let providerTurns = 0; let summaries = 0;
  const requests = [];
  const largeRead = join(scratch, "large-tool-result.txt");
  await writeFile(largeRead, "Synthetic tool evidence, with enough text per line to reach the byte limit.\n".repeat(1400));
  modelRuntime.registerProvider("todo-synthetic", {
    api: "anthropic-messages", apiKey: "synthetic", baseUrl: "https://invalid.example",
    models: [{ id: "physical", name: "Synthetic", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }],
    streamSimple(model, context) {
      const stream = new AssistantMessageEventStream();
      const isSummary = JSON.stringify(context).includes("You are a context summarization assistant");
      let content; let input;
      if (isSummary) { summaries++; content = [{ type: "text", text: "## Goal\nSynthetic preservation check.\n## Progress\nCheckpoint saved; verification remains synthetic." }]; input = 1000; }
      else {
        requests.push(structuredClone(context)); providerTurns++;
        if (phase === "preserve" && providerTurns === 1) { content = [{ type: "text", text: "A meaningful finding is ready to preserve." }]; input = 81000; }
        else if (phase === "preserve" && providerTurns === 2) { content = [{ type: "toolCall", id: "sdk-checkpoint", name: "codemode", arguments: { code: `text(await tools.context_project_checkpoint(${JSON.stringify({ id: sdkTodo.todo.id, revision: 1, key: "sdk-pass", changes: { evidence: { add: ["Synthetic provider exercised the real checkpoint; no live-model compliance claim."] } } })}));` } }]; input = 82000; }
        else if (phase === "jump" && providerTurns === 1) { content = [{ type: "toolCall", id: "sdk-large-read", name: "read", arguments: { path: largeRead } }]; input = 79000; }
        else { content = [{ type: "text", text: "Continue within the existing assignment." }]; input = phase === "preserve" ? 83000 : 1000; }
      }
      const stopReason = content.some(block => block.type === "toolCall") ? "toolUse" : "stop";
      const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(), usage: { input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "done", reason: stopReason, message }); stream.end(); return stream;
    },
  });
  const resourceLoader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager, additionalExtensionPaths: [join(directory, "index.ts")], extensionFactories: [createCodemodeExtension({ models: false })], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const sdkManager = SessionManager.inMemory(scratch);
  sdkManager.appendCustomEntry(selectionEntry, { id: sdkTodo.todo.id });
  const { session } = await createAgentSession({ cwd: scratch, agentDir: scratch, model: modelRuntime.getModel("todo-synthetic", "physical"), modelRuntime, settingsManager, sessionManager: sdkManager, resourceLoader });
  session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  const sdkEvents = [];
  await session.bindExtensions({ onError: error => { throw error; } });
  session.subscribe(event => sdkEvents.push(event));
  try {
    await session.prompt("Preserve the meaningful finding, without starting other work.");
    assert.equal(providerTurns, 3, "boundary continuation plus natural tool follow-up, no competing run");
    assert(JSON.stringify(requests[1]).includes("Before further substantive work"));
    assert.equal((await locate(root, sdkTodo.todo.id)).todo.revision, 2);
    assert.match((await locate(root, sdkTodo.todo.id)).todo.current_state.evidence[0].text, /real checkpoint/);
    assert.equal(preservationState(sdkManager.getBranch(), sdkTodo.todo.id).outcome, "checkpoint");
    assert(sdkManager.getBranch().some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.nestedCalls?.calls.some(call => call.name === "context_project_checkpoint")), "checkpoint ran through real nested codemode execution");
    assert.equal(sdkManager.getBranch().filter(entry => entry.customType === preservationType).length, 1);
    await session.compact();
    assert.equal(summaries, 1, "manual compaction uses the native compactor and synthetic summary transport");
    phase = "jump"; providerTurns = 0;
    await session.prompt("Read the synthetic evidence file, then continue normally.");
    assert.equal(providerTurns, 2);
    assert.equal(summaries, 2, "tool-result jump invokes native threshold compaction before follow-up");
    assert(sdkEvents.some(event => event.type === "compaction_start" && event.reason === "threshold"));
    assert.equal(sdkManager.getBranch().filter(entry => entry.type === "compaction").length, 2);
    assert.equal(sdkManager.getBranch().filter(entry => entry.customType === preservationType).length, 1, "threshold jump does not force preservation ahead of native compaction");
    assert(JSON.stringify(requests.at(-1)).includes("Compaction reconciliation pending"));
  } finally { session.dispose(); }

  // Autonomous saving records existing user approval without another confirmation; no approval still fails closed.
  const autonomousTodo = await create(root, "simple", "Autonomous saving", "Original outcome");
  const auto = await instance();
  await auto.call("context_project", { action: "resume", selector: autonomousTodo.todo.id });
  const autoChanges = { outcome: "User-approved outcome", approval_evidence: "User: use the revised outcome", decisions: [{ summary: "Keep history readable", rationale: "Preserve evidence", approval: "approved", evidence: [] }], questions: [{ text: "Exact owner ID is not yet verified" }, { text: "Was the old scope approved?", resolution: "No; user approved only the revised outcome" }] };
  const autoSaved = await auto.call("context_project_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges });
  assert.ok(autoSaved.todo.decisions[0].evidence.includes("User approval: User: use the revised outcome"));
  assert.ok(autoSaved.todo.current_state.evidence.some(row => row.text === "User approval: User: use the revised outcome"));
  const approvalReplay = await auto.callRaw("context_project_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges });
  assert.deepEqual(approvalReplay.structuredContent.todo, autoSaved.todo);
  assert.deepEqual(approvalReplay.details, approvalReplay.structuredContent);
  assert.deepEqual(JSON.parse(approvalReplay.content[0].text), {
    saved: true, revision: autoSaved.todo.revision, decision_ids: autoSaved.todo.decisions.map(row => row.id), question_ids: autoSaved.todo.open_questions.map(row => row.id),
  });
  assert.deepEqual((await locate(root, autonomousTodo.todo.id)).todo, autoSaved.todo);
  await assert.rejects(auto.call("context_project_checkpoint", { id: autonomousTodo.todo.id, revision: 2, key: "no-approval", changes: { outcome: "Unapproved outcome" } }), /sign-off/);

  // Tightening changes durable orientation without rewriting the current conversation.
  const optional = await auto.call("context_project_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: 2, title: "Old implementation detail", kind: "research", description: "No longer needed to orient", lifecycle: "current", required: false, applies_to: [], body: "HISTORICAL_DETAIL" });
  const hide = { id: autonomousTodo.todo.id, revision: 3, reason: "Verified progress makes earlier detail redundant; active outcome retained", consult_on_demand_decisions: [autoSaved.todo.decisions[0].id], consult_on_demand_artifacts: [optional.todo.artifacts[0].id], evidence: { remove: autoSaved.todo.current_state.evidence.map(row => row.id), add: ["Verified progress"] }, references: [] };
  const tightened = await auto.call("context_project_tighten", hide);
  assert.equal(tightened.revision, 4);
  assert.equal(tightened.todo, undefined); assert.equal(tightened.context_refreshed, false);
  const history = await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id });
  assert.equal(history.todo.decisions.length, 1);
  const changedHiddenDecision = applyChanges(history.todo, { decisions: [{ ...history.todo.decisions[0], summary: "Updated active rule" }] });
  assert.deepEqual(changedHiddenDecision.context_policy.consult_on_demand_decisions, []);
  assert.equal(history.todo.context_policy.consult_on_demand_decisions.length, 1); // Input remains immutable.
  assert.equal(history.todo.outcome, "User-approved outcome");
  assert.deepEqual(history.todo.artifacts, optional.todo.artifacts);
  assert.equal(withRead(itemRoot(history), db => db.prepare("SELECT count(*) AS n FROM artifact_revisions WHERE owner_id=?").get(history.todo.id).n), 1);
  assert.match((await auto.call("context_project_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: optional.todo.artifacts[0].id })).body, /HISTORICAL_DETAIL/);
  const bytesBeforeActive = await savedJSON(history);
  const activeView = await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.equal(activeView.todo.decisions.length, 0);
  assert.equal(activeView.todo.artifacts.length, 0);
  assert.deepEqual(activeView.todo.open_questions, history.todo.open_questions.filter(q => !q.resolution));
  assert.deepEqual(activeView.todo.current_state, history.todo.current_state);
  assert.equal("next_actions" in activeView.todo, false);
  assert.deepEqual(activeView.dependency, history.dependency);
  assert.equal(activeView.todo.context_policy, undefined);
  assert.equal(activeView.todo.last_checkpoint, undefined);
  assert.deepEqual(await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id, view: "full" }), history);
  assert.equal(await savedJSON(history), bytesBeforeActive);
  const hiddenBundle = await resumeBundle(root, autonomousTodo.todo.id);
  assert.deepEqual(activeView.todo, hiddenBundle.project.context);
  assert.equal(hiddenBundle.project.context.decisions.length, 0); assert.equal(hiddenBundle.project.context.artifacts.length, 0);
  const [tightenedContext] = await auto.emit("context", { messages: auto.stored.filter(m => m.type === "custom_message") });
  assert.equal(tightenedContext.messages.filter(m => m.customType === "todo-context-v1").length, 1);
  assert.equal(auto.stored.filter(m => m.customType === "todo-context-v1").length, 1);
  assert.match(tightenedContext.messages.find(m => m.customType === "todo-context-v1").content, /Original outcome/);
  await auto.call("context_project", { action: "refresh" });
  const [resetTightenedContext] = await auto.emit("context", { messages: tightenedContext.messages });
  assert.doesNotMatch(resetTightenedContext.messages.find(m => m.customType === "todo-context-v1").content, /Keep history readable/);
  await assert.rejects(auto.call("context_project_tighten", hide), /Stale/);
  await assert.rejects(auto.call("context_project_tighten", { ...hide, revision: 4, evidence: { add: ["Invalid visibility must roll back this finding"] }, consult_on_demand_decisions: [project.todo.id] }), /existing record IDs/);
  const restored = await auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: 4, reason: "Earlier decision is relevant again", restore_decisions: [autoSaved.todo.decisions[0].id], restore_artifacts: [optional.todo.artifacts[0].id] });
  assert.equal(restored.revision, 5);
  const restoredActive = await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.deepEqual(restoredActive.todo.decisions, autoSaved.todo.decisions); // Rationale, evidence and approval retained verbatim.
  assert.deepEqual(restoredActive.todo.artifacts, optional.todo.artifacts);
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).project.context.decisions.length, 1);
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).project.context.artifacts.length, 1);
  const required = await auto.call("context_project_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: 5, title: "Active constraints", kind: "design", description: "Required safety boundary", lifecycle: "current", required: true, applies_to: [], body: "Required constraints" });
  await assert.rejects(auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: 6, reason: "Cannot hide required context", consult_on_demand_decisions: [], consult_on_demand_artifacts: [required.todo.artifacts.at(-1).id] }), /Required artifacts/);
  assert.equal((await locate(root, autonomousTodo.todo.id)).todo.revision, 6);
  const requiredRow = required.todo.artifacts.at(-1);
  const requiredPath = requiredRow.path;
  removeBody(required, requiredPath);
  const savedWithoutRefresh = await auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: 6, reason: "Restore visibility", consult_on_demand_decisions: [], consult_on_demand_artifacts: [] });
  assert.equal(savedWithoutRefresh.revision, 7);
  assert.equal(savedWithoutRefresh.context_refreshed, false); // Tightening does not reread artifact bodies.
  await assert.rejects(auto.call("context_project", { action: "refresh" }), /Missing current artifact/);
  assert.equal((await locate(root, autonomousTodo.todo.id)).todo.revision, 7);
  restoreBody(required, requiredPath, "Required constraints\n");
  const hiddenArtifact = await auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: 7, reason: "Old artifact is historical", consult_on_demand_decisions: [], consult_on_demand_artifacts: [optional.todo.artifacts[0].id] });
  // Required artifacts load as an index (title, description, size), not bodies; retiring demotes them to readable reference.
  const requiredIndex = (await resumeBundle(root, autonomousTodo.todo.id)).required_artifacts;
  assert.deepEqual(requiredIndex.map(({ artifact_id, chars, body }) => ({ artifact_id, chars, body })), [{ artifact_id: requiredRow.id, chars: "Required constraints\n".length, body: undefined }]);
  await assert.rejects(auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: hiddenArtifact.revision, reason: "Bad ID", consult_on_demand_decisions: [], consult_on_demand_artifacts: [optional.todo.artifacts[0].id], retire_artifacts: [project.todo.id] }), /existing artifact IDs/);
  const retired = await auto.call("context_project_tighten", { id: autonomousTodo.todo.id, revision: hiddenArtifact.revision, reason: "Slice merged", consult_on_demand_decisions: [], consult_on_demand_artifacts: [], retire_artifacts: [requiredRow.id] });
  const retiredRow = (await locate(root, autonomousTodo.todo.id)).todo.artifacts.find(a => a.id === requiredRow.id);
  assert.deepEqual([retiredRow.required, retiredRow.lifecycle], [false, "reference"]);
  assert.deepEqual(retired.context_policy.consult_on_demand_artifacts, [optional.todo.artifacts[0].id]); // Empty hide lists keep earlier hidden items hidden.
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).required_artifacts.length, 0);
  assert.match((await auto.call("context_project_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: requiredRow.id })).body, /Required constraints/);
  const activeAgain = await auto.call("context_project_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: retired.revision, artifact_id: optional.todo.artifacts[0].id, title: "Updated current detail", kind: "research", description: "Now relevant", lifecycle: "current", required: false, applies_to: [], body: "Updated detail" });
  assert.deepEqual(activeAgain.todo.context_policy.consult_on_demand_artifacts, []);
  const superseding = await auto.call("context_project_checkpoint", { id: autonomousTodo.todo.id, revision: activeAgain.todo.revision, key: "replace-rule", changes: {
    approval_evidence: "User: replace the earlier rule with a scoped draft for investigation",
    decisions: [{ summary: "Investigate scoped_owner_id, not global_owner_id", rationale: "Global ownership may misroute; scope is still unverified", approval: "draft", evidence: ["Research synthesis: scoped ownership remains uncertain"], supersedes: autoSaved.todo.decisions[0].id }],
  } });
  const supersedingActive = await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.deepEqual(supersedingActive.todo.decisions, [superseding.todo.decisions.at(-1)]);
  assert.equal((await auto.call("context_project", { action: "get", selector: autonomousTodo.todo.id })).todo.decisions.length, 2);
  await auto.extension.commands.get("context").handler("tighten", auto.ctx);
  assert.equal(auto.stored.at(-1).type, "user_request");

  // Boundary loads are retained once: no artifact rereads or full refreshes on ordinary/local-update requests.
  const boundaryTodo = await create(root, "simple", "Boundary efficiency", "Read once and preserve foreground updates");
  const boundaryArtifact = await saveArtifact(root, boundaryTodo.todo.id, 1, { title: "Required brief", kind: "design", description: "Read-once reference", lifecycle: "current", required: true, applies_to: [], body: "READ_ONCE_REQUIRED_BODY" });
  const boundarySession = await instance();
  await boundarySession.call("context_project", { action: "resume", selector: boundaryTodo.todo.id });
  const noteMessages = () => boundarySession.stored.filter(entry => entry.customType === "todo-context-v1");
  const [firstBoundaryContext] = await boundarySession.emit("context", { messages: noteMessages() });
  assert.equal(noteMessages().length, 1);
  const requiredFile = boundaryArtifact.todo.artifacts[0].path;
  removeBody(boundaryArtifact, requiredFile);
  const [readOnce] = await boundarySession.emit("context", { messages: firstBoundaryContext.messages });
  assert.equal(boundarySession.ctx.aborted, undefined); assert.equal(noteMessages().length, 1);
  assert.match(readOnce.messages[0].content, /"title":"Required brief","kind":"design","description":"Read-once reference","chars":24/); assert.doesNotMatch(readOnce.messages[0].content, /READ_ONCE_REQUIRED_BODY/);
  await assert.rejects(boundarySession.call("context_project", { action: "refresh" }), /Missing current artifact/);
  restoreBody(boundaryArtifact, requiredFile, "READ_ONCE_REQUIRED_BODY\n");
  await boundarySession.extension.commands.get("context").handler("refresh", boundarySession.ctx);
  const [refreshedBoundary] = await boundarySession.emit("context", { messages: boundarySession.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(noteMessages().length, 2);
  assert.equal(refreshedBoundary.messages.filter(message => message.customType === "todo-context-v1").length, 1);
  const external = await checkpoint(root, boundaryTodo.todo.id, 2, { evidence: { add: ["External finding"] } }, "external-write", "other-session");
  const [drift] = await boundarySession.emit("context", { messages: refreshedBoundary.messages });
  assert.match(drift.messages.at(-1).content, /changed outside this session/);
  assert.equal(noteMessages().length, 2);
  const driftCount = () => boundarySession.stored.filter(entry => entry.customType === "todo-context-drift-v1").length;
  await boundarySession.emit("context", { messages: drift.messages }); assert.equal(driftCount(), 1);
  await boundarySession.call("context_project", { action: "get", selector: boundaryTodo.todo.id, view: "active" });
  const own = await boundarySession.call("context_project_checkpoint", { id: boundaryTodo.todo.id, revision: external.todo.revision, key: "own-write", changes: { evidence: { update: [{ id: external.todo.current_state.evidence[0].id, text: "Verify the finding" }] } } });
  assert.equal(own.todo.revision, 4);
  const [ownContext] = await boundarySession.emit("context", { messages: drift.messages });
  assert.ok(ownContext.messages.some(message => message.customType === "todo-context-drift-v1")); // Reading/acknowledging does not erase delivered input.
  assert.equal(noteMessages().length, 2);
  await boundarySession.emit("before_agent_start");
  await boundarySession.call("context_project_ack", { id: boundaryTodo.todo.id, reason: "no_change", explanation: "Read only so far" });
  await boundarySession.emit("tool_execution_end", { toolName: "write", args: {}, isError: false });
  assert.deepEqual(await boundarySession.emit("agent_before_settle", boundary), []);
  assert.ok(!boundarySession.stored.some(entry => entry.customType === checkpointMessage));
  await boundarySession.call("context_project_ack", { id: boundaryTodo.todo.id, reason: "no_change", explanation: "Output did not change durable knowledge" });
  await boundarySession.call("context_project", { action: "leave" });
  const [detachedContext] = await boundarySession.emit("context", { messages: ownContext.messages });
  assert.ok(!detachedContext.messages.some(message => message.customType === "todo-context-v1"));
  assert.match(detachedContext.messages.at(-1).content, /No active project/);

  // Provider-facing lifecycle: Pi can persist notes AFTER the response that first saw them.
  // Use the actual serializer, stopping before HTTP; internal state/storage collaborators stay real.
  const aiRoot = join(packageRoot, "node_modules/@earendil-works/pi-ai/dist");
  const { stream: anthropicStream } = await import(pathToFileURL(join(aiRoot, "api/anthropic-messages.js")));
  const { ANTHROPIC_MODELS } = await import(pathToFileURL(join(aiRoot, "providers/anthropic.models.js")));
  const { convertToLlm } = await import(pathToFileURL(join(packageRoot, "dist/core/messages.js")));
  const anthropicModel = Object.values(ANTHROPIC_MODELS).find(model => model.id === "claude-opus-5-5");
  assert.ok(anthropicModel);
  const providerPayload = async messages => {
    let payload;
    await anthropicStream(anthropicModel, { messages: [{ role: "system", content: "Stable test system", timestamp: 0 }, ...convertToLlm(messages)] }, {
      client: {}, thinkingEnabled: true, effort: "medium",
      onPayload(value) { payload = structuredClone(value); throw new Error("Stop before HTTP"); },
    }).result();
    assert.ok(payload);
    // Breakpoint markers may move; they are not part of Anthropic's thinking-prefix binding.
    const content = payload.messages.filter(message => !(message.role === "system" && message.output_config && message.content.length === 0)).map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(({ cache_control, ...block }) => block) : message.content }));
    return { payload, content };
  };
  const cacheTodo = await create(root, "simple", "Cache stability", "Preserve material memory without changing routine request prefixes");
  const cached = await instance([], true, true);
  cached.ctx.model = { ...anthropicModel, contextWindow: 1000 };
  cached.stored.push({ type: "message", message: { role: "user", content: "Start", timestamp: 100 } });
  const historyMessages = session => session.stored.flatMap(entry => entry.type === "message" ? [entry.message] : entry.type === "custom_message" ? [{ ...entry, role: "custom" }] : []);
  const respond = (session, n) => session.stored.push(
    { type: "message", message: { role: "assistant", api: anthropicModel.api, provider: anthropicModel.provider, model: anthropicModel.id, responseId: `response-${n}`, timestamp: 100 + n * 2, stopReason: "toolUse", providerThinkingLevel: "medium", content: [{ type: "thinking", thinking: "Synthetic reasoning", thinkingSignature: `signature-${n}` }, { type: "toolCall", id: `call-${n}`, name: "read", arguments: { path: "synthetic" } }] } },
    { type: "message", message: { role: "toolResult", timestamp: 101 + n * 2, toolCallId: `call-${n}`, toolName: "read", content: [{ type: "text", text: "Synthetic result" }] } },
  );
  const thinking = messages => messages.flatMap(message => message.role === "assistant" ? message.content.filter(block => block.type === "thinking").map(block => block.thinkingSignature) : []);
  await cached.call("context_project", { action: "resume", selector: cacheTodo.todo.id });
  const [firstCache] = await cached.emit("context", { messages: historyMessages(cached) });
  const firstPayload = await providerPayload(firstCache.messages);
  assert.equal(cached.stored.filter(entry => entry.type === "custom_message").length, 0); // Still queued.
  respond(cached, 1); cached.flush();
  const [secondCache] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.deepEqual((await providerPayload(secondCache.messages)).content.slice(0, firstPayload.content.length), firstPayload.content);
  assert.deepEqual(thinking(secondCache.messages), ["signature-1"]);
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-size-warning-v1").length, 0);
  const externalCache = await checkpoint(root, cacheTodo.todo.id, 1, { evidence: { add: ["External finding"] } }, "cache-external", "other-session");
  const [withDrift] = await cached.emit("context", { messages: historyMessages(cached) });
  const driftPayload = await providerPayload(withDrift.messages);
  respond(cached, 2); cached.flush();
  await cached.call("context_project", { action: "get", selector: cacheTodo.todo.id, view: "active" });
  await cached.call("context_project_checkpoint", { id: cacheTodo.todo.id, revision: externalCache.todo.revision, key: "cache-local", changes: { evidence: { update: [{ id: externalCache.todo.current_state.evidence[0].id, text: "Verify external finding" }] } } });
  const [acknowledgedDrift] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.deepEqual((await providerPayload(acknowledgedDrift.messages)).content.slice(0, driftPayload.content.length), driftPayload.content);
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);
  await cached.extension.commands.get("context").handler("status in_progress", cached.ctx); cached.flush();
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);

  // Both integrated modules: task snapshots are persisted at run boundaries, never a moving context tail.
  const jointTodo = await create(root, "simple", "Cross-extension cache", "Keep task and project context stable together");
  const joint = await instance([], true, true, true);
  joint.ctx.model = cached.ctx.model;
  joint.stored.push({ type: "message", message: { role: "user", content: "Start combined session", timestamp: 1000 } });
  await joint.call("task", { action: "create", subject: "Investigate", description: "Keep context stable" });
  await joint.call("context_project", { action: "resume", selector: jointTodo.todo.id });
  await joint.emit("before_agent_start");
  const [jointFirst] = await joint.emit("context", { messages: historyMessages(joint) });
  const jointFirstPayload = await providerPayload(jointFirst.messages);
  respond(joint, 10); joint.flush();
  const [jointNext] = await joint.emit("context", { messages: historyMessages(joint) });
  assert.deepEqual((await providerPayload(jointNext.messages)).content.slice(0, jointFirstPayload.content.length), jointFirstPayload.content);
  assert.equal(joint.stored.filter(entry => entry.customType === "task-context-v1").length, 1);
  await checkpoint(root, jointTodo.todo.id, 1, { evidence: { add: ["External finding"] } }, "joint-external", "other-session");
  // Reproduce the old task hook's ephemeral user tail. It must not become the new drift notice's anchor.
  const ephemeralTail = { role: "user", content: "Current session tasks (transient)", timestamp: 424242 };
  await joint.emit("context", { messages: [...historyMessages(joint), ephemeralTail] });
  assert.ok(joint.stored.filter(entry => entry.customType === "todo-context-anchor-v1").every(entry => entry.data.after !== JSON.stringify(["user", 424242, null, null])));
  const [jointDrift] = await joint.emit("context", { messages: historyMessages(joint) });
  assert.equal(joint.ctx.aborted, undefined);
  const jointDriftPayload = await providerPayload(jointDrift.messages);
  respond(joint, 11); joint.flush();
  await joint.call("task", { action: "update", id: "1", status: "in_progress" });
  const [jointAfterTool] = await joint.emit("context", { messages: historyMessages(joint) });
  assert.deepEqual((await providerPayload(jointAfterTool.messages)).content.slice(0, jointDriftPayload.content.length), jointDriftPayload.content);
  joint.stored.push({ type: "message", message: { role: "user", content: "Continue", timestamp: 2000 } });
  await joint.emit("before_agent_start");
  assert.equal(joint.stored.filter(entry => entry.customType === "task-context-v1").length, 2);
  const [jointContinued] = await joint.emit("context", { messages: historyMessages(joint) });
  assert.deepEqual((await providerPayload(jointContinued.messages)).content.slice(0, jointDriftPayload.content.length), jointDriftPayload.content);
  const jointReopened = await instance(JSON.parse(JSON.stringify(joint.stored)), true, true, true);
  jointReopened.ctx.model = joint.ctx.model;
  await jointReopened.emit("before_agent_start");
  const [jointReplay] = await jointReopened.emit("context", { messages: historyMessages(jointReopened) });
  assert.equal(jointReopened.stored.filter(entry => entry.customType === "task-context-v1").length, 2);
  assert.deepEqual((await providerPayload(jointReplay.messages)).content, (await providerPayload(jointContinued.messages)).content);

  // Project boundaries never reassign, rewind or complete the session task board.
  await jointReopened.call("task", { action: "create", subject: "Verify", description: "Keep dependency", dependsOn: ["1"] });
  const jointTasks = await jointReopened.call("task", { action: "list" });
  await jointReopened.call("context_project", { action: "refresh" });
  await jointReopened.emit("session_compact", { compactionEntry: { id: "joint-compact" }, reason: "manual" });
  await jointReopened.emit("context", { messages: historyMessages(jointReopened) });
  assert.deepEqual(await jointReopened.call("task", { action: "list" }), jointTasks);
  await assert.rejects(jointReopened.call("context_project", { action: "leave" }), /Checkpoint or acknowledge/);
  await jointReopened.call("context_project_ack", { id: jointTodo.todo.id, reason: "no_change", explanation: "Only testing lifecycle boundaries" });
  const switchTodo = await create(root, "simple", "Switch boundary", "Keep session tasks independent");
  await jointReopened.call("context_project", { action: "resume", selector: switchTodo.todo.id });
  await jointReopened.call("context_project_ack", { id: switchTodo.todo.id, reason: "no_change", explanation: "Only testing switch" });
  await jointReopened.call("context_project", { action: "leave" });
  assert.deepEqual(await jointReopened.call("task", { action: "list" }), jointTasks);
  await jointReopened.call("task", { action: "update", id: "1", status: "completed" });
  assert.deepEqual((await jointReopened.call("task", { action: "get", id: "2" })).tasks[0].blockedBy, []);
  assert.equal((await locate(root, switchTodo.todo.id)).todo.status, "todo");
  assert.equal((await locate(root, jointTodo.todo.id)).todo.status, "in_progress");
  assert.equal(withRead(root, db => db.prepare("SELECT count(*) n FROM knowledge_entries").get().n), 0); // Task completion never promotes knowledge.

  // Saved model2 sessions from the old namespace refresh once, without rewriting history.
  const namespaceOwner = await instance();
  await namespaceOwner.call("context_project", { action: "resume", selector: boundaryTodo.todo.id });
  const namespacePending = { id: boundaryTodo.todo.id, revision: own.todo.revision, pending: true, reason: "manual" };
  namespaceOwner.stored.push({ type: "custom", customType: compactionEntry, data: namespacePending });
  await namespaceOwner.emit("context", { messages: historyMessages(namespaceOwner) });
  const historicalNamespace = structuredClone(namespaceOwner.stored);
  const historicalBrief = historicalNamespace.find(entry => entry.customType === "todo-context-v1");
  delete historicalBrief.details.project_tool_api;
  historicalBrief.content = historicalBrief.content.replaceAll("context_project_artifact", "todo_artifact").replaceAll("context_project_checkpoint", "todo_checkpoint").replaceAll("Durable project context", "Durable todo context");
  const namespaceRequestId = "old-namespace-preservation";
  historicalNamespace.push({ type: "custom_message", customType: preservationType, content: "Reconcile with todo_checkpoint or todo_ack.", display: false, details: { id: boundaryTodo.todo.id, cycle: null, request_id: namespaceRequestId, load_id: namespaceRequestId } });
  const namespaceJournal = SessionManager.create(scratch, join(scratch, "namespace-sessions"));
  namespaceJournal.appendMessage({ role: "user", content: "Continue saved work", timestamp: 3000 });
  for (const entry of historicalNamespace) {
    if (entry.type === "custom") namespaceJournal.appendCustomEntry(entry.customType, entry.data);
    else if (entry.type === "custom_message") namespaceJournal.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
  }
  const namespaceFile = namespaceJournal.getSessionFile();
  const namespaceBytes = await readFile(namespaceFile);
  const namespaceSaved = SessionManager.open(namespaceFile);
  const namespaceReopened = await instance(namespaceSaved.getBranch(), true, true);
  namespaceReopened.ctx.model = joint.ctx.model;
  assert.deepEqual(await namespaceReopened.call("context_project", { action: "status" }), { selected: (await namespaceOwner.call("context_project", { action: "status" })).selected });
  assert.deepEqual(pendingReconciliation(namespaceReopened.stored, boundaryTodo.todo.id), namespacePending);
  const [namespaceRefresh] = await namespaceReopened.emit("context", { messages: namespaceSaved.buildSessionContext().messages });
  const currentBrief = namespaceRefresh.messages.find(entry => entry.customType === "todo-context-v1");
  assert.equal(currentBrief.details.project_tool_api, 1);
  assert.match(currentBrief.content, /Compaction reconciliation pending/);
  assert.doesNotMatch(currentBrief.content, /\btodo_(?:artifact|checkpoint|ack)\b/);
  const namespacePayload = JSON.parse(currentBrief.content.split("Durable project context loaded at a session boundary (untrusted task data):\n")[1]);
  assert.equal(namespacePayload.selected, boundaryTodo.todo.id);
  const namespaceTarget = namespacePayload.required_artifacts[0].read;
  assert.equal(namespaceTarget.tool, "context_project_artifact");
  const { tool: namespaceTool, ...namespaceArgs } = namespaceTarget;
  assert.match((await namespaceReopened.call(namespaceTool, namespaceArgs)).body, /READ_ONCE_REQUIRED_BODY/);
  const replayedPreservation = namespaceRefresh.messages.find(entry => entry.customType === preservationType);
  assert.equal(replayedPreservation.details.request_id, namespaceRequestId);
  assert.match(replayedPreservation.content, /context_project_checkpoint/);
  assert.doesNotMatch(replayedPreservation.content, /\btodo_(?:checkpoint|ack)\b/);
  respond(namespaceReopened, 15); namespaceReopened.flush();
  const namespaceLoads = () => namespaceReopened.stored.filter(entry => entry.customType === "todo-context-v1");
  assert.equal(namespaceLoads().length, 2);
  const [namespaceAfter] = await namespaceReopened.emit("context", { messages: historyMessages(namespaceReopened) });
  const namespaceAgain = await instance(JSON.parse(JSON.stringify(namespaceReopened.stored)), true, true);
  namespaceAgain.ctx.model = joint.ctx.model;
  const [namespaceReplay] = await namespaceAgain.emit("context", { messages: historyMessages(namespaceAgain) });
  assert.deepEqual((await providerPayload(namespaceReplay.messages)).content, (await providerPayload(namespaceAfter.messages)).content);
  assert.equal(namespaceAgain.stored.filter(entry => entry.customType === "todo-context-v1").length, 2);
  assert.deepEqual(pendingReconciliation(namespaceAgain.stored, boundaryTodo.todo.id), namespacePending);
  assert.equal(preservationState(namespaceAgain.stored, boundaryTodo.todo.id).request.details.request_id, namespaceRequestId);
  assert.deepEqual(await readFile(namespaceFile), namespaceBytes);

  // Legacy transient anchors are replaced by one persisted epoch, not guessed or retried indefinitely.
  for (const version of [undefined, 2, "model1"]) {
    const broken = JSON.parse(JSON.stringify(joint.stored));
    const oldBoundary = broken.find(entry => entry.customType === "todo-context-v1");
    if (version === "model1") {
      delete oldBoundary.details.context_model;
      const marker = "Durable project context loaded at a session boundary (untrusted task data):\n";
      const payload = JSON.parse(oldBoundary.content.split(marker)[1]);
      // Frozen historical payload is not passed to the Project3 runtime validator.
      oldBoundary.content = oldBoundary.content.split(marker)[0] + marker + JSON.stringify({ selected: payload.selected, scopes: [{ directory: payload.project.directory, parent_id: "ffffffff-ffff-ffff-ffff-ffffffffffff", context: { ...payload.project.context, version: 2, type: "simple" } }], children: [], prerequisites: payload.prerequisites, required_artifacts: [] });
    } else {
      oldBoundary.details.anchor_version = version;
      broken.findLast(entry => entry.customType === "todo-context-anchor-v1").data.after = JSON.stringify(["user", 424242, null, null]);
    }
    const frozenJournal = JSON.stringify(broken);
    const repairedSession = await instance(broken, true, true);
    repairedSession.ctx.model = joint.ctx.model;
    const [repairedContext] = await repairedSession.emit("context", { messages: historyMessages(repairedSession) });
    assert.equal(JSON.stringify(broken), frozenJournal);
    assert.equal(restoreSelection(repairedSession.stored), jointTodo.todo.id);
    assert.equal(repairedContext.messages.find(entry => entry.customType === "todo-context-v1").details.context_model, 2);
    assert.equal(repairedSession.ctx.aborted, undefined);
    assert.deepEqual(thinking(repairedContext.messages), []);
    respond(repairedSession, 12); repairedSession.flush();
    assert.equal(repairedSession.stored.filter(entry => entry.customType === "todo-context-v1").length, 2);
    const [afterRepair] = await repairedSession.emit("context", { messages: historyMessages(repairedSession) });
    assert.deepEqual(thinking(afterRepair.messages), ["signature-12"]);
    const repairedReopen = await instance(JSON.parse(JSON.stringify(repairedSession.stored)), true, true);
    repairedReopen.ctx.model = joint.ctx.model;
    const [repairReplay] = await repairedReopen.emit("context", { messages: historyMessages(repairedReopen) });
    assert.deepEqual((await providerPayload(repairReplay.messages)).content, (await providerPayload(afterRepair.messages)).content);
    assert.equal(repairedReopen.stored.filter(entry => entry.customType === "todo-context-v1").length, 2);
  }

  // An explicit reset removes old snapshots/thinking, but future thinking survives requests and reload.
  await cached.call("context_project", { action: "refresh" });
  const [resetCache] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.equal(resetCache.messages.filter(message => message.customType === "todo-context-v1").length, 1);
  assert.ok(!resetCache.messages.some(message => message.customType === "todo-context-drift-v1"));
  assert.deepEqual(thinking(resetCache.messages), []);
  const resetPayload = await providerPayload(resetCache.messages);
  respond(cached, 3); cached.flush();
  const [afterReset] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.deepEqual(thinking(afterReset.messages), ["signature-3"]);
  assert.deepEqual((await providerPayload(afterReset.messages)).content.slice(0, resetPayload.content.length), resetPayload.content);
  const cacheReopened = await instance(JSON.parse(JSON.stringify(cached.stored)), true, true);
  cacheReopened.ctx.model = cached.ctx.model;
  const [replayedCache] = await cacheReopened.emit("context", { messages: historyMessages(cacheReopened) });
  assert.deepEqual((await providerPayload(replayedCache.messages)).content, (await providerPayload(afterReset.messages)).content);
  assert.equal(cacheReopened.stored.filter(entry => entry.customType === "todo-context-v1").length, 2);
  assert.deepEqual(thinking(historyMessages(cached)), ["signature-1", "signature-2", "signature-3"]); // Raw transcript untouched.
  await cacheReopened.call("context_project_ack", { id: cacheTodo.todo.id, reason: "no_change", explanation: "Read only" });
  await cacheReopened.call("context_project", { action: "leave" });
  const [detachedCache] = await cacheReopened.emit("context", { messages: historyMessages(cacheReopened) });
  assert.deepEqual(thinking(detachedCache.messages), []);
  assert.ok(!detachedCache.messages.some(message => message.customType === "todo-context-v1"));
  cacheReopened.flush();
  const detachedReopened = await instance(JSON.parse(JSON.stringify(cacheReopened.stored)));
  assert.deepEqual((await providerPayload((await detachedReopened.emit("context", { messages: historyMessages(detachedReopened) }))[0].messages)).content, (await providerPayload(detachedCache.messages)).content);

  // Compaction resets only on success, retaining visible results but retiring pre-compaction thinking.
  await cached.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await cached.emit("session_compact_failed", { reason: "manual", aborted: true });
  assert.deepEqual((await providerPayload((await cached.emit("context", { messages: historyMessages(cached) }))[0].messages)).content, (await providerPayload(afterReset.messages)).content);
  await cached.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await cached.emit("session_compact", { reason: "manual" });
  const compactedInput = [{ role: "compactionSummary", summary: "Only relevant unsaved facts", timestamp: 500 }, ...historyMessages(cached).filter(message => message.role === "assistant" || message.role === "toolResult").slice(-2)];
  const [compactedCache] = await cached.emit("context", { messages: compactedInput });
  assert.deepEqual(thinking(compactedCache.messages), []);
  assert.equal(compactedCache.messages.filter(message => message.customType === "todo-context-v1").length, 1);
  const compactedPayload = await providerPayload(compactedCache.messages);
  respond(cached, 4); cached.flush();
  const [continuedCompacted] = await cached.emit("context", { messages: [...compactedInput, ...historyMessages(cached).filter(message => message.role === "assistant" || message.role === "toolResult").slice(-2)] });
  assert.deepEqual(thinking(continuedCompacted.messages), ["signature-4"]);
  assert.deepEqual((await providerPayload(continuedCompacted.messages)).content.slice(0, compactedPayload.content.length), compactedPayload.content);

  // Pending sign-off survives a brand-new session; acknowledgement does not approve the proposal.
  const chore = (await list(root)).find(row => row.todo.title === "Chore");
  const approvalSession = await instance();
  await approvalSession.call("context_project", { action: "resume", selector: chore.todo.id });
  await approvalSession.call("context_project_ack", { id: chore.todo.id, reason: "needs_approval", explanation: "Should this include a production rollout?" });
  assert.match((await resumeBundle(root, chore.todo.id)).project.context.open_questions[0].text, /Awaiting approval/);
  assert.equal((await locate(root, chore.todo.id)).todo.outcome, "Finish chore");

  // Durable prerequisites: graph invariants, guarded writes, transitive effects, and no cascading status writes.
  const dependencyRoot = join(scratch, "dependency-todos");
  const depProject = await create(dependencyRoot, "project", "Dependencies", "Verify prerequisites");
  const a = await create(dependencyRoot, "simple", "Authorize", "Obtain authorization", undefined);
  const b = await create(dependencyRoot, "simple", "Deploy", "Deploy safely", undefined, undefined, [a.todo.id]);
  const c = await create(dependencyRoot, "simple", "Retire", "Retire old paths", undefined, undefined, [b.todo.id]);
  const foreign = await create(dependencyRoot, "simple", "Standalone", "Other scope");
  assert.equal(b.dependency.dependencies_satisfied, false);
  assert.deepEqual(c.dependency.waiting_on.map(row => row.title).sort(), ["Authorize", "Deploy"]);
  const set = (item, changes, key) => checkpoint(dependencyRoot, item.todo.id, item.todo.revision, changes, key, "test-session");
  await assert.rejects(set(a, { depends_on: [a.todo.id] }, "self"), /itself/);
  await assert.rejects(set(a, { depends_on: [b.todo.id] }, "cycle"), /cycle/);
  await assert.rejects(set(b, { depends_on: [a.todo.id, a.todo.id] }, "duplicate"), /Duplicate/);
  await assert.rejects(set(b, { depends_on: [createTodo("simple", "Missing", "No").id] }, "missing"), /does not exist/);
  const crossScope = await create(dependencyRoot, "project", "Cross former scope", "Global DAG", undefined, undefined, [foreign.todo.id]);
  assert.equal(crossScope.dependency.dependencies_satisfied, false);
  const projectTarget = await create(dependencyRoot, "project", "Project prerequisite", "All project IDs", undefined, undefined, [depProject.todo.id]);
  assert.equal(projectTarget.dependency.waiting_on[0].id, depProject.todo.id);
  const standalonePeer = await create(dependencyRoot, "simple", "Standalone peer", "Same root scope", undefined, undefined, [foreign.todo.id]);
  assert.equal(standalonePeer.dependency.dependencies_satisfied, false);
  const projectOwner = await create(dependencyRoot, "project", "Independent owner", "No legacy type restriction", undefined, undefined, [foreign.todo.id]);
  assert.equal(projectOwner.dependency.waiting_on[0].id, foreign.todo.id);
  const formerScope = await create(dependencyRoot, "simple", "Formerly cross-scope create", "Allowed", undefined, undefined, [foreign.todo.id]);
  assert.equal(formerScope.todo.type, "project");
  await assert.rejects(set(c, { status: "done" }, "blocked-complete"), /waiting on/);
  await assert.rejects(mutate(dependencyRoot, b.todo.id, 1, todo => ({ ...todo, status: "done" })), /waiting on/);
  await assert.rejects(set(b, { blockers: ["Not supported"] }, "legacy-write"), /unknown/);
  assert.equal((await locate(dependencyRoot, b.todo.id)).todo.revision, 1);

  process.env.PI_TODO_PATH = dependencyRoot;
  const depsSession = await instance([], true);
  await depsSession.call("context_project", { action: "resume", selector: c.todo.id });
  const depsLoads = () => depsSession.stored.filter(entry => entry.customType === "todo-context-v1");
  assert.match(depsLoads()[0].content, /Authorize/);
  const aDone = await set(a, { status: "done" }, "a-done");
  assert.deepEqual(aDone.affected_dependents.map(row => row.title).sort(), ["Deploy", "Retire"]);
  assert.equal(aDone.affected_dependents.find(row => row.id === b.todo.id).dependencies_satisfied, true);
  assert.equal(aDone.affected_dependents.find(row => row.id === c.todo.id).dependencies_satisfied, false);
  assert.deepEqual((await set(a, { status: "done" }, "a-done")).todo, aDone.todo);
  assert.equal((await locate(dependencyRoot, b.todo.id)).todo.status, "todo");
  await depsSession.emit("context", { messages: depsLoads() });
  assert.match(depsSession.stored.findLast(entry => entry.customType === "todo-context-drift-v1").content, /Current dependency state/);
  const bDone = await set(b, { status: "done" }, "b-done");
  assert.equal(bDone.affected_dependents[0].dependencies_satisfied, true);
  await depsSession.emit("context", { messages: depsSession.stored.filter(entry => entry.type === "custom_message") });
  assert.match(depsSession.stored.findLast(entry => entry.customType === "todo-context-drift-v1").content, /"dependencies_satisfied":true/);
  assert.equal(depsLoads().length, 1); // Prerequisite updates never reload artifacts/full context.
  const cDoneRaw = await depsSession.callRaw("context_project_checkpoint", { id: c.todo.id, revision: 1, key: "c-done", changes: { status: "done" } });
  const cDone = cDoneRaw.structuredContent;
  assert.deepEqual(JSON.parse(cDoneRaw.content[0].text).dependency, cDone.dependency);
  assert.equal(JSON.parse(cDoneRaw.content[0].text).status, "done");
  assert.equal(cDone.dependency.dependencies_satisfied, true);
  const bFile = await savedJSON(b);
  const cFile = await savedJSON(c);
  const aReopened = await set(aDone, { status: "todo" }, "reopen");
  assert.ok(aReopened.affected_dependents.every(row => row.status === "done" && row.review_required));
  assert.equal(await savedJSON(b), bFile);
  assert.equal(await savedJSON(c), cFile);
  await depsSession.emit("context", { messages: depsLoads() });
  assert.match(depsSession.stored.findLast(entry => entry.customType === "todo-context-drift-v1").content, /"review_required":true/);
  await assert.rejects(set(cDone, { status: "done" }, "reassert"), /waiting on/);
  const note = await set(cDone, { evidence: { add: ["Review reopened prerequisite"] } }, "note");
  const aCanceled = await set(aReopened, { status: "canceled" }, "cancel");
  assert.ok(aCanceled.affected_dependents.every(row => !row.dependencies_satisfied && row.review_required));
  const bCanceled = await set(bDone, { status: "canceled" }, "cancel-dependent");
  assert.equal(bCanceled.affected_dependents[0].waiting_on.find(row => row.id === b.todo.id).status, "canceled");
  const revisedDependencies = await set(note, { status: "todo", depends_on: [] }, "revise");
  assert.equal(revisedDependencies.dependency.dependencies_satisfied, true);
  await assert.rejects(set(note, { depends_on: [] }, "stale"), /Stale/);
  const listedDeps = await depsSession.call("context_project", { action: "list", include_done: true });
  assert.ok(listedDeps.every(row => Array.isArray(row.depends_on) && row.dependency));
  const programmatic = await depsSession.call("context_project", { action: "create", type: "simple", title: "Follow-up", outcome: "Check runtime", depends_on: [b.todo.id] });
  assert.equal(programmatic.dependency.review_required, true);
  const inspected = await depsSession.call("context_project", { action: "get", selector: programmatic.todo.id });
  assert.equal(inspected.dependency.waiting_on.find(row => row.id === b.todo.id).status, "canceled");
  const commandSession = await instance([], true);
  await commandSession.call("context_project", { action: "resume", selector: programmatic.todo.id });
  await commandSession.extension.commands.get("context").handler("status in_progress", commandSession.ctx);
  assert.equal((await locate(dependencyRoot, programmatic.todo.id)).todo.status, "in_progress");
  // Removed prerequisites are no longer watched, even if the old graph expands afterwards.
  await depsSession.call("context_project", { action: "get", selector: c.todo.id });
  await create(dependencyRoot, "project", "Unrelated graph expansion", "Not watched", undefined, undefined, [foreign.todo.id]);
  const extraPrerequisite = await create(dependencyRoot, "simple", "Additional authorization", "Review revised scope", undefined);
  await set(aCanceled, { depends_on: [extraPrerequisite.todo.id] }, "expand-old-graph");
  await depsSession.emit("context", { messages: depsLoads() });
  assert.equal(depsSession.ctx.aborted, undefined);
  process.env.PI_TODO_PATH = root;

  // Legacy constraints survive read compatibility, with stable IDs, without changing canonical files on read.
  const legacy = createTodo("simple", "Legacy", "Preserve constraints");
  legacy.version = 1; legacy.id = "11111111-1111-1111-1111-111111111111";
  legacy.current_state.evidence = Array.from({ length: 30 }, (_, index) => index < 2 ? "Duplicate qualification: launch remains unverified" : `Finding ${index}: owner identifiers are verbatim; deployment remains unverified`);
  legacy.references = ["pi-history:v1/synthetic-session/legacy-finding"];
  legacy.decisions = [{ id: child.todo.id, summary: "Preserve qualification", rationale: "Do not infer launch permission", approval: "draft", evidence: ["Independent decision evidence"] }];
  const oldEvidenceInput = { current_state: { evidence: [] } };
  legacy.last_checkpoint = { key: "pre-upgrade", digest: digest(oldEvidenceInput), session_id: "test-session", at: legacy.updated_at };
  legacy.current_state.summary = "Preserved legacy narrative";
  legacy.next_actions = ["Preserved legacy instruction"];
  legacy.artifacts = [{ id: legacy.id, title: "Legacy runbook", kind: "runbook", path: `artifacts/${legacy.id}-1.md`, description: "Preserved document", lifecycle: "current", required: false, applies_to: [] }];
  delete legacy.depends_on; legacy.blockers = ["Obtain separate launch permission"]; legacy.status = "blocked";
  const legacyDecoded = validateLegacy(legacy);
  let migrated = normalizeLegacy([{ todo: legacyDecoded, parent_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }, { todo: createTodo("project", "Normalization source", "Fixture"), parent_id: undefined }].map((row, index) => index ? { ...row, todo: { ...row.todo, id: "ffffffff-ffff-ffff-ffff-ffffffffffff" } } : row)).projects[0];
  assert.deepEqual(migrated.depends_on, []); assert.equal(migrated.status, "todo");
  assert.equal("blockers" in migrated, false);
  assert.ok(migrated.open_questions.some(question => question.text === legacy.blockers[0] && question.id === "7c2fc7e6-cb20-2ea3-be17-80ed89d24b70")); // Published legacy-constraint identity remains byte-for-byte stable.
  assert.deepEqual(validateLegacy(legacy), legacyDecoded); assert.deepEqual(validate(migrated), migrated);
  assert.throws(() => validate(legacy), /version|model|schema/i);
  assert.equal(legacy.status, "blocked"); assert.ok(legacy.blockers);
  const legacyRoot = join(scratch, "legacy-todos");
  const legacyParentTodo = createTodo("project", "Legacy grounding", "Preserve original qualifications");
  legacyParentTodo.id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const legacyParent = { todo: legacyParentTodo, directory: join(legacyRoot, legacyParentTodo.id) };
  const inheritedId = createTodo("simple", "Document ID", "Fixture identity").id;
  const oldDecision = createTodo("simple", "Decision ID", "Fixture identity").id;
  legacyParent.todo.decisions = [{ id: oldDecision, summary: "Original approved boundary", rationale: "Preserve authority", approval: "approved", evidence: ["User: approved only investigation"] }, { id: inheritedId, summary: "Scoped replacement", rationale: "Supersession is not new permission", approval: "draft", evidence: [], supersedes: oldDecision }];
  legacyParent.todo.open_questions = [{ id: inheritedId, text: "Was qualification retained?", resolution: "Verified source bytes" }];
  legacyParent.todo.linear = { url: "https://linear.app/example-team/issue/EX-123/legacy", coverage: "partial", status: "In Progress", status_type: "started", refreshed_at: legacyParent.todo.updated_at };
  legacyParent.todo.artifacts = [{ id: inheritedId, title: "Inherited design", kind: "design", description: "Required byte-exact import", lifecycle: "current", required: true, applies_to: [legacy.id], path: `artifacts/${inheritedId}-1.md` }];
  legacyParent.todo.context_policy = { reason: "Retained hidden draft", consult_on_demand_decisions: [inheritedId], consult_on_demand_artifacts: [] };
  legacyParent.todo.last_checkpoint = { key: "accepted-parent", digest: digest({}), session_id: "original-parent", at: legacyParent.todo.updated_at, base_revision: 1 };
  await mkdir(join(legacyParent.directory, "artifacts"), { recursive: true });
  const inheritedBytes = Buffer.from("  # Byte-exact inherited design\n\n");
  await writeFile(join(legacyParent.directory, legacyParent.todo.artifacts[0].path), inheritedBytes);
  await writeFile(join(legacyParent.directory, "todo.json"), JSON.stringify(legacyParent.todo));
  const legacyDirectory = join(legacyParent.directory, "todos", legacy.id);
  await mkdir(join(legacyDirectory, "artifacts"), { recursive: true }); const legacyFile = join(legacyDirectory, "todo.json");
  await writeFile(join(legacyDirectory, legacy.artifacts[0].path), "Preserved legacy document\n");
  const legacyBytes = JSON.stringify(legacy); await writeFile(legacyFile, legacyBytes);
  const legacyPeer = createTodo("simple", "Legacy dependent", "Keep peer edges"); legacyPeer.depends_on = [legacy.id];
  await mkdir(join(legacyParent.directory, "todos", legacyPeer.id));
  await writeFile(join(legacyParent.directory, "todos", legacyPeer.id, "todo.json"), JSON.stringify(legacyPeer));
  await mkdir(join(legacyParent.directory, "todos", `${createTodo("simple", "Unpublished child", "No").id}.creating`));
  await writeFile(join(legacyParent.directory, "todos", "unpublished.tmp"), "Unpublished child metadata");
  const olderBytes = Buffer.from([0xff, 0x00, 0xc3, 0xa9, 0x0a]);
  await writeFile(join(legacyDirectory, "artifacts", "unknown-older.md"), olderBytes);
  await assert.rejects(list(legacyRoot), /migration required/);
  const orphanPath = `artifacts/${legacy.id}-2.md`;
  await writeFile(join(legacyDirectory, orphanPath), "Unknown interrupted next-version bytes\n");
  await mkdir(join(legacyRoot, `${createTodo("simple", "Unpublished", "No").id}.creating`));
  await writeFile(join(legacyDirectory, "todo.json.unpublished.tmp"), "unpublished");
  const inspection = await inspect(legacyRoot, join(scratch, "legacy-inspect.json"));
  const rehearsal = await rehearse(legacyRoot, join(scratch, "legacy-rehearsal"));
  assert.equal(rehearsal.source_fingerprint, inspection.fingerprint);
  assert.equal(await readFile(legacyFile, "utf8"), legacyBytes);
  const nextDocument = await saveArtifact(join(scratch, "legacy-rehearsal", "root"), legacy.id, 1, { ...metadata, id: legacy.id, applies_to: [], required: false, body: "Legitimate committed next version" });
  assert.equal(nextDocument.todo.artifacts[0].path, orphanPath); // Unknown-commit bytes have a separate key namespace.
  assert.equal(await readArtifact(join(scratch, "legacy-rehearsal", "root"), nextDocument, legacy.id), "Legitimate committed next version\n");
  assert.equal(withRead(join(scratch, "legacy-rehearsal", "root"), db => Buffer.from(db.prepare("SELECT body FROM retained_legacy_files WHERE owner_id=? AND relative_path=?").get(legacy.id, orphanPath).body).toString()), "Unknown interrupted next-version bytes\n");
  await writeFile(join(legacyDirectory, "late-unpublished.tmp"), "Rehearsal is not authoritative");
  const imported = await cutover(legacyRoot, join(scratch, "legacy-cutover"), true);
  assert.notEqual(imported.source_fingerprint, rehearsal.source_fingerprint);
  assert.equal(await readFile(join(imported.backup, legacyParent.todo.id, "todos", legacy.id, "late-unpublished.tmp"), "utf8"), "Rehearsal is not authoritative");
  assert.equal(imported.published, true);
  assert.equal((await stat(join(legacyRoot, "todo.sqlite"))).mode & 0o777, 0o600);
  assert.equal(await readFile(legacyFile, "utf8"), legacyBytes);
  await assert.rejects(mkdir(join(legacyRoot, ".write-lock")), /EEXIST/);
  assert.equal(JSON.parse(await readFile(join(legacyRoot, ".write-lock", "owner.json"))).purpose, "migrated-to-sqlite");
  const legacyItem = await locate(legacyRoot, legacy.id);
  const expectedLegacy = normalizeLegacy([legacyParent, ...[{ todo: legacyDecoded, parent_id: legacyParent.todo.id }, { todo: legacyPeer, parent_id: legacyParent.todo.id }].sort((a, b) => a.todo.id.localeCompare(b.todo.id))]).projects;
  migrated = expectedLegacy.find(todo => todo.id === legacy.id);
  assert.deepEqual(legacyItem.todo, migrated);
  assert.deepEqual((await locate(legacyRoot, legacyParent.todo.id)).todo, expectedLegacy.find(todo => todo.id === legacyParent.todo.id));
  assert.deepEqual(bodyBytes(legacyParent, legacyParent.todo.artifacts[0].path), inheritedBytes);
  assert.deepEqual((await locate(legacyRoot, legacyPeer.id)).todo, expectedLegacy.find(todo => todo.id === legacyPeer.id));
  assert.deepEqual((await list(legacyRoot)).map(row => row.todo.id), [legacyParent.todo.id, legacy.id, legacyPeer.id].sort());
  assert.deepEqual(withRead(legacyRoot, db => Buffer.from(db.prepare("SELECT body FROM retained_legacy_files WHERE owner_id=? AND relative_path=?").get(legacy.id, "artifacts/unknown-older.md").body)), olderBytes);
  assert.deepEqual(await readKnown(legacyRoot, { ...legacyItem, directory: "/not/a/storage/path" }), legacyItem);
  assert.equal(JSON.parse(execFileSync(process.execPath, [join(directory, "migration.ts"), "verify", "--root", legacyRoot], { encoding: "utf8" })).integrity, "ok");
  assert.equal(withRead(legacyRoot, db => Buffer.from(db.prepare("SELECT body FROM retained_legacy_files WHERE owner_id=? AND relative_path=?").get(legacy.id, orphanPath).body).toString()), "Unknown interrupted next-version bytes\n");
  // Migration stop conditions leave source untouched and never publish an empty-ready DB.
  {
    const stopped = join(scratch, "migration-stops"); await mkdir(stopped);
    const bad = createTodo("simple", "Missing body", "Refuse activation");
    bad.artifacts = [{ ...metadata, id: bad.id, path: `artifacts/${bad.id}-1.md`, applies_to: [] }]; delete bad.artifacts[0].body;
    await mkdir(join(stopped, bad.id)); const badFile = join(stopped, bad.id, "todo.json"); await writeFile(badFile, JSON.stringify(bad));
    const original = await readFile(badFile);
    await assert.rejects(inspect(stopped, join(scratch, "bad-inspect.json")), /Missing current artifact/);
    await assert.rejects(rehearse(stopped, join(stopped, "nested-workspace")), /outside source/);
    await assert.rejects(stat(join(stopped, "nested-workspace")), /ENOENT/);
    await assert.rejects(cutover(stopped, join(scratch, "no-apply")), /--apply/);
    await mkdir(join(stopped, ".write-lock"));
    await assert.rejects(cutover(stopped, join(scratch, "locked-cutover"), true), /existing destination/);
    await rm(join(stopped, ".write-lock"), { recursive: true });
    await mkdir(join(stopped, ".todo-import-unresolved"));
    await assert.rejects(cutover(stopped, join(scratch, "staged-cutover"), true), /Unresolved cutover/);
    await rm(join(stopped, ".todo-import-unresolved"), { recursive: true });
    await assert.rejects(cutover(stopped, join(scratch, "failed-cutover"), true), /published=false.*Missing current artifact/);
    await assert.rejects(stat(join(stopped, "todo.sqlite")), /ENOENT/);
    assert.deepEqual(await readFile(badFile), original);
    assert.equal(JSON.parse(await readFile(join(scratch, "failed-cutover", "failure.json"))).published, false);
    await assert.rejects(mkdir(join(stopped, ".write-lock")), /EEXIST/);
    // Explicit malformed, duplicate-placement, escape and symlink source fixtures.
    const cases = [
      ["malformed", async root => { await mkdir(join(root, bad.id)); await writeFile(join(root, bad.id, "todo.json"), "{bad"); }, /Cannot read/],
      ["symlink", async root => { await symlink(scratch, join(root, bad.id)); }, /Symlinks/],
      ["escape", async root => { const todo = { ...bad, artifacts: [{ ...bad.artifacts[0], path: "../../escape.md" }] }; await mkdir(join(root, bad.id)); await writeFile(join(root, bad.id, "todo.json"), JSON.stringify(todo)); }, /Invalid artifact/],
      ["duplicate", async root => { const parent = createTodo("project", "Parent", "Duplicate placement"); const simple = createTodo("simple", "Duplicate", "Refuse duplicate"); await mkdir(join(root, parent.id, "todos", simple.id), { recursive: true }); await mkdir(join(root, simple.id)); await writeFile(join(root, parent.id, "todo.json"), JSON.stringify(parent)); for (const path of [join(root, simple.id), join(root, parent.id, "todos", simple.id)]) await writeFile(join(path, "todo.json"), JSON.stringify(simple)); }, /Duplicate todo IDs/],
    ];
    for (const [name, prepare, error] of cases) { const root = join(scratch, `migration-${name}`); await mkdir(root); await prepare(root); await assert.rejects(rehearse(root, join(scratch, `workspace-${name}`)), error); await assert.rejects(stat(join(root, "todo.sqlite")), /ENOENT/); }
    await assert.rejects(cutover(legacyRoot, join(scratch, "existing-cutover"), true), /existing destination/);
    assert.equal((await verify(legacyRoot)).owners, 3);
    assert.equal((await stat(join(legacyRoot, "todo.sqlite-wal")).catch(error => error.code === "ENOENT" ? { size: 0 } : Promise.reject(error))).size, 0);
  }
  process.env.PI_TODO_PATH = legacyRoot;
  const curator = await instance([], true);
  const legacyRecords = migrated.current_state.evidence;
  assert.equal(migrated.version, 3);
  assert.notEqual(legacyRecords[0].id, legacyRecords[1].id);
  assert.deepEqual(legacyRecords.map(row => row.text), legacy.current_state.evidence);
  assert.deepEqual(migrated.last_checkpoint, legacy.last_checkpoint);
  for (let repeat = 0; repeat < 2; repeat++) {
    const read = await curator.call("context_project", { action: "get", selector: legacy.id, view: "full" });
    assert.deepEqual(read.todo.current_state.evidence, legacyRecords);
    assert.deepEqual(read.todo.artifacts, legacy.artifacts);
    await curator.call("context_project", { action: "resume", selector: legacy.id });
    const bundle = await resumeBundle(legacyRoot, legacy.id);
    assert.deepEqual(bundle.project.context.current_state.evidence, legacyRecords);
    const hits = await curator.call("context_project_search", { query: "Duplicate qualification", selector: legacy.id });
    assert.deepEqual(hits.results.map(row => row.evidence_id), legacyRecords.slice(0, 2).map(row => row.id));
    const page = await curator.call("context_project_record", { id: legacy.id, expected_revision: 1, source_kind: "evidence", index: 0 });
    assert.equal(page.evidence_id, legacyRecords[0].id); assert.equal(page.body, legacyRecords[0].text);
  }
  const recoveredLegacy = await instance(curator.stored);
  assert.equal(restoreSelection(recoveredLegacy.stored), legacy.id);
  assert.equal((await recoveredLegacy.call("context_project", { action: "status" })).selected.id, legacy.id);
  assert.equal(await readFile(legacyFile, "utf8"), legacyBytes);
  const manifestBytes = async () => Promise.all((await list(legacyRoot)).map(row => savedJSON(row)));
  const beforeRejectedEvidence = await manifestBytes();
  const unknownEvidenceId = project.todo.id;
  for (const edit of [{ add: ["No room"] }, { update: [{ id: unknownEvidenceId, text: "Unknown" }] }, { remove: [unknownEvidenceId] }, { update: [{ id: legacyRecords[0].id, text: "One" }], remove: [legacyRecords[0].id] }, { update: [{ id: legacyRecords[0].id, text: "One" }, { id: legacyRecords[0].id, text: "Two" }] }]) {
    await assert.rejects(curator.call("context_project_checkpoint", { id: legacy.id, revision: 1, key: "invalid-evidence", changes: { evidence: edit } }), /30 records.*31|ID not found|once per change/);
    assert.deepEqual(await manifestBytes(), beforeRejectedEvidence);
  }
  for (const edit of [{ add: [""] }, { update: [{ id: "invalid", text: "No" }] }, { update: [{ id: legacyRecords[0].id, text: "x".repeat(2001) }] }, { update: [{ id: legacyRecords[0].id, text: "No", extra: true }] }, { remove: [legacyRecords[0].id, legacyRecords[0].id] }]) {
    await assert.rejects(curator.call("context_project_checkpoint", { id: legacy.id, revision: 1, key: "malformed-evidence", changes: { evidence: edit } }), /validation/i);
    assert.throws(() => applyChanges(migrated, { evidence: edit }), /text|ID|fields|once per change/);
  }
  for (const rows of [["schema2 must not normalize strings"], [legacyRecords[0], "mixed"], [{ id: legacyRecords[0].id, text: "", extra: true }], [legacyRecords[0], legacyRecords[0]]]) {
    const malformedCanonical = { ...migrated, current_state: { evidence: rows } };
    assert.throws(() => validate(malformedCanonical), /fields|text|Duplicate/);
    replaceJSON(legacyItem, JSON.stringify(malformedCanonical));
    await assert.rejects(curator.call("context_project", { action: "get", selector: legacy.id }), /fields|text|Duplicate/);
    replaceJSON(legacyItem, JSON.stringify(migrated));
  }
  assert.throws(() => validate({ ...migrated, last_checkpoint: { ...migrated.last_checkpoint, base_revision: 0 } }), /base revision/);
  // Rejection-only schema slots reach the same guard, including a formerly successful key.
  curator.confirmations.push(true);
  for (const value of [{ evidence: ["Old one-note write"] }, { evidence: [] }, null]) {
    const changes = { current_state: value, outcome: "Would otherwise ask approval" };
    await assert.rejects(curator.call("context_project_checkpoint", { id: legacy.id, revision: 1, key: "retired-field", changes }), /whole-list writes are retired/);
    await assert.rejects(curator.call("context_project_tighten", { id: legacy.id, revision: 1, reason: "Old shape", current_state: value }), /whole-list writes are retired/);
    assert.throws(() => applyChanges(migrated, changes), /whole-list writes are retired/);
    await assert.rejects(checkpoint(legacyRoot, legacy.id, 1, changes, "direct-retired", "test-session"), /whole-list writes are retired/);
    await assert.rejects(tighten(legacyRoot, legacy.id, 1, { reason: "Old shape", current_state: value }), /whole-list writes are retired/);
  }
  assert.throws(() => applyChanges(migrated, { current_state: undefined }), /whole-list writes are retired/);
  for (const write of [() => curator.call("context_project_checkpoint", { id: legacy.id, revision: 1, key: "pre-upgrade", changes: oldEvidenceInput }), () => checkpoint(legacyRoot, legacy.id, 1, oldEvidenceInput, "pre-upgrade", "test-session")]) await assert.rejects(write(), /whole-list writes are retired/);
  assert.deepEqual(curator.confirmations, [true]);
  assert.deepEqual(await manifestBytes(), beforeRejectedEvidence);
  // Final capacity includes automatically attributed approval, with no partial parent update.
  const approvedAtCap = { outcome: "Approved revised goal", approval_evidence: "User: use this exact revised goal" };
  await assert.rejects(curator.call("context_project_checkpoint", { id: legacy.id, revision: 1, key: "approval-cap", changes: approvedAtCap }), /30 records.*31/);
  assert.deepEqual(await manifestBytes(), beforeRejectedEvidence);
  const targetedRaw = await curator.callRaw("context_project_checkpoint", { id: legacy.id, revision: 1, key: "legacy-target", changes: { evidence: { update: [{ id: legacyRecords[2].id, text: "Targeted qualification: launch remains unverified" }] } } });
  const targeted = targetedRaw.structuredContent;
  assert.deepEqual(targeted.todo.current_state.evidence.filter(row => row.id !== legacyRecords[2].id), legacyRecords.filter(row => row.id !== legacyRecords[2].id));
  assert.equal(JSON.parse(savedJSON(legacyItem)).version, 3);
  const savedLegacyRaw = await curator.callRaw("context_project_checkpoint", { id: legacy.id, revision: targeted.todo.revision, key: "legacy-context", changes: { evidence: { remove: [legacyRecords[3].id], add: ["Model preserved prerequisites"] } } });
  const savedLegacy = savedLegacyRaw.structuredContent;
  assert.deepEqual(savedLegacy.evidence_ids, [evidenceId(legacy.id, targeted.todo.revision, 0)]);
  assert.deepEqual(JSON.parse(savedLegacyRaw.content[0].text).evidence_ids, savedLegacy.evidence_ids);
  assert.deepEqual(savedLegacy.todo.current_state.evidence.slice(0, -1), targeted.todo.current_state.evidence.filter(row => row.id !== legacyRecords[3].id));
  assert.deepEqual(savedLegacy.todo.open_questions, migrated.open_questions);
  assert.equal("blockers" in JSON.parse(savedJSON(legacyItem)), false);
  assert.deepEqual(JSON.parse(savedJSON(legacyItem)).depends_on, []);
  process.env.PI_TODO_PATH = legacyRoot;
  const legacySession = await instance();
  const legacyFull = await legacySession.call("context_project", { action: "get", selector: legacy.id, view: "full" });
  assert.equal(legacyFull.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(legacyFull.todo.next_actions, legacy.next_actions);
  assert.equal(legacyFull.todo.artifacts[0].kind, "runbook");
  assert.equal((await legacySession.call("context_project_artifact", { action: "read", id: legacy.id, artifact_id: legacy.id })).body, "Preserved legacy document\n");
  assert.equal(await readFile(legacyFile, "utf8"), legacyBytes); // SQLite writes never update archival JSON.
  assert.equal(await readFile(join(imported.backup, legacyParent.todo.id, "todos", legacy.id, "todo.json"), "utf8"), legacyBytes);
  const legacyActive = await legacySession.call("context_project", { action: "get", selector: legacy.id, view: "active" });
  const legacyResumed = await resumeBundle(legacyRoot, legacy.id);
  for (const context of [legacyActive.todo, legacyResumed.project.context]) {
    assert.equal("summary" in context.current_state, false);
    assert.equal("next_actions" in context, false);
  }
  await legacySession.call("context_project_tighten", { id: legacy.id, revision: savedLegacy.todo.revision, reason: "Consolidate knowledge", evidence: { update: [{ id: savedLegacy.todo.current_state.evidence[0].id, text: "Verified knowledge" }] } });
  const legacyTightened = await legacySession.call("context_project", { action: "get", selector: legacy.id, view: "full" });
  assert.equal(legacyTightened.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(legacyTightened.todo.next_actions, legacy.next_actions);
  await assert.rejects(legacySession.call("context_project_artifact", { action: "upsert", id: legacy.id, revision: legacyTightened.todo.revision, artifact_id: legacy.id, ...metadata, kind: "runbook", applies_to: [], body: undefined }), /validation/i);
  const reclassified = await legacySession.call("context_project_artifact", { action: "upsert", id: legacy.id, revision: legacyTightened.todo.revision, artifact_id: legacy.id, ...metadata, kind: "research", required: false, applies_to: [], body: undefined });
  assert.equal(reclassified.todo.artifacts[0].kind, "research");
  assert.equal(reclassified.todo.artifacts[0].path, legacy.artifacts[0].path);
  assert.equal(reclassified.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(reclassified.todo.next_actions, legacy.next_actions);
  const qualifiedHit = (await legacySession.call("context_project_search", { query: "Targeted qualification", selector: legacy.id })).results[0];
  assert.equal(qualifiedHit.evidence_id, legacyRecords[2].id);
  const { tool: qualifiedTool, ...qualifiedArgs } = qualifiedHit.read;
  const qualifiedPage = await legacySession.call(qualifiedTool, qualifiedArgs);
  assert.equal(qualifiedPage.evidence_id, legacyRecords[2].id);
  assert.equal(qualifiedPage.body, "Targeted qualification: launch remains unverified");
  const qualified = await legacySession.call("context_project_checkpoint", { id: legacy.id, revision: reclassified.todo.revision, key: "qualify-from-search", changes: { evidence: { update: [{ id: qualifiedPage.evidence_id, text: "Targeted qualification: launch remains unverified; no permission inferred" }] } } });
  const emptyEdits = await legacySession.call("context_project_checkpoint", { id: legacy.id, revision: qualified.todo.revision, key: "empty-edits", changes: { evidence: { add: [], update: [], remove: [] } } });
  assert.deepEqual(emptyEdits.todo.current_state.evidence, qualified.todo.current_state.evidence);
  const approvalRaw = await legacySession.callRaw("context_project_checkpoint", { id: legacy.id, revision: emptyEdits.todo.revision, key: "approval-with-space", changes: { ...approvedAtCap, evidence: { remove: [legacyRecords[4].id] } } });
  const approvalAtCap = approvalRaw.structuredContent;
  assert.equal(approvalAtCap.evidence_ids, undefined); // Automatic approval is not an explicit-add receipt.
  const receiptRecord = approvalAtCap.todo.current_state.evidence.at(-1);
  assert.equal(receiptRecord.text, `User approval: ${approvedAtCap.approval_evidence}`);
  assert.deepEqual(approvalAtCap.todo.current_state.evidence.slice(0, -1), emptyEdits.todo.current_state.evidence.filter(row => row.id !== legacyRecords[4].id));
  const curationBefore = await manifestBytes();
  await assert.rejects(legacySession.call("context_project_tighten", { id: legacy.id, revision: approvalAtCap.todo.revision, reason: "Invalid visibility rolls back curation", evidence: { remove: [receiptRecord.id] }, consult_on_demand_decisions: [unknownEvidenceId] }), /existing record IDs/);
  assert.deepEqual(await manifestBytes(), curationBefore);
  const hiddenCuration = await legacySession.call("context_project_tighten", { id: legacy.id, revision: approvalAtCap.todo.revision, reason: "Explicit receipt removal and reversible visibility", evidence: { remove: [receiptRecord.id] }, consult_on_demand_decisions: [legacy.decisions[0].id] });
  const restoredCuration = await legacySession.call("context_project_tighten", { id: legacy.id, revision: hiddenCuration.revision, reason: "Restore governing qualification", evidence: { add: ["Replacement finding: deployment remains unverified"] }, restore_decisions: [legacy.decisions[0].id] });
  assert.deepEqual(restoredCuration.evidence_ids, [evidenceId(legacy.id, hiddenCuration.revision, 0)]);
  const freshCurator = await instance();
  await freshCurator.call("context_project", { action: "resume", selector: legacy.id });
  const freshQualified = await resumeBundle(legacyRoot, legacy.id);
  const freshRecords = freshQualified.project.context.current_state.evidence;
  assert.equal(freshRecords.length, 30);
  assert.ok(freshRecords.some(row => row.id === qualifiedPage.evidence_id && row.text.includes("no permission inferred")));
  const [freshQualificationContext] = await freshCurator.emit("context", { messages: [] });
  assert.match(freshQualificationContext.messages.at(-1).content, /launch remains unverified; no permission inferred/);
  const qualifiedRecap = await freshCurator.call("context_project_recap", {});
  assert.deepEqual(qualifiedRecap.project.context.current_state.evidence, freshRecords);
  for (const active of [freshQualified.project.context, qualifiedRecap.project.context]) {
    assert.equal("summary" in active.current_state, false); assert.equal("next_actions" in active, false); assert.equal(active.last_checkpoint, undefined);
  }
  const beforeBulk = (await locate(legacyRoot, legacy.id)).todo;
  const bulk = await freshCurator.call("context_project_checkpoint", { id: legacy.id, revision: beforeBulk.revision, key: "enumerated-bulk", changes: { evidence: { remove: beforeBulk.current_state.evidence.map(row => row.id), add: ["Chosen consolidated qualification: deployment remains unverified"] } } });
  for (const field of ["decisions", "open_questions", "references", "artifacts"]) assert.deepEqual(bulk.todo[field], beforeBulk[field]);
  const cleared = await freshCurator.call("context_project_checkpoint", { id: legacy.id, revision: bulk.todo.revision, key: "enumerated-clear", changes: { evidence: { remove: bulk.todo.current_state.evidence.map(row => row.id) } } });
  assert.deepEqual(cleared.todo.current_state.evidence, []);
  for (const field of ["decisions", "open_questions", "references", "artifacts"]) assert.deepEqual(cleared.todo[field], beforeBulk[field]);
  // Replay IDs belong to the accepted base, even after curation removes one and advances the revision.
  const replayInput = { evidence: { add: ["Original retry finding", "Original second finding"] } };
  const replayBase = cleared.todo.revision;
  const originalRaw = await freshCurator.callRaw("context_project_checkpoint", { id: legacy.id, revision: replayBase, key: "stable-evidence-retry", changes: replayInput });
  const original = originalRaw.structuredContent;
  const originalIds = [evidenceId(legacy.id, replayBase, 0), evidenceId(legacy.id, replayBase, 1)];
  assert.deepEqual(original.evidence_ids, originalIds);
  assert.deepEqual(JSON.parse(originalRaw.content[0].text).evidence_ids, originalIds);
  assert.equal(original.todo.last_checkpoint.base_revision, replayBase);
  const immediateBytes = await manifestBytes();
  assert.deepEqual((await freshCurator.call("context_project_checkpoint", { id: legacy.id, revision: replayBase, key: "stable-evidence-retry", changes: replayInput })).evidence_ids, originalIds);
  assert.deepEqual(await manifestBytes(), immediateBytes);
  const curatedRaw = await freshCurator.callRaw("context_project_tighten", { id: legacy.id, revision: original.todo.revision, reason: "Curation after checkpoint", evidence: { remove: [originalIds[0]], add: ["Later different finding"] } });
  const curatedIds = [evidenceId(legacy.id, original.todo.revision, 0)];
  assert.deepEqual(curatedRaw.structuredContent.evidence_ids, curatedIds);
  assert.deepEqual(JSON.parse(curatedRaw.content[0].text).evidence_ids, curatedIds);
  const curatedOwner = (await locate(legacyRoot, legacy.id)).todo;
  assert.deepEqual(curatedOwner.last_checkpoint, original.todo.last_checkpoint);
  const afterCuration = await manifestBytes();
  const replayAfterCuration = await freshCurator.callRaw("context_project_checkpoint", { id: legacy.id, revision: curatedOwner.revision, key: "stable-evidence-retry", changes: replayInput });
  assert.deepEqual(replayAfterCuration.structuredContent.evidence_ids, originalIds);
  assert.deepEqual(JSON.parse(replayAfterCuration.content[0].text).evidence_ids, originalIds);
  assert.deepEqual(replayAfterCuration.structuredContent.todo, curatedOwner);
  assert.ok(!curatedOwner.current_state.evidence.some(row => row.id === originalIds[0]));
  assert.deepEqual(await manifestBytes(), afterCuration);
  await assert.rejects(freshCurator.call("context_project_checkpoint", { id: legacy.id, revision: curatedOwner.revision, key: "stable-evidence-retry", changes: { evidence: { add: ["Changed digest"] } } }), /different content/);
  await assert.rejects(checkpoint(legacyRoot, legacy.id, curatedOwner.revision, replayInput, "stable-evidence-retry", "different-session"), /different content\/owner/);
  await assert.rejects(freshCurator.call("context_project_checkpoint", { id: legacy.id, revision: replayBase, key: "fresh-stale-evidence", changes: replayInput }), /Stale revision/);
  assert.deepEqual(await manifestBytes(), afterCuration);
  process.env.PI_TODO_PATH = root;

  // Both former character ceilings accept full context, including reopen/refresh/compaction and updates.
  const largeState = { evidence: Array.from({ length: 12 }, (_, i) => `${i}:${"e".repeat(1900)}`) };
  const largeBody = "x".repeat(50000);
  const largeSource = await saveArtifact(root, project.todo.id, 4, { ...metadata, body: largeBody });
  const largeArtifact = largeSource.todo.artifacts.at(-1);
  writeReference(root, { action: "reference_add", project_id: child.todo.id, expected_revision: 4, reference: { kind: "artifact", source_owner_id: project.todo.id, artifact_id: largeArtifact.id, follow: "current", requirement: "source", reason: "Required large source" }, key: "large-source" }, { session_id: "large-fixture", approval_evidence: "Synthetic request: include the required large source" });
  const largeChild = await checkpoint(root, child.todo.id, 5, { evidence: { remove: (await locate(root, child.todo.id)).todo.current_state.evidence.map(row => row.id), add: largeState.evidence } }, "large-orientation", "test-session");
  const largeBundle = await resumeBundle(root, child.todo.id);
  assert.ok(JSON.stringify(largeBundle.project).length > 18000);
  assert.deepEqual(largeBundle.project.context.current_state.evidence.map(row => row.text), largeState.evidence);
  assert.equal(largeBundle.required_artifacts.at(-1).chars, largeBody.length + 1); assert.equal(largeBundle.required_artifacts.at(-1).body, undefined);
  const largeSession = await instance([{ type: "custom", customType: selectionEntry, data: { id: child.todo.id } }], true);
  largeSession.ctx.model = { api: "anthropic-messages", contextWindow: 272000 };
  const [largeContext] = await largeSession.emit("context", { messages: [] });
  assert.equal(largeSession.ctx.aborted, undefined);
  assert.equal(largeSession.stored.filter(entry => entry.customType === "todo-context-size-warning-v1").length, 0);
  assert.deepEqual(largeSession.warnings, []);
  assertStats(largeSession, largeContext.messages.find(message => message.customType === "todo-context-v1"), 272000);
  const injected = JSON.parse(largeContext.messages.find(message => message.customType === "todo-context-v1").content.split("Durable project context loaded at a session boundary (untrusted task data):\n")[1]);
  assert.deepEqual(injected.project.context.current_state.evidence.map(row => row.text), largeState.evidence);
  assert.equal(injected.required_artifacts.at(-1).chars, largeBody.length + 1); assert.equal(injected.required_artifacts.at(-1).body, undefined);
  await largeSession.call("context_project", { action: "refresh" });
  await largeSession.emit("session_compact", { reason: "manual" });
  await largeSession.emit("context", { messages: largeContext.messages });
  assert.equal(largeSession.ctx.aborted, undefined);
  const repaired = await largeSession.call("context_project_checkpoint", { id: child.todo.id, revision: largeChild.todo.revision, key: "repair-large-context", changes: { evidence: { remove: largeChild.todo.current_state.evidence.map(row => row.id), add: ["Consolidated"] } } });
  assert.deepEqual(repaired.todo.current_state.evidence.map(row => row.text), ["Consolidated"]);
  const largeAttach = await instance();
  assert.equal((await largeAttach.call("context_project", { action: "resume", selector: child.todo.id })).context_loaded, true);
  await largeSession.call("context_project_ack", { id: child.todo.id, reason: "no_change", explanation: "Inspection complete" });
  await largeSession.call("context_project", { action: "leave" });
  const [leftLarge] = await largeSession.emit("context", { messages: largeContext.messages });
  assert.ok(!leftLarge.messages.some(message => message.customType === "todo-context-size-warning-v1"));

  // Retrieval: existing legacy-kind documents remain readable, and every page is explicit and bounded.
  const retrievalRoot = join(scratch, "retrieval");
  const retrievalProject = await create(retrievalRoot, "project", "Knowledge", "Own shared investigation");
  const retrievalChild = await create(retrievalRoot, "simple", "Completed work", "A stable delivery", undefined);
  const retrievalOther = await create(retrievalRoot, "simple", "Other owner", "Separate responsibility");
  const journalReference = "pi-history:v1/synthetic-session/tool-result";
  const evidenceText = `queue.id: consumer deduplication remains unverified ${journalReference}`;
  const decisionEvidence = [...Array.from({ length: 29 }, (_, index) => `${index}: ${"x".repeat(1900)}`), "x".repeat(1800) + " queue.id: late decision evidence"];
  const decisionText = ["Inspect consumer first", "Avoid duplicate side effects", ...decisionEvidence].join("\n");
  const oldKnowledge = await checkpoint(retrievalRoot, retrievalChild.todo.id, 1, {
    evidence: { add: [evidenceText, "Unrelated owner finding"] },
    decisions: [{ summary: "queue.id: old assumption", rationale: "Earlier synthetic observation", approval: "draft", evidence: [] }],
    questions: [{ text: "queue.id: did the consumer run?", resolution: "Synthetic run only" }],
    references: ["pi-history:v1/synthetic-session/tool-result"],
  }, "knowledge-first", "test");
  const currentKnowledge = await checkpoint(retrievalRoot, retrievalChild.todo.id, 2, {
    status: "done", decisions: [{ summary: "Inspect consumer first", rationale: "Avoid duplicate side effects", approval: "draft", evidence: decisionEvidence, supersedes: oldKnowledge.todo.decisions[0].id }],
  }, "knowledge-current", "test");
  await checkpoint(retrievalRoot, retrievalOther.todo.id, 1, { evidence: { add: ["queue.id: outside project"] } }, "knowledge-other", "test");
  await saveArtifact(retrievalRoot, retrievalProject.todo.id, (await locate(retrievalRoot, retrievalProject.todo.id)).todo.revision, { ...metadata, applies_to: [], required: false, body: "queue.id: parent-only research" });
  const pagedBody = (`Quoted \\\"line\\\" \\\\ newline\n🙂 `.repeat(3000) + "queue.id: exact document evidence").trim() + "\n";
  const documentOwner = await saveArtifact(retrievalRoot, retrievalChild.todo.id, currentKnowledge.todo.revision, { ...metadata, applies_to: [], required: false, body: pagedBody });
  const document = documentOwner.todo.artifacts[0];
  // This represents persisted artifacts authored by earlier releases, not permission to author legacy kinds.
  await mutate(retrievalRoot, retrievalChild.todo.id, documentOwner.todo.revision, todo => { todo.artifacts[0].kind = "verification"; return todo; });
  const retrievalAuthority = { session_id: "retrieval-fixture", approval_evidence: "Synthetic request: explicitly search the completed source records and document" };
  writeReference(retrievalRoot, { action: "reference_add", project_id: retrievalProject.todo.id, expected_revision: 2, reference: { kind: "project-grounding", source_project_id: retrievalChild.todo.id, reason: "Direct source records" }, key: "retrieval-grounding" }, retrievalAuthority);
  writeReference(retrievalRoot, { action: "reference_add", project_id: retrievalProject.todo.id, expected_revision: 3, reference: { kind: "artifact", source_owner_id: retrievalChild.todo.id, artifact_id: document.id, follow: "current", requirement: "source", reason: "Direct source document" }, key: "retrieval-artifact" }, retrievalAuthority);
  process.env.PI_TODO_PATH = retrievalRoot;
  const retrieval = await instance();
  const initialOwner = await locate(retrievalRoot, retrievalChild.todo.id);
  await retrieval.call("context_project_tighten", { id: retrievalChild.todo.id, revision: initialOwner.todo.revision, reason: "Retain old assumption on demand", consult_on_demand_decisions: [oldKnowledge.todo.decisions[0].id] });
  await retrieval.call("context_project", { action: "resume", selector: retrievalChild.todo.id });
  const retrievalFiles = [...await list(retrievalRoot)];
  const retrievalBefore = await Promise.all(retrievalFiles.map(item => savedJSON(item)));
  const retrievalEntries = JSON.stringify(retrieval.stored);
  let nextOffset = 0; let expectedVersion; let reconstructed = "";
  do {
    const rawPage = await retrieval.callRaw("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: nextOffset, ...(expectedVersion ? { expected_version: expectedVersion } : {}) });
    const page = rawPage.structuredContent;
    assert.deepEqual(rawPage.details, page);
    assert.ok(page.body.length <= 12000);
    assert.ok(rawPage.content[0].text.endsWith(page.body));
    assert.equal(page.offset, nextOffset);
    assert.equal(page.total_chars, pagedBody.length);
    assert.equal(page.complete, page.next_offset === null);
    reconstructed += page.body; expectedVersion = page.version; nextOffset = page.next_offset;
  } while (nextOffset !== null);
  assert.equal(reconstructed, pagedBody);
  assert.equal((await retrieval.call("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: pagedBody.length, expected_version: expectedVersion })).complete, true);
  await assert.rejects(retrieval.call("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: 1 }), /expected_version/);
  await assert.rejects(retrieval.call("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: pagedBody.length + 1, expected_version: expectedVersion }), /Offset/);

  const knowledgeQuery = { query: "QUEUE.ID", selector: retrievalChild.todo.id, limit: 1 };
  assert.deepEqual(await retrieval.call("context_project", { action: "search", query: "queue.id" }), []);
  let knowledgeCursor; const knowledgeHits = [];
  do {
    const page = await retrieval.call("context_project_search", { ...knowledgeQuery, ...(knowledgeCursor ? { cursor: knowledgeCursor } : {}) });
    knowledgeHits.push(...page.results); knowledgeCursor = page.next_cursor;
  } while (knowledgeCursor);
  assert.deepEqual(new Set(knowledgeHits.map(hit => hit.source_kind)), new Set(["evidence", "decision", "artifact"]));
  assert.ok(knowledgeHits.every(hit => hit.owner_id === retrievalChild.todo.id));
  assert.ok(knowledgeHits.find(hit => hit.source_kind === "artifact").excerpt.includes("queue.id"));
  assert.equal(knowledgeHits.find(hit => hit.source_kind === "decision").approval, "draft");
  assert.ok(!knowledgeHits.some(hit => hit.record_id === oldKnowledge.todo.decisions[0].id));
  for (const hit of knowledgeHits) {
    const { tool, ...args } = hit.read;
    assert.ok(await retrieval.call(tool, args));
  }
  const evidenceHit = knowledgeHits.find(hit => hit.source_kind === "evidence");
  const { tool: evidenceTool, ...evidenceArgs } = evidenceHit.read;
  const evidencePage = await retrieval.callRaw(evidenceTool, evidenceArgs);
  assert.equal(evidencePage.structuredContent.body, evidenceText);
  assert.deepEqual(evidencePage.details, evidencePage.structuredContent);
  assert.equal(evidencePage.content[0].text.split("\n\n").slice(1).join("\n\n"), evidenceText);
  assert.doesNotMatch(JSON.stringify(evidencePage), /Unrelated owner finding|todo\.json/);
  const referenceHit = (await retrieval.call("context_project_search", { query: journalReference, selector: retrievalChild.todo.id })).results.find(hit => hit.source_kind === "reference");
  const { tool: referenceTool, ...referenceArgs } = referenceHit.read;
  assert.equal((await retrieval.call(referenceTool, referenceArgs)).body, journalReference);
  assert.equal(referenceHit.in_active_context, true);

  const decisionHit = knowledgeHits.find(hit => hit.source_kind === "decision");
  assert.equal(decisionHit.read.offset, decisionText.toLowerCase().indexOf("queue.id") - 80);
  assert.ok(decisionHit.read.offset > 12000);
  const { tool: recordTool, ...decisionArgs } = decisionHit.read;
  assert.match((await retrieval.call(recordTool, decisionArgs)).body, /late decision evidence/);
  let recordTarget = { ...decisionHit.read, offset: 0, limit: 9000 }; let reconstructedRecord = "";
  do {
    const { tool, ...args } = recordTarget;
    const raw = await retrieval.callRaw(tool, args);
    const page = raw.structuredContent;
    assert.deepEqual(raw.details, page);
    assert.equal(raw.content[0].text.split("\n\n").slice(1).join("\n\n"), page.body);
    assert.ok(page.body.length <= 9000);
    assert.equal(page.total_chars, decisionText.length);
    assert.equal(page.offset, reconstructedRecord.length);
    assert.equal(page.complete, page.next_offset === null);
    assert.equal("text" in page, false);
    reconstructedRecord += page.body;
    recordTarget = page.read;
  } while (recordTarget);
  assert.equal(reconstructedRecord, decisionText);
  const artifactHit = knowledgeHits.find(hit => hit.source_kind === "artifact");
  assert.equal(artifactHit.match_field, "body");
  assert.equal(artifactHit.match_offset, pagedBody.indexOf("queue.id"));
  assert.equal(artifactHit.read.offset, artifactHit.match_offset - 80);
  assert.equal(artifactHit.read.expected_version, expectedVersion);
  const { tool: artifactTool, ...artifactArgs } = artifactHit.read;
  assert.match((await retrieval.call(artifactTool, artifactArgs)).body, /exact document evidence/);
  const metadataHit = (await retrieval.call("context_project_search", { query: document.title, selector: retrievalChild.todo.id })).results.find(hit => hit.source_kind === "artifact");
  assert.equal(metadataHit.match_field, "metadata");
  assert.equal(metadataHit.read.offset, 0);
  assert.equal("match_offset" in metadataHit, false);
  const boundaryHit = (await retrieval.call("context_project_search", { query: `${document.title}\n${document.description}`, selector: retrievalChild.todo.id })).results.find(hit => hit.source_kind === "artifact");
  assert.equal(boundaryHit.match_field, "metadata");
  assert.equal(boundaryHit.read.offset, 0);
  await assert.rejects(retrieval.call("context_project_record", { ...evidenceArgs, record_id: oldKnowledge.todo.decisions[0].id }), /index and no record_id/);
  const { index: _index, ...missingIndex } = evidenceArgs;
  await assert.rejects(retrieval.call("context_project_record", missingIndex), /require index/);
  await assert.rejects(retrieval.call("context_project_record", { ...decisionArgs, record_id: retrievalOther.todo.id }), /Record not found/);
  await assert.rejects(retrieval.call("context_project_record", { ...decisionArgs, index: 0 }), /record_id and no index/);
  await assert.rejects(retrieval.call("context_project_record", { ...evidenceArgs, offset: evidenceText.length + 1 }), /Offset/);
  const { expected_revision: _revision, ...missingRevision } = evidenceArgs;
  await assert.rejects(retrieval.call("context_project_record", missingRevision), /expected_revision/);

  const fullKnowledge = await retrieval.call("context_project_search", { ...knowledgeQuery, view: "full", limit: 20 });
  assert.ok(fullKnowledge.results.some(hit => hit.record_id === oldKnowledge.todo.decisions[0].id));
  assert.ok(fullKnowledge.results.some(hit => hit.source_kind === "question"));
  for (const hit of fullKnowledge.results.filter(hit => !hit.in_active_context)) {
    const { tool, ...args } = hit.read;
    const page = await retrieval.call(tool, args);
    assert.equal(page.in_active_context, false);
    if (hit.source_kind === "decision") {
      assert.deepEqual(page.inactive_reasons, ["hidden", "superseded"]);
      assert.equal(page.hidden, true);
      assert.equal(page.superseded_by, currentKnowledge.todo.decisions[1].id);
    } else {
      assert.deepEqual(page.inactive_reasons, ["resolved"]);
      assert.equal(page.resolved, true);
    }
    await assert.rejects(retrieval.call(tool, { ...args, view: "active" }), /not in active context/);
  }
  const projectKnowledge = await retrieval.call("context_project_search", { query: "queue.id", selector: retrievalProject.todo.id, limit: 20 });
  assert.deepEqual(new Set(projectKnowledge.results.map(hit => hit.owner_id)), new Set([retrievalProject.todo.id, retrievalChild.todo.id]));
  assert.ok((await retrieval.call("context_project_search", { query: "queue.id", limit: 20 })).results.some(hit => hit.owner_id === retrievalOther.todo.id));
  const cursorPage = await retrieval.call("context_project_search", knowledgeQuery);
  await assert.rejects(retrieval.call("context_project_search", { ...knowledgeQuery, query: "different", cursor: cursorPage.next_cursor }), /Cursor/);
  assert.deepEqual(await retrieval.call("context_project_search", { query: "absent knowledge" }), { results: [], next_cursor: null });
  await assert.rejects(retrieval.call("context_project_search", { query: "   " }), /non-whitespace/);
  assert.deepEqual(await Promise.all(retrievalFiles.map(item => savedJSON(item))), retrievalBefore);
  assert.equal(JSON.stringify(retrieval.stored), retrievalEntries);
  assert.equal((await locate(retrievalRoot, retrievalChild.todo.id)).todo.status, "done");
  const beforeReplacement = await locate(retrievalRoot, retrievalChild.todo.id);
  await retrieval.call("context_project_checkpoint", { id: retrievalChild.todo.id, revision: beforeReplacement.todo.revision, key: "replace-indexed-source", changes: { evidence: { remove: [beforeReplacement.todo.current_state.evidence[0].id] } } });
  const replacementFiles = await Promise.all(retrievalFiles.map(item => savedJSON(item)));
  const replacementEntries = JSON.stringify(retrieval.stored);
  await assert.rejects(retrieval.call("context_project_record", evidenceArgs), /Owner revision changed/);
  await assert.rejects(retrieval.call("context_project_record", decisionArgs), /Owner revision changed/);
  const replacementOwner = await locate(retrievalRoot, retrievalChild.todo.id);
  assert.equal((await retrieval.call("context_project_record", { ...evidenceArgs, expected_revision: replacementOwner.todo.revision })).body, "Unrelated owner finding");
  assert.deepEqual(await Promise.all(retrievalFiles.map(item => savedJSON(item))), replacementFiles);
  assert.equal(JSON.stringify(retrieval.stored), replacementEntries);
  const latestDocumentOwner = await locate(retrievalRoot, retrievalChild.todo.id);
  await retrieval.call("context_project_artifact", { action: "upsert", id: retrievalChild.todo.id, revision: latestDocumentOwner.todo.revision, artifact_id: document.id, ...metadata, applies_to: [], required: false, body: "New current document" });
  await assert.rejects(retrieval.call("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: 12000, expected_version: expectedVersion }), /Artifact changed/);
  assert.equal((await retrieval.call("context_project_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id })).body, "New current document\n");
  removeBody(retrievalProject, (await locate(retrievalRoot, retrievalProject.todo.id)).todo.artifacts[0].path);
  await assert.rejects(retrieval.call("context_project_search", { query: "anything", selector: retrievalProject.todo.id }), /Missing current artifact/);
  process.env.PI_TODO_PATH = root;

  // Retired move coverage → explicit associations/direct references: preserve
  // identity/history/terminal state; authorization/replay/stale/cancel at real tools.
  const moveRoot = join(scratch, "association-todos");
  process.env.PI_TODO_PATH = moveRoot;
  const moveProject = await create(moveRoot, "project", "Files", "Independent source");
  const projectDocument = await saveArtifact(moveRoot, moveProject.todo.id, 1, { ...metadata, body: "Source design" });
  let foundation = await create(moveRoot, "project", "Foundation", "Retain delivered knowledge");
  foundation = await checkpoint(moveRoot, foundation.todo.id, 1, changes, "foundation-context", "test-session");
  foundation = await saveArtifact(moveRoot, foundation.todo.id, foundation.todo.revision, { ...metadata, required: false, body: "First foundation design" });
  const foundationArtifact = foundation.todo.artifacts[0];
  foundation = await saveArtifact(moveRoot, foundation.todo.id, foundation.todo.revision, { ...foundationArtifact, body: "Current foundation design" });
  foundation = await checkpoint(moveRoot, foundation.todo.id, foundation.todo.revision, { status: "done" }, "foundation-complete", "test-session");
  const foundationManifest = JSON.parse(savedJSON(foundation));
  foundationManifest.next_actions = ["Retained legacy text"];
  foundationManifest.current_state.summary = "Retained legacy summary";
  replaceJSON(foundation, JSON.stringify(foundationManifest));
  withWrite(moveRoot, db => db.prepare("INSERT INTO retained_legacy_files VALUES(?,?,?)").run(foundation.todo.id, "artifacts/older-import.md", Buffer.from([0,255,10,128])));
  const bodySnapshot = () => withRead(moveRoot, db => ({ artifacts: db.prepare("SELECT version,body FROM artifact_revisions WHERE owner_id=? ORDER BY version").all(foundation.todo.id), retained: db.prepare("SELECT relative_path,body FROM retained_legacy_files WHERE owner_id=? ORDER BY relative_path").all(foundation.todo.id) }));
  const beforeBodies = bodySnapshot(), beforeFoundation = savedJSON(foundation), beforeSource = savedJSON(moveProject);
  const mover = await instance([], true), watchingMove = await instance();
  for (const actor of [mover, watchingMove]) await actor.call("context", { action: "attach", selector: foundation.todo.id });
  const moveSelection = restoreSelection(mover.stored);
  const linkInput = { action: "link", from: { kind: "project", id: foundation.todo.id }, to: { kind: "project", id: moveProject.todo.id }, relation: "contributes-to", reason: "Navigation, not ownership", key: "association-1" };
  const rowsSnapshot = () => withRead(moveRoot, db => ({ owners: db.prepare("SELECT id,document FROM owners ORDER BY id").all(), links: db.prepare("SELECT * FROM context_links ORDER BY id").all(), receipts: db.prepare("SELECT * FROM context_operations ORDER BY key").all() }));
  const beforeCancel = rowsSnapshot();
  assert.deepEqual(await mover.call("context_link", linkInput), { saved: false, canceled: true });
  assert.deepEqual(rowsSnapshot(), beforeCancel);
  await assert.rejects(watchingMove.call("context_link", linkInput), /approval|confirmation/i);
  let confirmations = 0;
  mover.ctx.ui.confirm = async (_title, detail) => {
    confirmations++;
    assert.ok(detail.includes(foundation.todo.id) && detail.includes(moveProject.todo.id));
    if (confirmations === 1) assert.ok(detail.includes("Navigation, not ownership"));
    withWrite(moveRoot, () => undefined); // User input never runs inside the SQL transaction.
    return true;
  };
  const rawLink = await mover.callRaw("context_link", linkInput);
  const linkedContext = rawLink.structuredContent;
  assert.deepEqual(JSON.parse(rawLink.content[0].text), linkedContext);
  assert.equal(linkedContext.accepted_revision, 1);
  assert.deepEqual(await mover.call("context_link", linkInput), linkedContext);
  assert.equal(confirmations, 1);
  await assert.rejects(mover.call("context_link", { ...linkInput, reason: "Changed under same key" }), /different action\/payload/);
  const directLink = mover.extension.tools.get("context_link").definition;
  await assert.rejects(directLink.execute("raw", { ...linkInput, unexpected: true }, undefined, undefined, mover.ctx), /unknown|irrelevant/i);
  await assert.rejects(mover.call("context_link", { action: "history", id: linkedContext.id, key: "forbidden" }), /unknown|irrelevant/i);
  await assert.rejects(mover.call("context_link", { ...linkInput, key: "duplicate-link" }), /already exists/);
  await assert.rejects(mover.call("context_link", { ...linkInput, to: linkInput.from, key: "self-link" }), /Self/);
  const backlinks = await mover.call("context_link", { action: "list", endpoint: linkInput.to, direction: "incoming" });
  assert.equal(backlinks.items[0].id, linkedContext.id);
  const expectedLinks = { count: 1, read: { tool: "context_link", action: "list", endpoint: linkInput.from, direction: "both" } };
  assert.deepEqual((await mover.call("context_project", { action: "list", include_done: true })).find(row => row.id === foundation.todo.id).links, expectedLinks);
  assert.deepEqual((await mover.call("context_project", { action: "search", query: foundation.todo.title })).find(row => row.id === foundation.todo.id).links, expectedLinks);
  const { tool: linkTool, ...linkRead } = expectedLinks.read;
  const fullLinks = await mover.call(linkTool, linkRead);
  assert.deepEqual((await mover.call("context_project", { action: "get", selector: foundation.todo.id })).links, fullLinks);
  assert.deepEqual((await mover.call("context", { action: "read", kind: "project", selector: foundation.todo.id })).links, fullLinks);
  const changedReason = await mover.call("context_link", { action: "update_reason", id: linkedContext.id, expected_revision: 1, reason: "Explicit navigation", key: "reason" });
  const unlinked = await mover.call("context_link", { action: "unlink", id: linkedContext.id, expected_revision: changedReason.accepted_revision, change_note: "Retain history", key: "unlink" });
  assert.equal((await mover.call("context_project", { action: "list", include_done: true })).find(row => row.id === foundation.todo.id).links.count, 0, "discovery excludes inactive associations");
  assert.equal((await mover.call("context_link", { ...linkRead, include_inactive: true })).items[0].id, linkedContext.id);
  await mover.call("context_link", { action: "restore", id: linkedContext.id, expected_revision: unlinked.accepted_revision, change_note: "Restore explicit navigation", key: "restore" });
  assert.equal((await mover.call("context_link", { action: "history", id: linkedContext.id })).items.length, 4);
  const promptsBeforeLinkReplay = confirmations;
  assert.deepEqual(await mover.call("context_link", linkInput), { ...linkedContext, current_revision: 4 });
  assert.equal(confirmations, promptsBeforeLinkReplay);
  assert.equal(savedJSON(foundation), beforeFoundation); assert.equal(savedJSON(moveProject), beforeSource);
  assert.deepEqual(bodySnapshot(), beforeBodies);
  assert.equal(restoreSelection(mover.stored), moveSelection);
  assert.equal((await readKnown(moveRoot, foundation)).todo.status, "done");
  assert.equal((await mover.call("context_project_artifact", { action: "read", id: foundation.todo.id, artifact_id: foundationArtifact.id, expected_version: foundation.todo.artifacts[0].path })).body, "Current foundation design\n");
  const reference = { kind: "artifact", source_owner_id: moveProject.todo.id, artifact_id: projectDocument.todo.artifacts[0].id, follow: "current", requirement: "source", reason: "Read direct required source" };
  const ref = await mover.call("context_link", { action: "reference_add", project_id: foundation.todo.id, expected_revision: foundation.todo.revision, reference, key: "reference-add" });
  await mover.emit("context", { messages: [] });
  assert.ok(!mover.stored.some(entry => entry.customType === "todo-context-drift-v1"));
  await watchingMove.emit("context", { messages: [] });
  assert.ok(watchingMove.stored.some(entry => entry.customType === "todo-context-drift-v1"));
  assert.equal((await locate(moveRoot, foundation.todo.id)).todo.status, "done");
  await assert.rejects(mover.call("context", { action: "detach" }), /Checkpoint or acknowledge/); // Own reference edits don't acknowledge.
  await mover.call("context", { action: "refresh" });
  const referenceBundle = await resumeBundle(moveRoot, foundation.todo.id);
  assert.equal(referenceBundle.required_artifacts[0].source_owner_id, moveProject.todo.id);
  assert.equal(referenceBundle.grounding.length, 0); // Artifact ref doesn't enroll source records.
  assert.deepEqual(bodySnapshot(), beforeBodies);
  const beforeStale = rowsSnapshot();
  mover.ctx.ui.confirm = async () => {
    await checkpoint(moveRoot, foundation.todo.id, ref.accepted_revision, { references: ["Concurrent source edit"] }, "during-confirm", "other-session"); return true;
  };
  await assert.rejects(mover.call("context_link", { action: "reference_remove", project_id: foundation.todo.id, expected_revision: ref.accepted_revision, reference_id: ref.reference_id, change_note: "Remove source", key: "stale-reference" }), /Stale/);
  assert.equal(withRead(moveRoot, db => db.prepare("SELECT count(*) n FROM context_operations WHERE key='stale-reference'").get().n), 0);
  assert.deepEqual(bodySnapshot(), beforeBodies);
  assert.ok(rowsSnapshot().owners.length === beforeStale.owners.length);

  // Real new knowledge tools: independent creation, strict fields, native UI,
  // readonly no attachment, provenance, exact current-request evidence/retry.
  const kb = await instance([], true);
  const kbFields = { title: "Reusable ownership", summary: "Preserve independent identity", scope: "Synthetic library proof", explanation: "Keep exact source identity. " + "unread tail ".repeat(1500), sources: [] };
  const kbCreate = { action: "create", fields: kbFields, key: "kb-native" };
  const beforeKnowledge = () => withRead(moveRoot, db => db.prepare("SELECT count(*) n FROM knowledge_entries").get().n);
  const kbCount = beforeKnowledge();
  assert.deepEqual(await kb.call("context_knowledge", kbCreate), { saved: false, canceled: true });
  assert.equal(beforeKnowledge(), kbCount);
  await assert.rejects(watchingMove.call("context_knowledge", kbCreate), /approval|confirmation/i);
  let kbPrompts = 0;
  kb.ctx.ui.confirm = async (_title, detail) => { kbPrompts++; assert.ok(detail.includes(kbFields.title)); if (kbPrompts === 1) assert.ok(detail.includes("unread tail")); else assert.ok(detail.includes("Clarified identity")); withWrite(moveRoot, () => undefined); return true; };
  const kbReceipt = await kb.call("context_knowledge", kbCreate);
  assert.equal(kbPrompts, 1);
  assert.deepEqual(await kb.call("context_knowledge", kbCreate), kbReceipt);
  assert.equal(kbPrompts, 1);
  const directKnowledge = kb.extension.tools.get("context_knowledge").definition;
  await assert.rejects(directKnowledge.execute("raw", { ...kbCreate, irrelevant: true }, undefined, undefined, kb.ctx), /unknown|fields/i);
  assert.equal(kbPrompts, 1);
  await assert.rejects(kb.call("context_knowledge", { action: "history", id: kbReceipt.id, approval_evidence: "Not allowed" }), /unknown|fields/i);
  await assert.rejects(kb.call("context", { action: "read", kind: "project", selector: foundation.todo.id, offset: 0 }), /fields|irrelevant/i);
  await assert.rejects(kb.call("context", { action: "read", kind: "knowledge", id: kbReceipt.id, selector: "forbidden" }), /fields|irrelevant/i);
  const kbSummary = await kb.call("context", { action: "read", kind: "knowledge", id: kbReceipt.id });
  assert.ok(!JSON.stringify(kbSummary).includes("unread tail"));
  assert.deepEqual(await kb.call("context", { action: "status" }), { selected: null });
  assert.equal(restoreSelection(kb.stored), undefined);
  const oneOffHistory = await kb.call("context_knowledge", { action: "history", id: kbReceipt.id });
  assert.equal(oneOffHistory.items[0].provenance.session_id, kb.ctx.sessionManager.getSessionId());
  assert.equal(oneOffHistory.items[0].provenance.session_project_id, undefined);
  assert.equal((await kb.call("context_link", { action: "list", endpoint: { kind: "knowledge", id: kbReceipt.id } })).items.length, 0);
  assert.deepEqual(await kb.call("context", { action: "read", kind: "project", selector: foundation.todo.id, view: "full" }), await kb.call("context_project", { action: "get", selector: foundation.todo.id, view: "full" }));
  const explicitEvidence = 'User: "Save the reusable source identity explanation from Files."';
  const originated = await watchingMove.call("context_knowledge", { action: "create", fields: { ...kbFields, title: "Pinned source", explanation: "Source identity" }, origin: { project_id: moveProject.todo.id, artifact_id: projectDocument.todo.artifacts[0].id, artifact_version: projectDocument.todo.artifacts[0].path }, key: "kb-origin", approval_evidence: explicitEvidence });
  const origins = await watchingMove.call("context_link", { action: "list", endpoint: { kind: "knowledge", id: originated.id }, direction: "outgoing" });
  assert.equal(origins.items[0].relation, "originated-in");
  const pinnedHistory = await watchingMove.call("context_knowledge", { action: "history", id: originated.id });
  assert.equal(pinnedHistory.items[0].provenance.approval_evidence, explicitEvidence);
  assert.equal(pinnedHistory.items[0].provenance.session_project_id, foundation.todo.id);
  assert.deepEqual(pinnedHistory.items[0].provenance.origin, { project_id: moveProject.todo.id, artifact_id: projectDocument.todo.artifacts[0].id, artifact_version: projectDocument.todo.artifacts[0].path });
  assert.equal(savedJSON(moveProject), beforeSource); // Saving knowledge never rewrites source.
  const revisedKB = await kb.call("context_knowledge", { action: "update", id: kbReceipt.id, expected_revision: 1, fields: { summary: "Clarified identity" }, change_note: "Preserve unread explanation", key: "kb-summary" });
  assert.equal(revisedKB.accepted_revision, 2);
  const promptsBeforeKnowledgeReplay = kbPrompts;
  assert.deepEqual(await kb.call("context_knowledge", kbCreate), { ...kbReceipt, current_revision: 2 });
  assert.equal(kbPrompts, promptsBeforeKnowledgeReplay);
  const historicalKB = await kb.call("context", { action: "read", kind: "knowledge", id: kbReceipt.id, section: "content", revision: 1 });
  assert.ok(historicalKB.body.includes("Keep exact source identity"));
  assert.equal((await kb.call("context_knowledge", { action: "history", id: kbReceipt.id })).items.length, 2);
  assert.equal((await locate(moveRoot, foundation.todo.id)).todo.status, "done");
  process.env.PI_TODO_PATH = root;

  // Native durable views consume real tool outputs without changing their data contracts.
  {
    process.env.PI_TODO_PATH = join(scratch, "visual-cards");
    const visual = await instance();
    const prerequisite = (await visual.call("context_project", { action: "create", type: "simple", title: "Visual prerequisite", outcome: "Prepare" })).todo;
    const visualItem = (await visual.call("context_project", { action: "create", type: "simple", title: "Visual target", outcome: "Read evidence before completion", depends_on: [prerequisite.id] })).todo;
    const stripVisual = text => text.replace(/\x1b\[[0-9;]*m/g, "");
    const show = async (name, args) => {
      const output = await visual.callRaw(name, args);
      const before = structuredClone(output);
      const tool = visual.extension.tools.get(name).definition;
      const rendered = [];
      for (const expanded of [false, true]) {
        const component = tool.renderResult(output, { expanded, isPartial: false }, themeModule.theme, { args });
        for (const width of [12, 40, 80]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
        rendered.push(stripVisual(component.render(120).join("\n")));
        assert.equal(component.render(120).join("").includes("\x1b[49m"), false);
      }
      assert.deepEqual(output, before);
      return rendered.join("\n");
    };
    const openView = await show("context_project", { action: "list" });
    assert.match(openView, /Project \(durable\).*2 open/);
    assert.match(openView, /Waiting on: Visual prerequisite/);
    assert.doesNotMatch(openView, /Prerequisites satisfied/);
    assert.doesNotMatch(openView, /\d+\/\d+ done/);
    const itemView = await show("context_project", { action: "get", selector: visualItem.id });
    assert.match(itemView, /Visual target/);
    assert.match(itemView, /Waiting on: Visual prerequisite/);
    assert.match(itemView, /Read evidence before completion/);
    assert.match(await show("context_project", { action: "search", query: "Visual target" }), /1 match/);
    assert.match(await show("context_project", { action: "resume", selector: visualItem.id }), /Context loaded/);
    assert.match(await show("context_project", { action: "status" }), /Attached/);
    assert.match(await show("context_project_checkpoint", { id: visualItem.id, revision: 1, key: "visual-saved", changes: { references: ["https:\/\/example.com/evidence"] } }), /Saved[\s\S]*r2/);
    await visual.call("context_project_checkpoint", { id: prerequisite.id, revision: 1, key: "visual-prerequisite-done", changes: { status: "done" } });
    const completeView = await show("context_project", { action: "list", include_done: true });
    assert.match(completeView, /1\/2 done/);
    // One real dependency has completed; the unrelated prerequisite item has none.
    assert.equal((completeView.match(/Prerequisites satisfied/g) ?? []).length, 2); // once per expanded state
    assert.match(await show("context_project", { action: "leave" }), /No project attached/);
    const fallbackTool = visual.extension.tools.get("context_project").definition;
    assert.equal(fallbackTool.renderResult({ details: { older_shape: true }, content: [{ type: "text", text: "Legacy view" }] }, {}, themeModule.theme, {}).render(80).join("").trimEnd(), "Legacy view");
    const longLegacy = { details: { older_shape: true }, content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `Legacy line ${i}`).join("\n") }] };
    const collapsedLegacy = fallbackTool.renderResult(longLegacy, { expanded: false }, themeModule.theme, {}).render(80).join("\n");
    assert.match(collapsedLegacy, /10 more lines/);
    assert.doesNotMatch(collapsedLegacy, /Legacy line 19/);
    assert.match(fallbackTool.renderResult(longLegacy, { expanded: true }, themeModule.theme, {}).render(80).join("\n"), /Legacy line 19/);
    process.env.PI_TODO_PATH = root;

  }

  // Corruption is still visible and never silently reset.
  withWrite(root, db => { db.exec("PRAGMA ignore_check_constraints=ON"); db.prepare("UPDATE owners SET document=? WHERE id=?").run("{broken", child.todo.id); });
  await largeAttach.emit("session_compact", { reason: "manual" });
  const [failed] = await largeAttach.emit("context", { messages: [] });
  assert.equal(largeAttach.ctx.aborted, true);
  assert.ok(!failed.messages.some(message => message.customType === "todo-context-v1"));
  await assert.rejects(checkpoint(root, child.todo.id, 4, {}, "corrupt", "test-session"), /JSON|Unexpected|position/);
  assert.equal(await savedJSON(child), "{broken");
  console.log("project checks passed: structured state, projects, artifacts, retries, locking, paths, lifecycle, compaction/reconciliation, budgets, approval, UI and mocked Linear");
} finally {
  if (oldRoot === undefined) delete process.env.PI_TODO_PATH; else process.env.PI_TODO_PATH = oldRoot;
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(scratch, { recursive: true, force: true });
}
