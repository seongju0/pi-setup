// Run from the repository root: npm test. Direct: node agent/extensions/todo/tests/test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile, stat, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configuredRoot, create, list, locate, checkpoint, mutate, withStoreLock } from "../storage.ts";
import { applyChanges, createTodo, needsApproval, validate } from "../state.ts";
import { readArtifact, saveArtifact } from "../artifacts.ts";
import { restoreSelection, resumeBundle, selectionEntry, checkpointMessage } from "../session.ts";
import { compactionEntry, acknowledgementEntry, pendingReconciliation, preservationType, preservationState } from "../compaction.ts";

const scratch = await mkdtemp(join(tmpdir(), "pi-todo-test-"));
const root = join(scratch, "todos");
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/core/session-manager.js")));
const themeModule = await import(pathToFileURL(join(packageRoot, "dist/modes/interactive/theme/theme.js")));
const { visibleWidth } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")));
themeModule.initTheme("dark", false);
const { validateToolArguments } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/utils/validation.js")));
const oldRoot = process.env.PI_TODO_PATH;
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_TODO_PATH = root;
process.env.PI_CODING_AGENT_DIR = scratch;

async function instance(branch = [], interactive = false, deferMessages = false, withTasks = false) {
  const runtime = createExtensionRuntime();
  const stored = [...branch]; const warnings = []; const statuses = []; const confirmations = []; const selects = []; const inputs = []; const editors = []; const panels = []; const customSteps = [];
  runtime.getSettings = () => ctx.settings ?? {};
  runtime.appendEntry = (customType, data) => stored.push({ type: "custom", customType, data });
  const pending = [];
  runtime.sendMessage = (message) => (deferMessages ? pending : stored).push({ type: "custom_message", ...message });
  const flush = () => stored.push(...pending.splice(0));
  runtime.sendUserMessage = (content) => stored.push({ type: "user_request", content });
  const loaded = await loadExtensions([...(withTasks ? [join(directory, "../task/index.ts")] : []), join(directory, "index.ts")], scratch, undefined, runtime);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find(extension => extension.tools.has("todo"));
  const ctx = {
    cwd: scratch, hasUI: interactive, mode: interactive ? "tui" : "print", tools: [], waitForIdle: async () => {},
    sessionManager: { getSessionId: () => "test-session", getBranch: () => stored, buildContextEntries: () => stored, getSessionFile: () => withTasks ? join(scratch, "combined.jsonl") : undefined },
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
    return withTasks && type === "context" ? [{ messages }] : results;
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
  const project = await create(root, "project", "Rollout", "Complete the rollout");
  assert.deepEqual(project.todo.current_state, { evidence: [] });
  assert.equal("next_actions" in project.todo, false);
  const child = await create(root, "simple", "Migrate", "Convert unresolved work", project.todo.id);
  const sibling = await create(root, "simple", "Observe", "Validate operations", project.todo.id);
  await assert.rejects(create(root, "project", "Nested", "No", project.todo.id), /Only root/);
  await assert.rejects(create(root, "simple", "Grandchild", "No", child.todo.id), /Only root/);
  assert.equal((await list(root)).length, 3);
  const interrupted = join(project.directory, "todos", `${createTodo("simple", "Interrupted", "No").id}.creating`);
  await mkdir(interrupted);
  assert.equal((await list(root)).length, 3);
  const changes = { current_state: { evidence: ["Converter tested", "https://example.com/pr/1"] }, decisions: [{ summary: "Preserve IDs", rationale: "Avoid duplicate work", approval: "draft", evidence: [] }] };
  const updated = await checkpoint(root, child.todo.id, 1, changes, "checkpoint-1", "test-session");
  assert.equal(updated.todo.revision, 2);
  assert.equal(updated.todo.status, "in_progress");
  assert.equal((await locate(root, project.todo.id)).todo.status, "in_progress");
  assert.equal((await locate(root, sibling.todo.id)).todo.status, "todo");
  assert.deepEqual((await checkpoint(root, child.todo.id, 1, changes, "checkpoint-1", "test-session")).todo, updated.todo);
  await assert.rejects(checkpoint(root, child.todo.id, 2, {}, "checkpoint-1", "test-session"), /different content/);
  await assert.rejects(checkpoint(root, child.todo.id, 1, {}, "checkpoint-2", "test-session"), /Stale revision/);
  assert.equal((await stat(join(updated.directory, "todo.json"))).mode & 0o777, 0o600);
  const approved = applyChanges(updated.todo, { decisions: [{ ...updated.todo.decisions[0], approval: "approved" }] });
  assert.ok(needsApproval(updated.todo, { outcome: "Different outcome" }));
  assert.ok(needsApproval(approved, { decisions: [{ summary: "New direction", rationale: "Changed evidence", approval: "draft", evidence: [], supersedes: approved.decisions[0].id }] }));
  assert.throws(() => applyChanges(updated.todo, { surprise: true }), /unknown/);

  const metadata = { title: "Migration design", kind: "design", description: "Conversion contracts", lifecycle: "current", required: true, applies_to: [child.todo.id], body: "# Migration\n\nPreserve IDs." };
  const withArtifact = await saveArtifact(root, project.todo.id, 2, metadata);
  const artifact = withArtifact.todo.artifacts[0];
  assert.equal((await resumeBundle(root, child.todo.id)).required_artifacts.length, 1);
  assert.equal((await resumeBundle(root, sibling.todo.id)).required_artifacts.length, 0);
  assert.equal((await resumeBundle(root, project.todo.id)).required_artifacts.length, 0);
  const revised = await saveArtifact(root, project.todo.id, 3, { ...metadata, id: artifact.id, body: "# Revised design" });
  assert.notEqual(revised.todo.artifacts[0].path, artifact.path);
  assert.match(await readFile(join(project.directory, artifact.path), "utf8"), /Preserve IDs/);
  await assert.rejects(saveArtifact(root, child.todo.id, 2, { ...metadata }), /direct children/);
  const childArtifact = await saveArtifact(root, child.todo.id, 2, { ...metadata, applies_to: [], required: false });
  assert.match(await readArtifact(root, childArtifact, childArtifact.todo.artifacts[0].id), /Preserve IDs/);
  const beforeInvalid = await readFile(join(child.directory, "todo.json"), "utf8");
  await assert.rejects(saveArtifact(root, child.todo.id, 3, { ...metadata, kind: "runbook", applies_to: [] }), /research or design/);
  await assert.rejects(saveArtifact(root, child.todo.id, 3, { ...metadata, applies_to: [], lifecycle: "superseded", required: true }), /Only current/);
  assert.equal(await readFile(join(child.directory, "todo.json"), "utf8"), beforeInvalid);

  // Cross-process locking, abort safety, and path confinement.
  await withStoreLock(root, async () => {
    const script = `import { checkpoint } from ${JSON.stringify(pathToFileURL(join(directory, "storage.ts")).href)}; try { await checkpoint(${JSON.stringify(root)}, ${JSON.stringify(child.todo.id)}, 3, {}, 'parallel', 'other'); process.exit(1); } catch(e) { if (!e.message.includes('busy')) throw e; }`;
    const worker = spawn(process.execPath, ["--input-type=module", "-e", script]);
    let stderr = ""; worker.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => worker.on("exit", resolve)); assert.equal(code, 0, stderr);
  });
  await assert.rejects(checkpoint(root, child.todo.id, 3, {}, "abort", "test-session", AbortSignal.abort()), /abort/i);
  await symlink(scratch, join(child.directory, "artifacts", "escape"));
  const hostile = structuredClone(childArtifact.todo); hostile.artifacts[0].path = "../../escape.md";
  await assert.rejects(mutate(root, child.todo.id, 3, () => hostile), /Invalid artifact/);
  const symlinkId = createTodo("simple", "Symlink", "No").id;
  await symlink(scratch, join(root, symlinkId)); await assert.rejects(list(root), /Symlinks/); await rm(join(root, symlinkId));

  // Real extension loader, schema validation, selection restoration and nonforcing bookkeeping guidance.
  const pi = await instance([], true);
  await pi.call("todo", { action: "resume", selector: child.todo.id });
  assert.equal(restoreSelection(pi.stored), child.todo.id);
  const [context] = await pi.emit("context", { messages: [] });
  assert.match(context.messages.at(-1).content, /Converter tested/);
  assert.doesNotMatch(context.messages.at(-1).content, /Observe.*current_state/);
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
  await pi.extension.commands.get("todo").handler("checkpoint", pi.ctx);
  assert.equal(pi.stored.at(-1).type, "user_request");
  await pi.call("todo_ack", { id: child.todo.id, reason: "no_change", explanation: "Only inspected context" });
  const resumed = await instance(pi.stored);
  assert.equal(restoreSelection(resumed.stored), child.todo.id);
  await resumed.emit("session_tree"); assert.equal((await locate(root, child.todo.id)).todo.revision, 3);
  const blank = await instance();
  assert.equal((await blank.emit("context", { messages: [] }))[0].messages.length, 0);
  const beforeSearchErrors = await list(root);
  await assert.rejects(blank.call("todo", { action: "search" }), /query required/);
  await assert.rejects(blank.call("todo", { action: "search", query: " --!? " }), /letters or numbers/);
  await assert.rejects(blank.call("todo", { action: "search", query: "Migrate", status: "blocked" }), /validation/i);
  assert.deepEqual(await list(root), beforeSearchErrors);
  assert.deepEqual(blank.stored, []);
  await assert.rejects(blank.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "invalid", changes: { arbitrary: true } }), /validation|additional/i);
  for (const retired of [{ current_state: { summary: "Retired narrative", evidence: [] } }, { next_actions: ["Retired instruction"] }]) {
    await assert.rejects(blank.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "retired", changes: retired }), /validation|additional/i);
    await assert.rejects(blank.call("todo_tighten", { id: child.todo.id, revision: 3, reason: "Maintenance", ...retired }), /validation|additional/i);
    assert.throws(() => applyChanges(updated.todo, retired), /unknown/);
  }
  await assert.rejects(blank.call("todo_artifact", { action: "upsert", id: child.todo.id, revision: 3, ...metadata, kind: "runbook", applies_to: [] }), /validation/i);
  await assert.rejects(blank.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "unapproved", changes: { outcome: "New outcome" } }), /sign-off/);
  await assert.rejects(pi.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "declined", changes: { outcome: "New outcome" } }), /sign-off/);
  pi.confirmations.push(true);
  const accepted = await pi.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "approved", changes: { outcome: "New outcome" } });
  assert.equal(accepted.todo.outcome, "New outcome");
  pi.selects.push("simple"); // Explicit command create uses input/editor, no selector.
  pi.inputs.push("Chore"); pi.editors.push("Finish chore"); pi.confirmations.push(false);
  await pi.extension.commands.get("todo").handler("new simple", pi.ctx);
  assert.equal((await list(root)).length, 4);

  // Task memory survives a fresh session and removal of its temporary design source.
  const continuationRoot = join(scratch, "continuation-todos");
  process.env.PI_TODO_PATH = continuationRoot;
  const author = await instance();
  assert.deepEqual(await author.call("todo", { action: "status" }), { selected: null });
  assert.deepEqual(author.stored, []);
  const owner = await author.call("todo", { action: "create", type: "simple", title: "Versioned identifiers", outcome: "Preserve record identity across conversion" });
  const candidates = await author.call("todo", { action: "search", query: "versioned identifiers" });
  assert.equal(candidates[0].id, owner.todo.id);
  await author.call("todo", { action: "get", selector: candidates[0].id, view: "active" });
  assert.deepEqual(await author.call("todo", { action: "status" }), { selected: null }); // Discovery/inspection is not attachment.
  await author.call("todo", { action: "resume", selector: candidates[0].id });
  const finding = "Verified identifier ownership; deployment remains unverified.";
  const preserved = await author.call("todo_checkpoint", { id: owner.todo.id, revision: 1, key: "identifier-owner", changes: { current_state: { evidence: [finding] } } });
  const temporaryDesign = join(scratch, "temporary-design.md");
  const designBody = "# Durable design\n\nRetain the original record identifier during conversion.\n";
  await writeFile(temporaryDesign, designBody);
  const designed = await author.call("todo_artifact", { action: "upsert", id: owner.todo.id, revision: preserved.todo.revision, title: "Identifier migration design", kind: "design", description: "Stable identity contract", lifecycle: "current", required: true, applies_to: [], body: await readFile(temporaryDesign, "utf8") });
  await rm(temporaryDesign);
  const fresh = await instance(); // No inherited transcript, selection or temporary source document.
  fresh.ctx.sessionManager.getSessionId = () => "fresh-task-session";
  assert.deepEqual(await fresh.call("todo", { action: "status" }), { selected: null });
  const rediscovered = await fresh.call("todo", { action: "search", query: "versioned identifiers" });
  await fresh.call("todo", { action: "resume", selector: rediscovered[0].id });
  const [freshContext] = await fresh.emit("context", { messages: [] });
  const brief = freshContext.messages.find(message => message.customType === "todo-context-v1").content;
  assert.ok(brief.includes(finding));
  assert.ok(brief.includes("Identifier migration design"));
  assert.ok(!brief.includes("Retain the original record identifier during conversion.")); // Catalog first, body on demand.
  const durableBody = await fresh.call("todo_artifact", { action: "read", id: owner.todo.id, artifact_id: designed.todo.artifacts[0].id });
  assert.equal(durableBody.body, designBody);
  assert.equal(durableBody.complete, true);
  const externalUpdate = await author.call("todo_checkpoint", { id: owner.todo.id, revision: designed.todo.revision, key: "external-nuance", changes: { current_state: { evidence: [finding, "External discovery: preserve imported aliases too."] } } });
  const beforeStatus = await readFile(join(owner.directory, "todo.json"), "utf8");
  const beforeStatusEntries = fresh.stored.length;
  const attachment = await fresh.call("todo", { action: "status" });
  assert.equal(attachment.selected.id, owner.todo.id);
  assert.equal(attachment.selected.revision, externalUpdate.todo.revision);
  assert.equal(attachment.selected.status, "in_progress");
  assert.equal("current_state" in attachment.selected, false);
  assert.equal(fresh.stored.length, beforeStatusEntries);
  assert.equal(await readFile(join(owner.directory, "todo.json"), "utf8"), beforeStatus);
  const [afterStatusContext] = await fresh.emit("context", { messages: freshContext.messages });
  assert.match(afterStatusContext.messages.find(message => message.customType === "todo-context-drift-v1").content, /changed outside this session/);
  assert.equal(afterStatusContext.messages.find(message => message.customType === "todo-context-v1").content, brief); // Status neither observes the external write nor refreshes the brief.
  await assert.rejects(fresh.call("todo", { action: "leave" }), /Checkpoint or acknowledge/); // Status is not acknowledgement.
  await fresh.call("todo_ack", { id: owner.todo.id, reason: "no_change", explanation: "Only recovered saved understanding" });
  await fresh.call("todo", { action: "leave" });
  assert.deepEqual(await fresh.call("todo", { action: "status" }), { selected: null });
  assert.equal(await readFile(join(owner.directory, "todo.json"), "utf8"), beforeStatus);

  // Recap joins live scoped memory to bounded native journal evidence without observing or saving it.
  {
    const root = join(scratch, "recap-todos");
    process.env.PI_TODO_PATH = root;
    const recapProject = await create(root, "project", "Recap rollout", "Preserve identity across conversion");
    const recapChild = await create(root, "simple", "Recap conversion", "Convert identifiers", recapProject.todo.id);
    const recapPrereq = await create(root, "simple", "Recap prerequisite", "Review compatibility", recapProject.todo.id);
    let recapParent = await saveArtifact(root, recapProject.todo.id, 1, { ...metadata, title: "Scoped recap design", applies_to: [recapChild.todo.id], body: "RECAP_BODY_NOT_EAGERLY_READ" });
    recapParent = await saveArtifact(root, recapProject.todo.id, recapParent.todo.revision, { ...metadata, title: "Other child design", applies_to: [recapPrereq.todo.id] });
    let recapSaved = await checkpoint(root, recapChild.todo.id, 1, { ...changes, depends_on: [recapPrereq.todo.id] }, "recap-saved", "earlier-session");
    recapSaved = await saveArtifact(root, recapChild.todo.id, recapSaved.todo.revision, { ...metadata, title: "Hidden recap research", required: false, applies_to: [] });
    const recapPi = await instance();
    await recapPi.call("todo", { action: "resume", selector: recapChild.todo.id });
    await recapPi.call("todo_tighten", { id: recapChild.todo.id, revision: recapSaved.todo.revision, reason: "No longer needed in orientation", consult_on_demand_artifacts: [recapSaved.todo.artifacts[0].id] });
    await recapPi.call("todo", { action: "refresh" });
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
    recapSaved = await checkpoint(root, recapChild.todo.id, (await locate(root, recapChild.todo.id)).todo.revision, { current_state: { evidence: ["External finding: deployment remains unverified"] } }, "recap-external", "another-session");
    const recapFiles = await Promise.all([recapParent, recapSaved, recapPrereq].map(row => readFile(join(row.directory, "todo.json"), "utf8")));
    const requiredRecapPath = join(recapParent.directory, recapParent.todo.artifacts[0].path);
    const requiredRecapBody = await readFile(requiredRecapPath, "utf8");
    await rm(requiredRecapPath); // Even a required artifact body is not opened by recap.
    const beforeRecapEntries = structuredClone(recapPi.stored);
    const recapData = await recapPi.call("todo_recap", {});
    assert.equal(recapData.selected, recapChild.todo.id);
    assert.deepEqual(recapData.scopes.map(scope => scope.context.id), [recapProject.todo.id, recapChild.todo.id]);
    assert.equal(recapData.scopes[1].context.revision, recapSaved.todo.revision);
    assert.deepEqual(recapData.scopes[1].context.current_state.evidence, ["External finding: deployment remains unverified"]);
    assert.equal(recapData.scopes[1].context.decisions[0].approval, "draft");
    assert.deepEqual(recapData.scopes.flatMap(scope => scope.context.artifacts.map(a => a.title)), ["Scoped recap design"]);
    assert.deepEqual(recapData.scopes[0].context.artifacts[0].read, { tool: "todo_artifact", arguments: { action: "read", id: recapProject.todo.id, artifact_id: recapParent.todo.artifacts[0].id } });
    assert.deepEqual(recapData.prerequisites.map(row => row.id), [recapPrereq.todo.id]);
    assert.equal(recapData.children.length, 2);
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
    assert.deepEqual(await recapPi.call("todo_recap", {}), recapData);
    assert.deepEqual(recapPi.stored, beforeRecapEntries);
    assert.deepEqual(await Promise.all([recapParent, recapSaved, recapPrereq].map(row => readFile(join(row.directory, "todo.json"), "utf8"))), recapFiles);
    await assert.rejects(resumeBundle(root, recapChild.todo.id), /ENOENT/); // Resume still validates mandatory bodies.
    await writeFile(requiredRecapPath, requiredRecapBody);
    const [recapDrift] = await recapPi.emit("context", { messages: recapContext.messages });
    assert.match(recapDrift.messages.find(message => message.customType === "todo-context-drift-v1").content, /changed outside this session/);
    await recapPi.call("todo_recap", {});
    const [recapDriftAgain] = await recapPi.emit("context", { messages: recapDrift.messages });
    assert.equal(recapDriftAgain.messages.find(message => message.customType === "todo-context-drift-v1").content, recapDrift.messages.find(message => message.customType === "todo-context-drift-v1").content);
    await assert.rejects(recapPi.call("todo", { action: "leave" }), /Checkpoint or acknowledge/);
    assert.deepEqual(pendingReconciliation(recapPi.stored, recapChild.todo.id), marker);
    const recapTool = recapPi.extension.tools.get("todo_recap").definition;
    assert.equal(recapTool.annotations.readOnlyHint, true);
    assert.match(recapTool.promptGuidelines.join(" "), /generic service or Git status/);
    const recapCommand = recapPi.extension.commands.get("todo");
    assert.ok(recapCommand.getArgumentCompletions("rec").some(row => row.value === "recap"));
    const beforeRecapCommand = structuredClone(recapPi.stored);
    let recapWaited = false;
    await recapCommand.handler("recap", { ...recapPi.ctx, waitForIdle: async () => { recapWaited = true; } });
    assert.equal(recapWaited, true);
    assert.deepEqual(recapPi.stored.slice(0, -1), beforeRecapCommand);
    assert.equal(recapPi.stored.at(-1).type, "user_request");
    assert.match(recapPi.stored.at(-1).content, /Call todo_recap.*read-only/s);
    for (const heading of ["## Status —", "### This session", "### Preserved understanding", "### Artifacts to know", "### Remaining"]) assert.ok(recapPi.stored.at(-1).content.includes(heading));
    assert.match(recapPi.stored.at(-1).content, /do not save, refresh, acknowledge, change progress or begin implementation/);
    const unattachedRecap = await instance();
    assert.equal((await unattachedRecap.call("todo_recap", {})).attached, false);
    await unattachedRecap.extension.commands.get("todo").handler("recap", unattachedRecap.ctx);
    assert.match(unattachedRecap.warnings.at(-1), /No TODO attached/);
    assert.deepEqual(unattachedRecap.stored, []);
    process.env.PI_TODO_PATH = continuationRoot;
  }

  // Saved activity starts only its owner and parent; reads, retries and terminal edits do not restart work.
  const activityRoot = join(scratch, "activity-todos");
  process.env.PI_TODO_PATH = activityRoot;
  const activity = await instance([], true);
  const createdRaw = await activity.callRaw("todo", { action: "create", type: "project", title: "Activity", outcome: "Track real work" });
  const activityProject = createdRaw.structuredContent;
  assert.deepEqual(JSON.parse(createdRaw.content[0].text), { saved: true, id: activityProject.todo.id, revision: 1 });
  assert.deepEqual(createdRaw.details, activityProject);
  const prerequisite = await activity.call("todo", { action: "create", type: "simple", parent: activityProject.todo.id, title: "Prerequisite", outcome: "Prepare delivery" });
  const activityChild = await activity.call("todo", { action: "create", type: "simple", parent: activityProject.todo.id, title: "Working child", outcome: "Save findings", depends_on: [prerequisite.todo.id] });
  await activity.call("todo", { action: "resume", selector: activityChild.todo.id });
  await activity.call("todo", { action: "get", selector: activityChild.todo.id });
  await activity.call("todo_ack", { id: activityChild.todo.id, reason: "no_change", explanation: "Only read context" });
  const empty = await activity.call("todo_checkpoint", { id: activityChild.todo.id, revision: 1, key: "empty", changes: {} });
  assert.equal(empty.todo.status, "todo");
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.revision, 1);
  const activityChanges = {
    current_state: { evidence: ["Research saved. Delivery still depends on preparation.", "Native report: preparation remains unverified"] },
    decisions: [{ summary: "Preserve exact owner IDs", rationale: "Avoid routing to an unrelated owner", approval: "draft", evidence: ["Discovery: ID spelling is significant"] }],
    questions: [{ text: "Does preparation cover the revised scope?" }],
  };
  const startedRaw = await activity.callRaw("todo_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  const started = startedRaw.structuredContent;
  assert.deepEqual(startedRaw.details, started);
  assert.deepEqual(started.todo, (await locate(activityRoot, activityChild.todo.id)).todo);
  const startedReceipt = JSON.parse(startedRaw.content[0].text);
  assert.deepEqual(startedReceipt, {
    saved: true, revision: 3, decision_ids: [started.todo.decisions[0].id], question_ids: [started.todo.open_questions[0].id], status: "in_progress",
    updated_parent: { id: activityProject.todo.id, revision: 2, status: "in_progress" }, dependency: started.dependency, affected_dependents: started.affected_dependents,
  });
  assert.ok(startedRaw.content[0].text.length < JSON.stringify(started).length / 2);
  const routineRaw = await activity.callRaw("todo_checkpoint", { id: prerequisite.todo.id, revision: 1, key: "routine-empty", changes: {} });
  assert.deepEqual(JSON.parse(routineRaw.content[0].text), { saved: true, revision: 2 });
  assert.equal(started.todo.status, "in_progress");
  assert.equal(started.dependency.dependencies_satisfied, false);
  assert.equal(started.dependency.review_required, false);
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.status, "in_progress");
  assert.equal((await locate(activityRoot, prerequisite.todo.id)).todo.status, "todo");
  const replayRaw = await activity.callRaw("todo_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  const replay = replayRaw.structuredContent;
  assert.deepEqual(replay.todo, started.todo);
  assert.deepEqual(replayRaw.details, replay);
  assert.deepEqual(JSON.parse(replayRaw.content[0].text), {
    saved: true, revision: startedReceipt.revision, decision_ids: startedReceipt.decision_ids, question_ids: startedReceipt.question_ids,
  });
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.revision, 2);
  await activity.emit("context", { messages: activity.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-drift-v1").length, 0);
  assert.match(activity.statuses.at(-1), /\[in_progress\]/);
  await assert.rejects(activity.call("todo_checkpoint", { id: activityChild.todo.id, revision: 3, key: "too-soon", changes: { status: "done" } }), /waiting on/);
  const activityPicker = await instance([], true);
  activityPicker.customSteps.push(component => component.handleInput("\r"), component => {
    const view = component.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(view, /Working child.*In progress/);
    assert.doesNotMatch(view, /Review required/);
    component.handleInput("\x1b");
  }, component => component.handleInput("\x1b"));
  await activityPicker.extension.commands.get("todo").handler("", activityPicker.ctx);

  // Artifact-first activity also starts its parent, including when the project overview is attached.
  await activity.call("todo_checkpoint", { id: activityProject.todo.id, revision: 2, key: "reset-project", changes: { status: "todo" } });
  await activity.call("todo", { action: "resume", selector: activityProject.todo.id });
  const artifactChild = await activity.call("todo", { action: "create", type: "simple", parent: activityProject.todo.id, title: "Artifact owner", outcome: "Write a plan" });
  const activityMetadata = { title: "Plan", kind: "design", description: "Draft plan", lifecycle: "current", required: false, applies_to: [], body: "# Draft plan" };
  const artifactRaw = await activity.callRaw("todo_artifact", { action: "upsert", id: artifactChild.todo.id, revision: 1, ...activityMetadata });
  const artifactStarted = artifactRaw.structuredContent;
  assert.deepEqual(artifactRaw.details, artifactStarted);
  assert.deepEqual(artifactStarted.todo, (await locate(activityRoot, artifactChild.todo.id)).todo);
  assert.deepEqual(JSON.parse(artifactRaw.content[0].text), {
    saved: true, revision: 2, artifact_id: artifactStarted.todo.artifacts[0].id, path: artifactStarted.todo.artifacts[0].path, status: "in_progress",
    updated_parent: { id: activityProject.todo.id, revision: 4, status: "in_progress" },
  });
  assert.ok(artifactRaw.content[0].text.length < JSON.stringify(artifactStarted).length / 2);
  const metadataOnly = await activity.callRaw("todo_artifact", { action: "upsert", id: artifactChild.todo.id, revision: 2, artifact_id: artifactStarted.todo.artifacts[0].id, ...activityMetadata, body: undefined });
  assert.equal(JSON.parse(metadataOnly.content[0].text).artifact_id, undefined);
  assert.equal(JSON.parse(metadataOnly.content[0].text).path, undefined);
  const artifactRead = await activity.callRaw("todo_artifact", { action: "read", id: artifactChild.todo.id, artifact_id: artifactStarted.todo.artifacts[0].id });
  assert.equal(artifactRead.structuredContent.body, "# Draft plan\n");
  assert.equal(artifactRead.structuredContent.complete, true);
  assert.ok(artifactRead.content[0].text.endsWith(artifactRead.structuredContent.body));
  assert.equal(artifactStarted.todo.status, "in_progress");
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.status, "in_progress");
  assert.match(activity.statuses.at(-1), /Activity \[in_progress\]/);
  await activity.emit("context", { messages: activity.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(activity.stored.filter(entry => entry.customType === "todo-context-drift-v1").length, 0);
  for (const status of ["done", "canceled"]) {
    const parent = await locate(activityRoot, activityProject.todo.id);
    const terminalParent = await activity.call("todo_checkpoint", { id: parent.todo.id, revision: parent.todo.revision, key: `parent-${status}`, changes: { status } });
    const child = await locate(activityRoot, artifactChild.todo.id);
    const terminalChild = await activity.call("todo_checkpoint", { id: child.todo.id, revision: child.todo.revision, key: `child-${status}`, changes: { status } });
    const noted = await activity.call("todo_checkpoint", { id: child.todo.id, revision: terminalChild.todo.revision, key: `note-${status}`, changes: { current_state: { evidence: ["Keep historical notes"] } } });
    const archived = await activity.call("todo_artifact", { action: "upsert", id: child.todo.id, revision: noted.todo.revision, ...activityMetadata, artifact_id: artifactStarted.todo.artifacts[0].id, body: `# ${status} notes` });
    assert.equal(archived.todo.status, status);
    assert.deepEqual((await locate(activityRoot, parent.todo.id)).todo, terminalParent.todo);
  }
  process.env.PI_TODO_PATH = root;

  // Flat title/goal discovery recalls a completed child, then explicitly loads its scoped context.
  const recallRoot = join(scratch, "recall-todos");
  const recallParent = await create(recallRoot, "project", "Operations", "Own care coordination");
  const recallChild = await create(recallRoot, "simple", "Referral routing", "Remember referral ownership", recallParent.todo.id);
  await checkpoint(recallRoot, recallChild.todo.id, 1, { status: "done", current_state: { evidence: ["Routing delivery verified"] } }, "recall-done", "test");
  const phraseProject = await create(recallRoot, "project", "Improve referral routing", "Own deployment");
  await create(recallRoot, "simple", "Telemetry", "Count events", phraseProject.todo.id);
  const goalOnly = await create(recallRoot, "simple", "Handoff", "Own referral routing");
  const goalTwin = await create(recallRoot, "simple", "Handoff", "Own referral routing safely");
  const titleTerms = await create(recallRoot, "simple", "Routing for referrals", "Coordinate care", undefined, undefined, [goalOnly.todo.id]);
  const recallLink = { url: "https://linear.app/example-team/issue/EX-456/routing", coverage: "partial" };
  await checkpoint(recallRoot, titleTerms.todo.id, 1, { linear: recallLink }, "recall-link", "test");
  const mixed = await create(recallRoot, "simple", "Referral intake", "Preserve routing exclusions");
  await checkpoint(recallRoot, mixed.todo.id, 1, { status: "canceled" }, "recall-canceled", "test");
  const recallRows = await list(recallRoot);
  const recallBytes = await Promise.all(recallRows.map(row => readFile(join(row.directory, "todo.json"), "utf8")));
  process.env.PI_TODO_PATH = recallRoot;
  const recall = await instance();
  const recallQuery = { action: "search", query: "REFERRAL--Routing!" };
  const found = await recall.call("todo", recallQuery);
  const goalIds = [goalOnly.todo.id, goalTwin.todo.id].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(found.map(row => row.id), [recallChild.todo.id, phraseProject.todo.id, titleTerms.todo.id, mixed.todo.id, ...goalIds]);
  assert.deepEqual(found.map(row => row.matched_in), ["both", "title", "title", "both", "goal", "goal"]);
  assert.deepEqual([found[0].parent_id, found[0].parent_title, found[0].outcome, found[0].status], [recallParent.todo.id, "Operations", "Remember referral ownership", "done"]);
  assert.ok(found.slice(1).every(row => row.parent_id === null && row.parent_title === null));
  assert.deepEqual(await recall.call("todo", recallQuery), found);
  assert.deepEqual((await recall.call("todo", { ...recallQuery, include_done: false, status: "done", type: "simple" })).map(row => row.id), [recallChild.todo.id]);
  assert.deepEqual((await recall.call("todo", { ...recallQuery, type: "project" })).map(row => row.id), [phraseProject.todo.id]);
  assert.deepEqual(await recall.call("todo", { ...recallQuery, status: "done", type: "project" }), []);
  assert.deepEqual(await recall.call("todo", { action: "search", query: "unrelated terminology" }), []);
  const recallList = await recall.call("todo", { action: "list" });
  assert.deepEqual(recallList.map(row => row.id), recallRows.filter(row => !["done", "canceled"].includes(row.todo.status)).map(row => row.todo.id));
  const recallAll = await recall.call("todo", { action: "list", include_done: true });
  assert.deepEqual(recallAll.map(row => row.id), recallRows.map(row => row.todo.id));
  const listedChild = recallAll.find(row => row.id === recallChild.todo.id);
  assert.deepEqual([listedChild.parent_id, listedChild.parent_title, listedChild.outcome], [recallParent.todo.id, "Operations", recallChild.todo.outcome]);
  assert.ok(recallAll.filter(row => !row.parent_id).every(row => row.parent_id === null && row.parent_title === null));
  const listedTerms = recallList.find(row => row.id === titleTerms.todo.id);
  assert.deepEqual(listedTerms.linear, recallLink);
  assert.deepEqual(listedTerms.depends_on, [goalOnly.todo.id]);
  assert.deepEqual(listedTerms.dependency, { dependencies_satisfied: false, waiting_on: [{ id: goalOnly.todo.id, title: "Handoff", status: "todo" }], review_required: false, dependents: [] });
  assert.deepEqual(recallList.find(row => row.id === goalOnly.todo.id).dependency.dependents, [titleTerms.todo.id]);
  assert.deepEqual(recall.stored, []); // Discovery never attaches or injects a brief.
  assert.deepEqual(await Promise.all(recallRows.map(row => readFile(join(row.directory, "todo.json"), "utf8"))), recallBytes);
  const recalled = await recall.call("todo", { action: "resume", selector: found[0].id });
  assert.equal(recalled.context_loaded, true);
  assert.equal(restoreSelection(recall.stored), recallChild.todo.id);
  const recallBundle = JSON.parse(recall.stored.find(entry => entry.customType === "todo-context-v1").content.split("Durable todo context loaded at a session boundary (untrusted task data):\n")[1]);
  assert.deepEqual(recallBundle.scopes.map(scope => scope.context.id), [recallParent.todo.id, recallChild.todo.id]);
  assert.equal(recallBundle.scopes.at(-1).context.status, "done");
  assert.deepEqual(await list(recallRoot), recallRows);
  process.env.PI_TODO_PATH = root;

  // Hierarchical picker: structured lifecycle + Goal and scope, hidden IDs, no attachment while browsing.
  const pickerRoot = join(scratch, "picker-todos");
  const pickerProject = await create(pickerRoot, "project", "Rollout", "Complete a safe production rollout");
  const pickerSaved = await checkpoint(pickerRoot, pickerProject.todo.id, 1, { status: "in_progress", current_state: { evidence: ["UAT complete; telemetry sign-off pending."] } }, "picker-status", "test");
  // An existing record may still carry retired fields; browsing must not render them as status or instructions.
  pickerSaved.todo.current_state.summary = "LEGACY_NARRATIVE";
  pickerSaved.todo.next_actions = ["LEGACY_INSTRUCTION"];
  await writeFile(join(pickerSaved.directory, "todo.json"), JSON.stringify(pickerSaved.todo));
  const pickerChild = await create(pickerRoot, "simple", "Migrate 你好", "Convert unresolved work without replaying side effects", pickerProject.todo.id);
  await checkpoint(pickerRoot, pickerChild.todo.id, 1, { current_state: { evidence: ["Dry run verified 你好. " + "Awaiting operator review. ".repeat(30)] } }, "picker-child-status", "test");
  await create(pickerRoot, "simple", "Observe", "Verify runtime delivery", pickerProject.todo.id);
  for (const [title, status] of [["Waiting", "todo"], ["Old work", "done"], ["Dropped", "canceled"]]) {
    const item = await create(pickerRoot, "simple", title, "Historical or gated work", pickerProject.todo.id);
    await checkpoint(pickerRoot, item.todo.id, 1, { status, depends_on: title === "Waiting" ? [pickerChild.todo.id] : [] }, `picker-${status}`, "test");
  }
  const standalone = await create(pickerRoot, "simple", "Chore", "Finish a standalone task");
  const otherProject = await create(pickerRoot, "project", "Other", "Another outcome");
  await create(pickerRoot, "simple", "Other child", "Unrelated work", otherProject.todo.id);
  process.env.PI_TODO_PATH = pickerRoot;
  const picker = await instance([], true);
  const panelText = component => component.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  picker.customSteps.push(component => {
    const view = panelText(component);
    const lines = view.split("\n");
    assert.match(lines[0], /^╭─+╮$/); assert.match(lines.at(-1), /^╰─+╯$/);
    assert.ok(lines.slice(1, -1).every(line => line.startsWith("│") && line.endsWith("│")));
    assert.match(lines[2], /^│  Your todos/);
    assert.doesNotMatch(view, /Projects & standalone|Project checklist/);
    assert.match(view, /▸ Rollout/); assert.match(view, /1\/5 done/);
    assert.match(view, /\[ \] Chore/); assert.match(view, /Complete a safe production rollout/);
    assert.match(view, /Lifecycle/); assert.match(view, /In progress/);
    assert.doesNotMatch(view, /Latest status|UAT complete; telemetry sign-off pending|LEGACY_NARRATIVE|LEGACY_INSTRUCTION/);
    assert.match(view, /Goal and scope/); assert.doesNotMatch(view, /Outcome/);
    assert.ok(view.indexOf("Lifecycle") < view.indexOf("Goal"));
    assert.doesNotMatch(view, /Migrate|Observe|Waiting|Old work|Other child|[a-f0-9]{8}-[a-f0-9-]{27}/);
    assert.equal(restoreSelection(picker.stored), undefined);
    component.handleInput("\r");
  }, (component, terminal) => {
    let view = panelText(component);
    assert.match(view, /Todos › Rollout/); assert.match(view, /\[!\] Waiting/);
    assert.match(view, /\[✓\] Old work/); assert.match(view, /\[-\] Dropped/);
    assert.doesNotMatch(view, /Chore|Other child|[a-f0-9]{8}-[a-f0-9-]{27}/);
    assert.equal(restoreSelection(picker.stored), undefined);
    assert.match(view, /In progress/); // Project overview shares structured lifecycle.
    component.handleInput("\x1b[B");
    view = panelText(component);
    assert.match(view, /Convert unresolved work without replaying side effects/);
    assert.match(view, /In progress/); assert.doesNotMatch(view, /Dry run verified 你好/);
    assert.doesNotMatch(view, /UAT complete/);
    terminal.rows = 24;
    assert.ok(component.render(40).length <= Math.floor(terminal.rows * 0.85));
    component.handleInput("\r");
  });
  await picker.extension.commands.get("todo").handler("", picker.ctx);
  assert.equal(restoreSelection(picker.stored), pickerChild.todo.id);
  const browse = await instance([], true);
  browse.customSteps.push(component => component.handleInput("\r"), component => {
    component.handleInput("\x1b[B"); component.handleInput("\x1b[B");
    assert.match(panelText(component), /Not started/);
    component.handleInput("\x1b[B");
    assert.match(panelText(component), /Waiting on: Migrate 你好/);
    component.handleInput("\x1b");
  }, component => component.handleInput("\x1b"));
  await browse.extension.commands.get("todo").handler("resume", browse.ctx);
  assert.equal(restoreSelection(browse.stored), undefined); assert.equal(browse.panels.length, 3);
  const overview = await instance([], true);
  overview.customSteps.push(component => component.handleInput("\r"), component => component.handleInput("\r"));
  await overview.extension.commands.get("todo").handler("", overview.ctx);
  assert.equal(restoreSelection(overview.stored), pickerProject.todo.id);
  const rpcPicker = await instance([], true); rpcPicker.ctx.mode = "rpc";
  rpcPicker.selects.push(0, 6, 1); // Open project, go back, select standalone todo.
  await rpcPicker.extension.commands.get("todo").handler("", rpcPicker.ctx);
  assert.equal(restoreSelection(rpcPicker.stored), standalone.todo.id);
  assert.ok(rpcPicker.panels[0].labels.every(label => !label.includes("Migrate") && !label.includes(pickerProject.todo.id)));
  await create(pickerRoot, "simple", "Chore", "A different standalone task with the same title");
  const duplicatePicker = await instance([], true); duplicatePicker.ctx.mode = "rpc";
  duplicatePicker.selects.push(2);
  await duplicatePicker.extension.commands.get("todo").handler("", duplicatePicker.ctx);
  const duplicateLabels = duplicatePicker.panels[0].labels;
  assert.equal(new Set(duplicateLabels).size, duplicateLabels.length);
  assert.equal(restoreSelection(duplicatePicker.stored), (await list(pickerRoot)).filter(row => row.todo.title === "Chore")[1].todo.id);
  const directPicker = await instance([], true);
  await directPicker.extension.commands.get("todo").handler(`resume ${pickerChild.todo.id}`, directPicker.ctx);
  assert.equal(restoreSelection(directPicker.stored), pickerChild.todo.id); assert.equal(directPicker.panels.length, 0);
  // Completed picker: load preserved project/child/standalone context without reopening or writing it.
  const completedRoot = join(scratch, "completed-todos");
  const activeRoot = await create(completedRoot, "simple", "Active work", "Keep active work separate");
  const doneProject = await create(completedRoot, "project", "Archived project", "Remember the delivery");
  const doneChild = await create(completedRoot, "simple", "Delivered child", "Remember implementation details", doneProject.todo.id);
  await checkpoint(completedRoot, doneChild.todo.id, 1, { status: "done", current_state: { evidence: ["Child delivery verified. Retain the investigation notes."] } }, "done-child", "test");
  await checkpoint(completedRoot, doneProject.todo.id, 2, { status: "done", current_state: { evidence: ["Project delivered. Preserved context is available for questions."] } }, "done-project", "test");
  const doneStandalone = await create(completedRoot, "simple", "Saved answer", "Recall an earlier answer");
  await checkpoint(completedRoot, doneStandalone.todo.id, 1, { status: "done", current_state: { evidence: ["Earlier answer verified and saved."] } }, "done-answer", "test");
  const completedBefore = await list(completedRoot);
  process.env.PI_TODO_PATH = completedRoot;
  const completedPicker = await instance([], true);
  completedPicker.customSteps.push(component => {
    const view = panelText(component);
    assert.match(view, /Active work/); assert.match(view, /▸ Completed/);
    assert.doesNotMatch(view, /Archived project|Saved answer/);
    const lines = view.split("\n"), footer = lines.findIndex(line => line.includes("▸ Completed"));
    assert.match(lines[footer - 1], /^│\s+│$/); // Separate section, not a selectable blank item.
    assert.ok(component.render(120).join("\n").includes(themeModule.theme.fg("error", "▸ Completed")));
    component.handleInput("\x1b[A"); component.handleInput("\r");
  }, component => {
    const view = panelText(component);
    assert.match(view, /Archived project/); assert.match(view, /Saved answer/);
    assert.doesNotMatch(view, /Active work/);
    assert.equal(restoreSelection(completedPicker.stored), undefined);
    component.handleInput("\r");
  }, component => {
    const view = panelText(component);
    assert.match(view, /Completed › Archived project/); assert.match(view, /Resume project overview/);
    assert.match(view, /\[✓\] Delivered child/); assert.match(view, /Done/); assert.doesNotMatch(view, /Project delivered/);
    component.handleInput("\r");
  });
  await completedPicker.extension.commands.get("todo").handler("", completedPicker.ctx);
  assert.equal(restoreSelection(completedPicker.stored), doneProject.todo.id);
  assert.match(completedPicker.stored.find(entry => entry.customType === "todo-context-v1").content, /Project delivered/);
  const completedChildPicker = await instance([], true); completedChildPicker.ctx.mode = "rpc";
  completedChildPicker.selects.push(1, 0, 1); // Completed → project → child.
  await completedChildPicker.extension.commands.get("todo").handler("", completedChildPicker.ctx);
  assert.equal(restoreSelection(completedChildPicker.stored), doneChild.todo.id);
  assert.match(completedChildPicker.stored.find(entry => entry.customType === "todo-context-v1").content, /Child delivery verified/);
  const completedBack = await instance([], true); completedBack.ctx.mode = "rpc";
  completedBack.selects.push(1, 0, 2, 2, 1, 1); // Back through both levels, then resume standalone.
  await completedBack.extension.commands.get("todo").handler("", completedBack.ctx);
  assert.equal(restoreSelection(completedBack.stored), doneStandalone.todo.id);
  assert.equal(completedBack.panels[2].labels.at(-1), "← Back to completed");
  assert.equal(completedBack.panels[3].labels.at(-1), "← Back to all todos");
  assert.deepEqual(await list(completedRoot), completedBefore);

  // Completed-only stores still open the picker; Escape returns to the previous level without attachment.
  await checkpoint(completedRoot, activeRoot.todo.id, 1, { status: "canceled" }, "hide-active", "test");
  const completedOnly = await instance([], true);
  completedOnly.customSteps.push((component, terminal) => {
    assert.match(panelText(component), /▸ Completed/);
    assert.doesNotMatch(panelText(component), /Active work/);
    terminal.rows = 24;
    assert.ok(component.render(40).length <= Math.floor(terminal.rows * 0.85));
    component.handleInput("\r");
  }, component => component.handleInput("\r"), component => component.handleInput("\x1b"), component => {
    assert.match(panelText(component), /Saved answer/); component.handleInput("\x1b");
  }, component => {
    assert.match(panelText(component), /Your todos/); component.handleInput("\x1b");
  });
  await completedOnly.extension.commands.get("todo").handler("", completedOnly.ctx);
  assert.equal(restoreSelection(completedOnly.stored), undefined);
  assert.equal(completedOnly.warnings.length, 0);
  process.env.PI_TODO_PATH = root;

  // Linear adapter via mock nested MCP calls: read-only refresh, partial coverage, confirmed whole-issue writes and drift.
  let issue = { url: "https://linear.app/example-team/issue/EX-123/example", uuid: "issue-uuid", teamId: "team", status: "In Review", statusType: "started", updatedAt: "one" };
  const linked = await pi.call("todo_checkpoint", { id: sibling.todo.id, revision: 1, key: "link", changes: { linear: { url: issue.url, coverage: "partial" } } });
  const calls = [];
  const linearCtx = { ...pi.ctx, tools: ["get_issue", "list_issue_statuses", "save_issue"].map(name => ({ name: `mcp__linear__${name}` })), executeTool: async (name, args) => {
    calls.push({ name, args });
    let data;
    if (name.endsWith("get_issue")) data = issue;
    if (name.endsWith("list_issue_statuses")) data = [{ id: "done-state", name: "Done" }];
    if (name.endsWith("save_issue")) { issue = { ...issue, status: "Done", statusType: "completed", updatedAt: "two" }; data = issue; }
    return { isError: false, result: { content: [{ type: "text", text: JSON.stringify(data) }] } };
  } };
  const refreshed = await pi.call("todo_linear", { id: sibling.todo.id, revision: linked.todo.revision }, linearCtx);
  assert.equal(refreshed.todo.status, linked.todo.status); assert.equal(refreshed.todo.linear.status, "In Review");
  await assert.rejects(pi.call("todo_linear", { id: sibling.todo.id, revision: refreshed.todo.revision, target_status: "Done" }, linearCtx), /Partial/);
  assert.ok(!calls.some(call => call.name.endsWith("save_issue")));
  const whole = await pi.call("todo_checkpoint", { id: sibling.todo.id, revision: refreshed.todo.revision, key: "whole", changes: { linear: { url: issue.url, coverage: "whole" } } });
  pi.confirmations.push(true);
  const written = await pi.call("todo_linear", { id: sibling.todo.id, revision: whole.todo.revision, target_status: "Done" }, linearCtx);
  assert.equal(written.todo.linear.status, "Done"); assert.equal(written.todo.status, whole.todo.status);
  assert.equal(calls.find(call => call.name.endsWith("save_issue")).args.state, "done-state");
  const driftCtx = { ...linearCtx, ui: { ...pi.ctx.ui, confirm: async () => { issue.updatedAt = "external-change"; return true; } } };
  await assert.rejects(pi.call("todo_linear", { id: sibling.todo.id, revision: written.todo.revision, target_status: "Done" }, driftCtx), /changed during confirmation/);

  // Compaction focus, split-turn preservation, successful/failed boundaries and nonforcing restored reconciliation.
  const preparation = (split = false) => ({ firstKeptEntryId: "retained", messagesToSummarize: [{ role: "user", content: "Evidence discovered" }], turnPrefixMessages: split ? [{ role: "user", content: "Work in progress" }] : [], isSplitTurn: split });
  for (const reason of ["manual", "threshold", "overflow"]) {
    const compacting = await instance();
    await compacting.call("todo", { action: "resume", selector: sibling.todo.id });
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
    await reopened.call("todo_ack", { id: sibling.todo.id, reason: "no_change", explanation: "Summary has no unsaved facts" });
    assert.equal(pendingReconciliation(reopened.stored, sibling.todo.id), undefined);
    const acknowledgedPreparation = preparation();
    await reopened.emit("session_before_compact", { preparation: acknowledgedPreparation, reason, signal: new AbortController().signal });
    assert.match(acknowledgedPreparation.messagesToSummarize.at(-1).content[0].text, /pending.*false/);
    await reopened.emit("session_compact", { reason });
    const [acknowledgedContext] = await reopened.emit("context", { messages: [] });
    assert.doesNotMatch(acknowledgedContext.messages.at(-1).content, /Compaction reconciliation pending/);
  }
  const failingCompaction = await instance();
  await failingCompaction.call("todo", { action: "resume", selector: sibling.todo.id });
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
  await checkpointSession.call("todo", { action: "resume", selector: reconciliationTodo.todo.id });
  await checkpointSession.emit("session_before_compact", { preparation: preparation(), reason: "manual", signal: new AbortController().signal });
  await checkpointSession.emit("session_compact", { reason: "manual" });
  await checkpointSession.call("todo_checkpoint", { id: reconciliationTodo.todo.id, revision: 1, key: "post-compaction", changes: {} });
  assert.equal(pendingReconciliation(checkpointSession.stored, reconciliationTodo.todo.id), undefined);
  const checkpointReopened = await instance(checkpointSession.stored);
  assert.doesNotMatch((await checkpointReopened.emit("context", { messages: [] }))[0].messages.at(-1).content, /Compaction reconciliation pending/);

  // Large model-relative context warns once per load/window, without blocking repairs.
  const smallModel = await instance();
  await smallModel.call("todo", { action: "resume", selector: sibling.todo.id });
  smallModel.ctx.model = { contextWindow: 1000 };
  const [smallContext] = await smallModel.emit("context", { messages: [] });
  assert.equal(smallModel.ctx.aborted, undefined);
  assert.ok(smallContext.messages.some(message => message.customType === "todo-context-v1"));
  assert.equal(smallModel.warnings.filter(text => text.includes("10%")).length, 1);
  assert.match(smallContext.messages.at(-1).content, /size warning.*nonblocking/);
  const [repeatSmall] = await smallModel.emit("context", { messages: smallContext.messages });
  assert.equal(repeatSmall.messages.filter(message => message.customType === "todo-context-size-warning-v1").length, 1);
  assert.equal(smallModel.warnings.filter(text => text.includes("10%")).length, 1);
  smallModel.ctx.model = { contextWindow: 2000 };
  await smallModel.emit("context", { messages: smallContext.messages });
  assert.equal(smallModel.warnings.filter(text => text.includes("10%")).length, 2);
  smallModel.ctx.model = { contextWindow: 1000000 };
  const [noSizeWarning] = await smallModel.emit("context", { messages: repeatSmall.messages });
  assert.equal(noSizeWarning.messages.filter(message => message.customType === "todo-context-size-warning-v1").length, 2); // Delivered warnings remain at their original positions.

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
  await proactive.call("todo", { action: "resume", selector: proactiveTodo.todo.id });
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
  await assert.rejects(proactive.call("todo_checkpoint", { id: proactiveTodo.todo.id, revision: 99, key: "stale-pass", changes: {} }), /Stale revision/);
  await proactive.call("todo_checkpoint", { id: reconciliationTodo.todo.id, revision: 2, key: "other-owner", changes: {} });
  await proactive.call("todo_artifact", { action: "upsert", id: proactiveTodo.todo.id, revision: 1, title: "Understanding", kind: "research", description: "Relevant findings", lifecycle: "current", required: false, applies_to: [], body: "# Findings" });
  await proactive.call("todo_tighten", { id: proactiveTodo.todo.id, revision: 2, reason: "Verified consolidation" });
  assert.equal(preservationState(proactive.stored, proactiveTodo.todo.id).outcome, undefined);
  const pendingReopened = await instance(proactive.stored);
  pendingReopened.ctx.model = proactive.ctx.model;
  pendingReopened.ctx.getContextUsage = proactive.ctx.getContextUsage;
  const [replayed] = await pendingReopened.emit("context", { messages: stable.messages });
  assert.equal(replayed.messages.filter(message => message.customType === preservationType).length, 1);
  assert.equal((await pendingReopened.emit("turn_end", turn))[0], undefined);
  await pendingReopened.call("todo", { action: "refresh" });
  const [refreshedPass] = await pendingReopened.emit("context", { messages: replayed.messages });
  assert.equal(refreshedPass.messages.filter(message => message.customType === preservationType).length, 1);
  assert.equal((await pendingReopened.emit("turn_end", turn))[0], undefined);
  await pendingReopened.call("todo_ack", { id: proactiveTodo.todo.id, reason: "needs_approval", explanation: "May we change direction?" });
  assert.equal(preservationState(pendingReopened.stored, proactiveTodo.todo.id).outcome, "needs_approval");
  assert((await locate(root, proactiveTodo.todo.id)).todo.open_questions.some(question => question.text.includes("May we change direction?")));
  await pendingReopened.call("todo", { action: "refresh" });
  assert.equal((await pendingReopened.emit("context", { messages: refreshedPass.messages }))[0].messages.filter(message => message.customType === preservationType).length, 0);
  pendingReopened.stored.push({ type: "compaction", id: "native-cycle-2" });
  const [secondPass] = await pendingReopened.emit("turn_end", turn);
  pendingReopened.stored.push(...secondPass.entries);
  await pendingReopened.call("todo_ack", { id: proactiveTodo.todo.id, reason: "no_change", explanation: "Saved understanding is current" });
  assert.equal(preservationState(pendingReopened.stored, proactiveTodo.todo.id).outcome, "no_change");
  await pendingReopened.call("todo", { action: "leave" });
  assert.equal((await pendingReopened.emit("context", { messages: refreshedPass.messages }))[0].messages.filter(message => message.customType === preservationType).length, 0);

  // Switching removes pending instructions, without resetting the owner/cycle deduplication.
  pendingReopened.stored.push({ type: "compaction", id: "native-cycle-3" });
  await pendingReopened.call("todo", { action: "resume", selector: proactiveTodo.todo.id });
  const [thirdPass] = await pendingReopened.emit("turn_end", turn);
  pendingReopened.stored.push(...thirdPass.entries);
  pendingReopened.ctx.hasUI = true;
  pendingReopened.confirmations.push(true); // Explicitly switch without another checkpoint.
  await pendingReopened.call("todo", { action: "resume", selector: sibling.todo.id });
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
        else if (phase === "preserve" && providerTurns === 2) { content = [{ type: "toolCall", id: "sdk-checkpoint", name: "codemode", arguments: { code: `text(await tools.todo_checkpoint(${JSON.stringify({ id: sdkTodo.todo.id, revision: 1, key: "sdk-pass", changes: { current_state: { evidence: ["Synthetic provider exercised the real checkpoint; no live-model compliance claim."] } } })}));` } }]; input = 82000; }
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
    assert.match((await locate(root, sdkTodo.todo.id)).todo.current_state.evidence[0], /real checkpoint/);
    assert.equal(preservationState(sdkManager.getBranch(), sdkTodo.todo.id).outcome, "checkpoint");
    assert(sdkManager.getBranch().some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.nestedCalls?.calls.some(call => call.name === "todo_checkpoint")), "checkpoint ran through real nested codemode execution");
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
  await auto.call("todo", { action: "resume", selector: autonomousTodo.todo.id });
  const autoChanges = { outcome: "User-approved outcome", approval_evidence: "User: use the revised outcome", decisions: [{ summary: "Keep history readable", rationale: "Preserve evidence", approval: "approved", evidence: [] }], questions: [{ text: "Exact owner ID is not yet verified" }, { text: "Was the old scope approved?", resolution: "No; user approved only the revised outcome" }] };
  const autoSaved = await auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges });
  assert.ok(autoSaved.todo.decisions[0].evidence.includes("User approval: User: use the revised outcome"));
  assert.ok(autoSaved.todo.current_state.evidence.includes("User approval: User: use the revised outcome"));
  const approvalReplay = await auto.callRaw("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges });
  assert.deepEqual(approvalReplay.structuredContent.todo, autoSaved.todo);
  assert.deepEqual(approvalReplay.details, approvalReplay.structuredContent);
  assert.deepEqual(JSON.parse(approvalReplay.content[0].text), {
    saved: true, revision: autoSaved.todo.revision, decision_ids: autoSaved.todo.decisions.map(row => row.id), question_ids: autoSaved.todo.open_questions.map(row => row.id),
  });
  assert.deepEqual((await locate(root, autonomousTodo.todo.id)).todo, autoSaved.todo);
  await assert.rejects(auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 2, key: "no-approval", changes: { outcome: "Unapproved outcome" } }), /sign-off/);

  // Tightening changes durable orientation without rewriting the current conversation.
  const optional = await auto.call("todo_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: 2, title: "Old implementation detail", kind: "research", description: "No longer needed to orient", lifecycle: "current", required: false, applies_to: [], body: "HISTORICAL_DETAIL" });
  const hide = { id: autonomousTodo.todo.id, revision: 3, reason: "Verified progress makes earlier detail redundant; active outcome retained", consult_on_demand_decisions: [autoSaved.todo.decisions[0].id], consult_on_demand_artifacts: [optional.todo.artifacts[0].id], current_state: { evidence: ["Verified progress"] }, references: [] };
  const tightened = await auto.call("todo_tighten", hide);
  assert.equal(tightened.revision, 4);
  assert.equal(tightened.todo, undefined); assert.equal(tightened.context_refreshed, false);
  const history = await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id });
  assert.equal(history.todo.decisions.length, 1);
  const changedHiddenDecision = applyChanges(history.todo, { decisions: [{ ...history.todo.decisions[0], summary: "Updated active rule" }] });
  assert.deepEqual(changedHiddenDecision.context_policy.consult_on_demand_decisions, []);
  assert.equal(history.todo.context_policy.consult_on_demand_decisions.length, 1); // Input remains immutable.
  assert.equal(history.todo.outcome, "User-approved outcome");
  assert.deepEqual(history.todo.artifacts, optional.todo.artifacts);
  assert.deepEqual(await readdir(join(history.directory, "artifacts")), [optional.todo.artifacts[0].path.split("/").at(-1)]);
  assert.match((await auto.call("todo_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: optional.todo.artifacts[0].id })).body, /HISTORICAL_DETAIL/);
  const bytesBeforeActive = await readFile(join(history.directory, "todo.json"), "utf8");
  const activeView = await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.equal(activeView.todo.decisions.length, 0);
  assert.equal(activeView.todo.artifacts.length, 0);
  assert.deepEqual(activeView.todo.open_questions, history.todo.open_questions.filter(q => !q.resolution));
  assert.deepEqual(activeView.todo.current_state, history.todo.current_state);
  assert.equal("next_actions" in activeView.todo, false);
  assert.deepEqual(activeView.dependency, history.dependency);
  assert.equal(activeView.todo.context_policy, undefined);
  assert.equal(activeView.todo.last_checkpoint, undefined);
  assert.deepEqual(await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id, view: "full" }), history);
  assert.equal(await readFile(join(history.directory, "todo.json"), "utf8"), bytesBeforeActive);
  const hiddenBundle = await resumeBundle(root, autonomousTodo.todo.id);
  assert.deepEqual(activeView.todo, hiddenBundle.scopes[0].context);
  assert.equal(hiddenBundle.scopes[0].context.decisions.length, 0); assert.equal(hiddenBundle.scopes[0].context.artifacts.length, 0);
  const [tightenedContext] = await auto.emit("context", { messages: auto.stored.filter(m => m.type === "custom_message") });
  assert.equal(tightenedContext.messages.filter(m => m.customType === "todo-context-v1").length, 1);
  assert.equal(auto.stored.filter(m => m.customType === "todo-context-v1").length, 1);
  assert.match(tightenedContext.messages.find(m => m.customType === "todo-context-v1").content, /Original outcome/);
  await auto.call("todo", { action: "refresh" });
  const [resetTightenedContext] = await auto.emit("context", { messages: tightenedContext.messages });
  assert.doesNotMatch(resetTightenedContext.messages.find(m => m.customType === "todo-context-v1").content, /Keep history readable/);
  await assert.rejects(auto.call("todo_tighten", hide), /Stale/);
  await assert.rejects(auto.call("todo_tighten", { ...hide, revision: 4, consult_on_demand_decisions: [project.todo.id] }), /existing record IDs/);
  const restored = await auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: 4, reason: "Earlier decision is relevant again", restore_decisions: [autoSaved.todo.decisions[0].id], restore_artifacts: [optional.todo.artifacts[0].id] });
  assert.equal(restored.revision, 5);
  const restoredActive = await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.deepEqual(restoredActive.todo.decisions, autoSaved.todo.decisions); // Rationale, evidence and approval retained verbatim.
  assert.deepEqual(restoredActive.todo.artifacts, optional.todo.artifacts);
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).scopes[0].context.decisions.length, 1);
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).scopes[0].context.artifacts.length, 1);
  const required = await auto.call("todo_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: 5, title: "Active constraints", kind: "design", description: "Required safety boundary", lifecycle: "current", required: true, applies_to: [], body: "Required constraints" });
  await assert.rejects(auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: 6, reason: "Cannot hide required context", consult_on_demand_decisions: [], consult_on_demand_artifacts: [required.todo.artifacts.at(-1).id] }), /Required artifacts/);
  assert.equal((await locate(root, autonomousTodo.todo.id)).todo.revision, 6);
  const requiredRow = required.todo.artifacts.at(-1);
  const requiredPath = join(required.directory, requiredRow.path);
  await rm(requiredPath);
  const savedWithoutRefresh = await auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: 6, reason: "Restore visibility", consult_on_demand_decisions: [], consult_on_demand_artifacts: [] });
  assert.equal(savedWithoutRefresh.revision, 7);
  assert.equal(savedWithoutRefresh.context_refreshed, false); // Tightening does not reread artifact bodies.
  await assert.rejects(auto.call("todo", { action: "refresh" }), /ENOENT/);
  assert.equal((await locate(root, autonomousTodo.todo.id)).todo.revision, 7);
  await writeFile(requiredPath, "Required constraints\n");
  const hiddenArtifact = await auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: 7, reason: "Old artifact is historical", consult_on_demand_decisions: [], consult_on_demand_artifacts: [optional.todo.artifacts[0].id] });
  // Required artifacts load as an index (title, description, size), not bodies; retiring demotes them to readable reference.
  const requiredIndex = (await resumeBundle(root, autonomousTodo.todo.id)).required_artifacts;
  assert.deepEqual(requiredIndex.map(({ artifact_id, chars, body }) => ({ artifact_id, chars, body })), [{ artifact_id: requiredRow.id, chars: "Required constraints\n".length, body: undefined }]);
  await assert.rejects(auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: hiddenArtifact.revision, reason: "Bad ID", consult_on_demand_decisions: [], consult_on_demand_artifacts: [optional.todo.artifacts[0].id], retire_artifacts: [project.todo.id] }), /existing artifact IDs/);
  const retired = await auto.call("todo_tighten", { id: autonomousTodo.todo.id, revision: hiddenArtifact.revision, reason: "Slice merged", consult_on_demand_decisions: [], consult_on_demand_artifacts: [], retire_artifacts: [requiredRow.id] });
  const retiredRow = (await locate(root, autonomousTodo.todo.id)).todo.artifacts.find(a => a.id === requiredRow.id);
  assert.deepEqual([retiredRow.required, retiredRow.lifecycle], [false, "reference"]);
  assert.deepEqual(retired.context_policy.consult_on_demand_artifacts, [optional.todo.artifacts[0].id]); // Empty hide lists keep earlier hidden items hidden.
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).required_artifacts.length, 0);
  assert.match((await auto.call("todo_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: requiredRow.id })).body, /Required constraints/);
  const activeAgain = await auto.call("todo_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: retired.revision, artifact_id: optional.todo.artifacts[0].id, title: "Updated current detail", kind: "research", description: "Now relevant", lifecycle: "current", required: false, applies_to: [], body: "Updated detail" });
  assert.deepEqual(activeAgain.todo.context_policy.consult_on_demand_artifacts, []);
  const superseding = await auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: activeAgain.todo.revision, key: "replace-rule", changes: {
    approval_evidence: "User: replace the earlier rule with a scoped draft for investigation",
    decisions: [{ summary: "Investigate scoped_owner_id, not global_owner_id", rationale: "Global ownership may misroute; scope is still unverified", approval: "draft", evidence: ["Research synthesis: scoped ownership remains uncertain"], supersedes: autoSaved.todo.decisions[0].id }],
  } });
  const supersedingActive = await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id, view: "active" });
  assert.deepEqual(supersedingActive.todo.decisions, [superseding.todo.decisions.at(-1)]);
  assert.equal((await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id })).todo.decisions.length, 2);
  await auto.extension.commands.get("todo").handler("tighten", auto.ctx);
  assert.equal(auto.stored.at(-1).type, "user_request");

  // Boundary loads are retained once: no artifact rereads or full refreshes on ordinary/local-update requests.
  const boundaryTodo = await create(root, "simple", "Boundary efficiency", "Read once and preserve foreground updates");
  const boundaryArtifact = await saveArtifact(root, boundaryTodo.todo.id, 1, { title: "Required brief", kind: "design", description: "Read-once reference", lifecycle: "current", required: true, applies_to: [], body: "READ_ONCE_REQUIRED_BODY" });
  const boundarySession = await instance();
  await boundarySession.call("todo", { action: "resume", selector: boundaryTodo.todo.id });
  const noteMessages = () => boundarySession.stored.filter(entry => entry.customType === "todo-context-v1");
  const [firstBoundaryContext] = await boundarySession.emit("context", { messages: noteMessages() });
  assert.equal(noteMessages().length, 1);
  const requiredFile = join(boundaryArtifact.directory, boundaryArtifact.todo.artifacts[0].path);
  await rm(requiredFile);
  const [readOnce] = await boundarySession.emit("context", { messages: firstBoundaryContext.messages });
  assert.equal(boundarySession.ctx.aborted, undefined); assert.equal(noteMessages().length, 1);
  assert.match(readOnce.messages[0].content, /"title":"Required brief","kind":"design","description":"Read-once reference","chars":24/); assert.doesNotMatch(readOnce.messages[0].content, /READ_ONCE_REQUIRED_BODY/);
  await assert.rejects(boundarySession.call("todo", { action: "refresh" }), /ENOENT/);
  await writeFile(requiredFile, "READ_ONCE_REQUIRED_BODY\n");
  await boundarySession.extension.commands.get("todo").handler("refresh", boundarySession.ctx);
  const [refreshedBoundary] = await boundarySession.emit("context", { messages: boundarySession.stored.filter(entry => entry.type === "custom_message") });
  assert.equal(noteMessages().length, 2);
  assert.equal(refreshedBoundary.messages.filter(message => message.customType === "todo-context-v1").length, 1);
  const external = await checkpoint(root, boundaryTodo.todo.id, 2, { current_state: { evidence: ["External finding"] } }, "external-write", "other-session");
  const [drift] = await boundarySession.emit("context", { messages: refreshedBoundary.messages });
  assert.match(drift.messages.at(-1).content, /changed outside this session/);
  assert.equal(noteMessages().length, 2);
  const driftCount = () => boundarySession.stored.filter(entry => entry.customType === "todo-context-drift-v1").length;
  await boundarySession.emit("context", { messages: drift.messages }); assert.equal(driftCount(), 1);
  await boundarySession.call("todo", { action: "get", selector: boundaryTodo.todo.id, view: "active" });
  const own = await boundarySession.call("todo_checkpoint", { id: boundaryTodo.todo.id, revision: external.todo.revision, key: "own-write", changes: { current_state: { evidence: ["Verify the finding"] } } });
  assert.equal(own.todo.revision, 4);
  const [ownContext] = await boundarySession.emit("context", { messages: drift.messages });
  assert.ok(ownContext.messages.some(message => message.customType === "todo-context-drift-v1")); // Reading/acknowledging does not erase delivered input.
  assert.equal(noteMessages().length, 2);
  await boundarySession.emit("before_agent_start");
  await boundarySession.call("todo_ack", { id: boundaryTodo.todo.id, reason: "no_change", explanation: "Read only so far" });
  await boundarySession.emit("tool_execution_end", { toolName: "write", args: {}, isError: false });
  assert.deepEqual(await boundarySession.emit("agent_before_settle", boundary), []);
  assert.ok(!boundarySession.stored.some(entry => entry.customType === checkpointMessage));
  await boundarySession.call("todo_ack", { id: boundaryTodo.todo.id, reason: "no_change", explanation: "Output did not change durable knowledge" });
  await boundarySession.call("todo", { action: "leave" });
  const [detachedContext] = await boundarySession.emit("context", { messages: ownContext.messages });
  assert.ok(!detachedContext.messages.some(message => message.customType === "todo-context-v1"));
  assert.match(detachedContext.messages.at(-1).content, /No active todo/);

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
  await cached.call("todo", { action: "resume", selector: cacheTodo.todo.id });
  const [firstCache] = await cached.emit("context", { messages: historyMessages(cached) });
  const firstPayload = await providerPayload(firstCache.messages);
  assert.equal(cached.stored.filter(entry => entry.type === "custom_message").length, 0); // Still queued.
  respond(cached, 1); cached.flush();
  const [secondCache] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.deepEqual((await providerPayload(secondCache.messages)).content.slice(0, firstPayload.content.length), firstPayload.content);
  assert.deepEqual(thinking(secondCache.messages), ["signature-1"]);
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-size-warning-v1").length, 1);
  const externalCache = await checkpoint(root, cacheTodo.todo.id, 1, { current_state: { evidence: ["External finding"] } }, "cache-external", "other-session");
  const [withDrift] = await cached.emit("context", { messages: historyMessages(cached) });
  const driftPayload = await providerPayload(withDrift.messages);
  respond(cached, 2); cached.flush();
  await cached.call("todo", { action: "get", selector: cacheTodo.todo.id, view: "active" });
  await cached.call("todo_checkpoint", { id: cacheTodo.todo.id, revision: externalCache.todo.revision, key: "cache-local", changes: { current_state: { evidence: ["Verify external finding"] } } });
  const [acknowledgedDrift] = await cached.emit("context", { messages: historyMessages(cached) });
  assert.deepEqual((await providerPayload(acknowledgedDrift.messages)).content.slice(0, driftPayload.content.length), driftPayload.content);
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);
  await cached.extension.commands.get("todo").handler("status in_progress", cached.ctx); cached.flush();
  assert.equal(cached.stored.filter(entry => entry.customType === "todo-context-v1").length, 1);

  // Both real extensions: task snapshots are persisted at run boundaries, never a moving context tail.
  const jointTodo = await create(root, "simple", "Cross-extension cache", "Keep task and todo context stable together");
  const joint = await instance([], true, true, true);
  joint.ctx.model = cached.ctx.model;
  joint.stored.push({ type: "message", message: { role: "user", content: "Start combined session", timestamp: 1000 } });
  await joint.call("task", { action: "create", subject: "Investigate", description: "Keep context stable" });
  await joint.call("todo", { action: "resume", selector: jointTodo.todo.id });
  await joint.emit("before_agent_start");
  const [jointFirst] = await joint.emit("context", { messages: historyMessages(joint) });
  const jointFirstPayload = await providerPayload(jointFirst.messages);
  respond(joint, 10); joint.flush();
  const [jointNext] = await joint.emit("context", { messages: historyMessages(joint) });
  assert.deepEqual((await providerPayload(jointNext.messages)).content.slice(0, jointFirstPayload.content.length), jointFirstPayload.content);
  assert.equal(joint.stored.filter(entry => entry.customType === "task-context-v1").length, 1);
  await checkpoint(root, jointTodo.todo.id, 1, { current_state: { evidence: ["External finding"] } }, "joint-external", "other-session");
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

  // Legacy transient anchors are replaced by one persisted epoch, not guessed or retried indefinitely.
  for (const version of [undefined, 2]) {
    const broken = JSON.parse(JSON.stringify(joint.stored));
    broken.find(entry => entry.customType === "todo-context-v1").details.anchor_version = version;
    broken.findLast(entry => entry.customType === "todo-context-anchor-v1").data.after = JSON.stringify(["user", 424242, null, null]);
    const repairedSession = await instance(broken, true, true);
    repairedSession.ctx.model = joint.ctx.model;
    const [repairedContext] = await repairedSession.emit("context", { messages: historyMessages(repairedSession) });
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
  await cached.call("todo", { action: "refresh" });
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
  await cacheReopened.call("todo_ack", { id: cacheTodo.todo.id, reason: "no_change", explanation: "Read only" });
  await cacheReopened.call("todo", { action: "leave" });
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
  await approvalSession.call("todo", { action: "resume", selector: chore.todo.id });
  await approvalSession.call("todo_ack", { id: chore.todo.id, reason: "needs_approval", explanation: "Should this include a production rollout?" });
  assert.match((await resumeBundle(root, chore.todo.id)).scopes[0].context.open_questions[0].text, /Awaiting approval/);
  assert.equal((await locate(root, chore.todo.id)).todo.outcome, "Finish chore");

  // Durable prerequisites: graph invariants, guarded writes, transitive effects, and no cascading status writes.
  const dependencyRoot = join(scratch, "dependency-todos");
  const depProject = await create(dependencyRoot, "project", "Dependencies", "Verify prerequisites");
  const a = await create(dependencyRoot, "simple", "Authorize", "Obtain authorization", depProject.todo.id);
  const b = await create(dependencyRoot, "simple", "Deploy", "Deploy safely", depProject.todo.id, undefined, [a.todo.id]);
  const c = await create(dependencyRoot, "simple", "Retire", "Retire old paths", depProject.todo.id, undefined, [b.todo.id]);
  const foreign = await create(dependencyRoot, "simple", "Standalone", "Other scope");
  assert.equal(b.dependency.dependencies_satisfied, false);
  assert.deepEqual(c.dependency.waiting_on.map(row => row.title).sort(), ["Authorize", "Deploy"]);
  const set = (item, changes, key) => checkpoint(dependencyRoot, item.todo.id, item.todo.revision, changes, key, "test-session");
  await assert.rejects(set(a, { depends_on: [a.todo.id] }, "self"), /itself/);
  await assert.rejects(set(a, { depends_on: [b.todo.id] }, "cycle"), /cycle/);
  await assert.rejects(set(b, { depends_on: [a.todo.id, a.todo.id] }, "duplicate"), /Duplicate/);
  await assert.rejects(set(b, { depends_on: [createTodo("simple", "Missing", "No").id] }, "missing"), /does not exist/);
  await assert.rejects(set(b, { depends_on: [foreign.todo.id] }, "scope"), /same scope/);
  await assert.rejects(set(b, { depends_on: [depProject.todo.id] }, "project-target"), /simple peers/);
  const standalonePeer = await create(dependencyRoot, "simple", "Standalone peer", "Same root scope", undefined, undefined, [foreign.todo.id]);
  assert.equal(standalonePeer.dependency.dependencies_satisfied, false);
  await assert.rejects(set(depProject, { depends_on: [a.todo.id] }, "project-owner"), /Only simple/);
  await assert.rejects(create(dependencyRoot, "simple", "Invalid create", "No", undefined, undefined, [a.todo.id]), /same scope/);
  await assert.rejects(set(c, { status: "done" }, "blocked-complete"), /waiting on/);
  await assert.rejects(mutate(dependencyRoot, b.todo.id, 1, todo => ({ ...todo, status: "done" })), /waiting on/);
  await assert.rejects(set(b, { blockers: ["Not supported"] }, "legacy-write"), /unknown/);
  assert.equal((await locate(dependencyRoot, b.todo.id)).todo.revision, 1);

  process.env.PI_TODO_PATH = dependencyRoot;
  const depsSession = await instance([], true);
  await depsSession.call("todo", { action: "resume", selector: c.todo.id });
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
  const cDoneRaw = await depsSession.callRaw("todo_checkpoint", { id: c.todo.id, revision: 1, key: "c-done", changes: { status: "done" } });
  const cDone = cDoneRaw.structuredContent;
  assert.deepEqual(JSON.parse(cDoneRaw.content[0].text).dependency, cDone.dependency);
  assert.equal(JSON.parse(cDoneRaw.content[0].text).status, "done");
  assert.equal(cDone.dependency.dependencies_satisfied, true);
  const bFile = await readFile(join(b.directory, "todo.json"), "utf8");
  const cFile = await readFile(join(c.directory, "todo.json"), "utf8");
  const aReopened = await set(aDone, { status: "todo" }, "reopen");
  assert.ok(aReopened.affected_dependents.every(row => row.status === "done" && row.review_required));
  assert.equal(await readFile(join(b.directory, "todo.json"), "utf8"), bFile);
  assert.equal(await readFile(join(c.directory, "todo.json"), "utf8"), cFile);
  await depsSession.emit("context", { messages: depsLoads() });
  assert.match(depsSession.stored.findLast(entry => entry.customType === "todo-context-drift-v1").content, /"review_required":true/);
  await assert.rejects(set(cDone, { status: "done" }, "reassert"), /waiting on/);
  const note = await set(cDone, { current_state: { evidence: ["Review reopened prerequisite"] } }, "note");
  const aCanceled = await set(aReopened, { status: "canceled" }, "cancel");
  assert.ok(aCanceled.affected_dependents.every(row => !row.dependencies_satisfied && row.review_required));
  const bCanceled = await set(bDone, { status: "canceled" }, "cancel-dependent");
  assert.equal(bCanceled.affected_dependents[0].waiting_on.find(row => row.id === b.todo.id).status, "canceled");
  const revisedDependencies = await set(note, { status: "todo", depends_on: [] }, "revise");
  assert.equal(revisedDependencies.dependency.dependencies_satisfied, true);
  await assert.rejects(set(note, { depends_on: [] }, "stale"), /Stale/);
  const listedDeps = await depsSession.call("todo", { action: "list", include_done: true });
  assert.ok(listedDeps.every(row => Array.isArray(row.depends_on) && row.dependency));
  const programmatic = await depsSession.call("todo", { action: "create", type: "simple", parent: depProject.todo.id, title: "Follow-up", outcome: "Check runtime", depends_on: [b.todo.id] });
  assert.equal(programmatic.dependency.review_required, true);
  const inspected = await depsSession.call("todo", { action: "get", selector: programmatic.todo.id });
  assert.equal(inspected.dependency.waiting_on.find(row => row.id === b.todo.id).status, "canceled");
  const commandSession = await instance([], true);
  await commandSession.call("todo", { action: "resume", selector: programmatic.todo.id });
  await commandSession.extension.commands.get("todo").handler("status in_progress", commandSession.ctx);
  assert.equal((await locate(dependencyRoot, programmatic.todo.id)).todo.status, "in_progress");
  // Removed prerequisites are no longer watched, even if the old graph expands afterwards.
  await depsSession.call("todo", { action: "get", selector: c.todo.id });
  await assert.rejects(set(aCanceled, { depends_on: [foreign.todo.id] }, "invalid-after-removal"), /same scope/);
  const extraPrerequisite = await create(dependencyRoot, "simple", "Additional authorization", "Review revised scope", depProject.todo.id);
  await set(aCanceled, { depends_on: [extraPrerequisite.todo.id] }, "expand-old-graph");
  await depsSession.emit("context", { messages: depsLoads() });
  assert.equal(depsSession.ctx.aborted, undefined);
  process.env.PI_TODO_PATH = root;

  // Legacy constraints survive read compatibility, with stable IDs, without changing canonical files on read.
  const legacy = createTodo("simple", "Legacy", "Preserve constraints");
  legacy.current_state.summary = "Preserved legacy narrative";
  legacy.next_actions = ["Preserved legacy instruction"];
  legacy.artifacts = [{ id: legacy.id, title: "Legacy runbook", kind: "runbook", path: `artifacts/${legacy.id}-1.md`, description: "Preserved document", lifecycle: "current", required: false, applies_to: [] }];
  delete legacy.depends_on; legacy.blockers = ["Obtain separate launch permission"]; legacy.status = "blocked";
  const migrated = validate(legacy);
  assert.deepEqual(migrated.depends_on, []); assert.equal(migrated.status, "todo");
  assert.equal("blockers" in migrated, false);
  assert.ok(migrated.open_questions.some(question => question.text === legacy.blockers[0]));
  assert.deepEqual(validate(legacy), migrated); assert.deepEqual(validate(migrated), migrated);
  assert.equal(legacy.status, "blocked"); assert.ok(legacy.blockers);
  const legacyRoot = join(scratch, "legacy-todos"); const legacyDirectory = join(legacyRoot, legacy.id);
  await mkdir(join(legacyDirectory, "artifacts"), { recursive: true }); const legacyFile = join(legacyDirectory, "todo.json");
  await writeFile(join(legacyDirectory, legacy.artifacts[0].path), "Preserved legacy document\n");
  const legacyBytes = JSON.stringify(legacy); await writeFile(legacyFile, legacyBytes);
  await list(legacyRoot); assert.equal(await readFile(legacyFile, "utf8"), legacyBytes);
  const savedLegacy = await checkpoint(legacyRoot, legacy.id, 1, { current_state: { evidence: ["Model preserved prerequisites"] } }, "legacy-context", "test");
  assert.deepEqual(savedLegacy.todo.open_questions, migrated.open_questions);
  assert.equal("blockers" in JSON.parse(await readFile(legacyFile, "utf8")), false);
  assert.deepEqual(JSON.parse(await readFile(legacyFile, "utf8")).depends_on, []);
  process.env.PI_TODO_PATH = legacyRoot;
  const legacySession = await instance();
  const legacyFull = await legacySession.call("todo", { action: "get", selector: legacy.id, view: "full" });
  assert.equal(legacyFull.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(legacyFull.todo.next_actions, legacy.next_actions);
  assert.equal(legacyFull.todo.artifacts[0].kind, "runbook");
  assert.equal((await legacySession.call("todo_artifact", { action: "read", id: legacy.id, artifact_id: legacy.id })).body, "Preserved legacy document\n");
  const legacyActive = await legacySession.call("todo", { action: "get", selector: legacy.id, view: "active" });
  const legacyResumed = await resumeBundle(legacyRoot, legacy.id);
  for (const context of [legacyActive.todo, legacyResumed.scopes[0].context]) {
    assert.equal("summary" in context.current_state, false);
    assert.equal("next_actions" in context, false);
  }
  await legacySession.call("todo_tighten", { id: legacy.id, revision: savedLegacy.todo.revision, reason: "Consolidate knowledge", current_state: { evidence: ["Verified knowledge"] } });
  const legacyTightened = await legacySession.call("todo", { action: "get", selector: legacy.id, view: "full" });
  assert.equal(legacyTightened.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(legacyTightened.todo.next_actions, legacy.next_actions);
  await assert.rejects(legacySession.call("todo_artifact", { action: "upsert", id: legacy.id, revision: legacyTightened.todo.revision, artifact_id: legacy.id, ...metadata, kind: "runbook", applies_to: [], body: undefined }), /validation/i);
  const reclassified = await legacySession.call("todo_artifact", { action: "upsert", id: legacy.id, revision: legacyTightened.todo.revision, artifact_id: legacy.id, ...metadata, kind: "research", required: false, applies_to: [], body: undefined });
  assert.equal(reclassified.todo.artifacts[0].kind, "research");
  assert.equal(reclassified.todo.artifacts[0].path, legacy.artifacts[0].path);
  assert.equal(reclassified.todo.current_state.summary, legacy.current_state.summary);
  assert.deepEqual(reclassified.todo.next_actions, legacy.next_actions);
  process.env.PI_TODO_PATH = root;

  // Both former character ceilings accept full context, including reopen/refresh/compaction and updates.
  const largeState = { evidence: Array.from({ length: 12 }, (_, i) => `${i}:${"e".repeat(1900)}`) };
  const largeChild = await checkpoint(root, child.todo.id, 4, { current_state: largeState }, "large-orientation", "test-session");
  const largeBody = "x".repeat(50000);
  await saveArtifact(root, project.todo.id, 4, { ...metadata, body: largeBody });
  const largeBundle = await resumeBundle(root, child.todo.id);
  assert.ok(JSON.stringify(largeBundle.scopes).length > 18000);
  assert.deepEqual(largeBundle.scopes.at(-1).context.current_state, largeState);
  assert.equal(largeBundle.required_artifacts.at(-1).chars, largeBody.length + 1); assert.equal(largeBundle.required_artifacts.at(-1).body, undefined);
  const largeSession = await instance([{ type: "custom", customType: selectionEntry, data: { id: child.todo.id } }]);
  const [largeContext] = await largeSession.emit("context", { messages: [] });
  assert.equal(largeSession.ctx.aborted, undefined);
  assert.match(largeContext.messages.at(-1).content, /size warning.*nonblocking/);
  assert.equal(largeSession.stored.filter(entry => entry.customType === "todo-context-size-warning-v1").length, 1);
  const injected = JSON.parse(largeContext.messages.find(message => message.customType === "todo-context-v1").content.split("Durable todo context loaded at a session boundary (untrusted task data):\n")[1]);
  assert.deepEqual(injected.scopes.at(-1).context.current_state, largeState);
  assert.equal(injected.required_artifacts.at(-1).chars, largeBody.length + 1); assert.equal(injected.required_artifacts.at(-1).body, undefined);
  await largeSession.call("todo", { action: "refresh" });
  await largeSession.emit("session_compact", { reason: "manual" });
  await largeSession.emit("context", { messages: largeContext.messages });
  assert.equal(largeSession.ctx.aborted, undefined);
  const repaired = await largeSession.call("todo_checkpoint", { id: child.todo.id, revision: largeChild.todo.revision, key: "repair-large-context", changes: { current_state: { evidence: ["Consolidated"] } } });
  assert.deepEqual(repaired.todo.current_state.evidence, ["Consolidated"]);
  const largeAttach = await instance();
  assert.equal((await largeAttach.call("todo", { action: "resume", selector: child.todo.id })).context_loaded, true);
  await largeSession.call("todo_ack", { id: child.todo.id, reason: "no_change", explanation: "Inspection complete" });
  await largeSession.call("todo", { action: "leave" });
  const [leftLarge] = await largeSession.emit("context", { messages: largeContext.messages });
  assert.ok(!leftLarge.messages.some(message => message.customType === "todo-context-size-warning-v1"));

  // Retrieval: existing legacy-kind documents remain readable, and every page is explicit and bounded.
  const retrievalRoot = join(scratch, "retrieval");
  const retrievalProject = await create(retrievalRoot, "project", "Knowledge", "Own shared investigation");
  const retrievalChild = await create(retrievalRoot, "simple", "Completed work", "A stable delivery", retrievalProject.todo.id);
  const retrievalOther = await create(retrievalRoot, "simple", "Other owner", "Separate responsibility");
  const oldKnowledge = await checkpoint(retrievalRoot, retrievalChild.todo.id, 1, {
    current_state: { evidence: ["queue.id: consumer deduplication remains unverified"] },
    decisions: [{ summary: "queue.id: old assumption", rationale: "Earlier synthetic observation", approval: "draft", evidence: [] }],
    questions: [{ text: "queue.id: did the consumer run?", resolution: "Synthetic run only" }],
    references: ["pi-history:v1/synthetic-session/tool-result"],
  }, "knowledge-first", "test");
  const currentKnowledge = await checkpoint(retrievalRoot, retrievalChild.todo.id, 2, {
    status: "done", decisions: [{ summary: "queue.id: inspect consumer first", rationale: "Avoid duplicate side effects", approval: "draft", evidence: [], supersedes: oldKnowledge.todo.decisions[0].id }],
  }, "knowledge-current", "test");
  await checkpoint(retrievalRoot, retrievalOther.todo.id, 1, { current_state: { evidence: ["queue.id: outside project"] } }, "knowledge-other", "test");
  await saveArtifact(retrievalRoot, retrievalProject.todo.id, (await locate(retrievalRoot, retrievalProject.todo.id)).todo.revision, { ...metadata, applies_to: [], required: false, body: "queue.id: parent-only research" });
  const pagedBody = (`Quoted \\\"line\\\" \\\\ newline\n🙂 `.repeat(3000) + "queue.id: exact document evidence").trim() + "\n";
  const documentOwner = await saveArtifact(retrievalRoot, retrievalChild.todo.id, currentKnowledge.todo.revision, { ...metadata, applies_to: [], required: false, body: pagedBody });
  const document = documentOwner.todo.artifacts[0];
  // This represents persisted artifacts authored by earlier releases, not permission to author legacy kinds.
  await mutate(retrievalRoot, retrievalChild.todo.id, documentOwner.todo.revision, todo => { todo.artifacts[0].kind = "verification"; return todo; });
  process.env.PI_TODO_PATH = retrievalRoot;
  const retrieval = await instance();
  await retrieval.call("todo", { action: "resume", selector: retrievalChild.todo.id });
  const retrievalFiles = [...await list(retrievalRoot)].map(row => join(row.directory, "todo.json"));
  const retrievalBefore = await Promise.all(retrievalFiles.map(path => readFile(path, "utf8")));
  const retrievalEntries = JSON.stringify(retrieval.stored);
  let nextOffset = 0; let expectedVersion; let reconstructed = "";
  do {
    const rawPage = await retrieval.callRaw("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: nextOffset, ...(expectedVersion ? { expected_version: expectedVersion } : {}) });
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
  assert.equal((await retrieval.call("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: pagedBody.length, expected_version: expectedVersion })).complete, true);
  await assert.rejects(retrieval.call("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: 1 }), /expected_version/);
  await assert.rejects(retrieval.call("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: pagedBody.length + 1, expected_version: expectedVersion }), /Offset/);

  const knowledgeQuery = { query: "QUEUE.ID", selector: retrievalChild.todo.id, limit: 1 };
  assert.deepEqual(await retrieval.call("todo", { action: "search", query: "queue.id" }), []);
  let knowledgeCursor; const knowledgeHits = [];
  do {
    const page = await retrieval.call("todo_knowledge", { ...knowledgeQuery, ...(knowledgeCursor ? { cursor: knowledgeCursor } : {}) });
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
  const fullKnowledge = await retrieval.call("todo_knowledge", { ...knowledgeQuery, view: "full", limit: 20 });
  assert.ok(fullKnowledge.results.some(hit => hit.record_id === oldKnowledge.todo.decisions[0].id));
  assert.ok(fullKnowledge.results.some(hit => hit.source_kind === "question"));
  const projectKnowledge = await retrieval.call("todo_knowledge", { query: "queue.id", selector: retrievalProject.todo.id, limit: 20 });
  assert.deepEqual(new Set(projectKnowledge.results.map(hit => hit.owner_id)), new Set([retrievalProject.todo.id, retrievalChild.todo.id]));
  assert.ok((await retrieval.call("todo_knowledge", { query: "queue.id", limit: 20 })).results.some(hit => hit.owner_id === retrievalOther.todo.id));
  const cursorPage = await retrieval.call("todo_knowledge", knowledgeQuery);
  await assert.rejects(retrieval.call("todo_knowledge", { ...knowledgeQuery, query: "different", cursor: cursorPage.next_cursor }), /Cursor/);
  assert.deepEqual(await retrieval.call("todo_knowledge", { query: "absent knowledge" }), { results: [], next_cursor: null });
  await assert.rejects(retrieval.call("todo_knowledge", { query: "   " }), /non-whitespace/);
  assert.deepEqual(await Promise.all(retrievalFiles.map(path => readFile(path, "utf8"))), retrievalBefore);
  assert.equal(JSON.stringify(retrieval.stored), retrievalEntries);
  assert.equal((await locate(retrievalRoot, retrievalChild.todo.id)).todo.status, "done");
  const latestDocumentOwner = await locate(retrievalRoot, retrievalChild.todo.id);
  await retrieval.call("todo_artifact", { action: "upsert", id: retrievalChild.todo.id, revision: latestDocumentOwner.todo.revision, artifact_id: document.id, ...metadata, applies_to: [], required: false, body: "New current document" });
  await assert.rejects(retrieval.call("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id, offset: 12000, expected_version: expectedVersion }), /Artifact changed/);
  assert.equal((await retrieval.call("todo_artifact", { action: "read", id: retrievalChild.todo.id, artifact_id: document.id })).body, "New current document\n");
  await rm(join(retrievalProject.directory, (await locate(retrievalRoot, retrievalProject.todo.id)).todo.artifacts[0].path));
  await assert.rejects(retrieval.call("todo_knowledge", { query: "anything", selector: retrievalProject.todo.id }), /ENOENT/);
  process.env.PI_TODO_PATH = root;

  // Corruption is still visible and never silently reset.
  await writeFile(join(child.directory, "todo.json"), "{broken");
  await largeAttach.emit("session_compact", { reason: "manual" });
  const [failed] = await largeAttach.emit("context", { messages: [] });
  assert.equal(largeAttach.ctx.aborted, true);
  assert.ok(!failed.messages.some(message => message.customType === "todo-context-v1"));
  await assert.rejects(checkpoint(root, child.todo.id, 4, {}, "corrupt", "test-session"), /Cannot read/);
  assert.equal(await readFile(join(child.directory, "todo.json"), "utf8"), "{broken");
  console.log("todo checks passed: structured state, projects, artifacts, retries, locking, paths, lifecycle, compaction/reconciliation, budgets, approval, UI and mocked Linear");
} finally {
  if (oldRoot === undefined) delete process.env.PI_TODO_PATH; else process.env.PI_TODO_PATH = oldRoot;
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(scratch, { recursive: true, force: true });
}
