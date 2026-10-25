// Run from the repository root: npm test. Direct: node agent/extensions/todo/tests/test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configuredRoot, create, list, locate, checkpoint, mutate, withStoreLock } from "../storage.ts";
import { applyChanges, createTodo, needsApproval, validate } from "../state.ts";
import { readArtifact, saveArtifact } from "../artifacts.ts";
import { restoreSelection, resumeBundle, selectionEntry, checkpointMessage } from "../session.ts";
import { compactionEntry, acknowledgementEntry, pendingReconciliation } from "../compaction.ts";

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
  const call = async (name, params, context = ctx) => {
    const tool = loaded.extensions.find(owner => owner.tools.has(name)).tools.get(name).definition;
    const args = validateToolArguments(tool, { id: "check", name, arguments: params });
    return (await tool.execute("check", args, undefined, undefined, context)).structuredContent;
  };
  await emit("session_start");
  return { call, emit, stored, flush, warnings, statuses, confirmations, selects, inputs, editors, panels, customSteps, ctx, extension };
}
try {
  delete process.env.PI_TODO_PATH;
  assert.equal(configuredRoot(), join(homedir(), ".pi", "agent", "todos"));
  process.env.PI_TODO_PATH = root;
  assert.equal(configuredRoot(), root);
  const project = await create(root, "project", "Rollout", "Complete the rollout");
  const child = await create(root, "simple", "Migrate", "Convert unresolved work", project.todo.id);
  const sibling = await create(root, "simple", "Observe", "Validate operations", project.todo.id);
  await assert.rejects(create(root, "project", "Nested", "No", project.todo.id), /Only root/);
  await assert.rejects(create(root, "simple", "Grandchild", "No", child.todo.id), /Only root/);
  assert.equal((await list(root)).length, 3);
  const interrupted = join(project.directory, "todos", `${createTodo("simple", "Interrupted", "No").id}.creating`);
  await mkdir(interrupted);
  assert.equal((await list(root)).length, 3);
  const changes = { current_state: { summary: "Converter tested", evidence: ["https://example.com/pr/1"] }, next_actions: ["Run a dry run"], decisions: [{ summary: "Preserve IDs", rationale: "Avoid duplicate work", approval: "draft", evidence: [] }] };
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
  assert.match(context.messages.at(-1).content, /Batch related routine findings/);
  assert.match(context.messages.at(-1).content, /normal word spacing, progress first/);
  assert.match(pi.extension.tools.get("todo_checkpoint").definition.description, /normal word spacing: progress first/);
  assert.match(context.messages.at(-1).content, /no checkpoint or acknowledgement ritual/);
  const [reminderContext] = await pi.emit("context", { messages: [{ role: "custom", customType: checkpointMessage, content: "Old forced reminder" }] });
  assert.ok(!reminderContext.messages.some(message => message.customType === checkpointMessage));
  await pi.extension.commands.get("todo").handler("checkpoint", pi.ctx);
  assert.match(pi.stored.at(-1).content, /Checkpoint the active todo now/);
  await pi.call("todo_ack", { id: child.todo.id, reason: "no_change", explanation: "Only inspected context" });
  const resumed = await instance(pi.stored);
  assert.equal(restoreSelection(resumed.stored), child.todo.id);
  await resumed.emit("session_tree"); assert.equal((await locate(root, child.todo.id)).todo.revision, 3);
  const blank = await instance();
  assert.equal((await blank.emit("context", { messages: [] }))[0].messages.length, 0);
  await assert.rejects(blank.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "invalid", changes: { arbitrary: true } }), /validation|additional/i);
  await assert.rejects(blank.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "unapproved", changes: { outcome: "New outcome" } }), /sign-off/);
  await assert.rejects(pi.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "declined", changes: { outcome: "New outcome" } }), /sign-off/);
  pi.confirmations.push(true);
  const accepted = await pi.call("todo_checkpoint", { id: child.todo.id, revision: 3, key: "approved", changes: { outcome: "New outcome" } });
  assert.equal(accepted.todo.outcome, "New outcome");
  pi.selects.push("simple"); // Explicit command create uses input/editor, no selector.
  pi.inputs.push("Chore"); pi.editors.push("Finish chore"); pi.confirmations.push(false);
  await pi.extension.commands.get("todo").handler("new simple", pi.ctx);
  assert.equal((await list(root)).length, 4);

  // Saved activity starts only its owner and parent; reads, retries and terminal edits do not restart work.
  const activityRoot = join(scratch, "activity-todos");
  process.env.PI_TODO_PATH = activityRoot;
  const activity = await instance([], true);
  const activityProject = await activity.call("todo", { action: "create", type: "project", title: "Activity", outcome: "Track real work" });
  const prerequisite = await activity.call("todo", { action: "create", type: "simple", parent: activityProject.todo.id, title: "Prerequisite", outcome: "Prepare delivery" });
  const activityChild = await activity.call("todo", { action: "create", type: "simple", parent: activityProject.todo.id, title: "Working child", outcome: "Save findings", depends_on: [prerequisite.todo.id] });
  await activity.call("todo", { action: "resume", selector: activityChild.todo.id });
  await activity.call("todo", { action: "get", selector: activityChild.todo.id });
  await activity.call("todo_ack", { id: activityChild.todo.id, reason: "no_change", explanation: "Only read context" });
  const empty = await activity.call("todo_checkpoint", { id: activityChild.todo.id, revision: 1, key: "empty", changes: {} });
  assert.equal(empty.todo.status, "todo");
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.revision, 1);
  const activityChanges = { current_state: { summary: "Research saved. Delivery still depends on preparation.", evidence: [] } };
  const started = await activity.call("todo_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  assert.equal(started.todo.status, "in_progress");
  assert.equal(started.dependency.dependencies_satisfied, false);
  assert.equal(started.dependency.review_required, false);
  assert.equal((await locate(activityRoot, activityProject.todo.id)).todo.status, "in_progress");
  assert.equal((await locate(activityRoot, prerequisite.todo.id)).todo.status, "todo");
  const replay = await activity.call("todo_checkpoint", { id: activityChild.todo.id, revision: 2, key: "first-finding", changes: activityChanges });
  assert.deepEqual(replay.todo, started.todo);
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
  const artifactStarted = await activity.call("todo_artifact", { action: "upsert", id: artifactChild.todo.id, revision: 1, ...activityMetadata });
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
    const noted = await activity.call("todo_checkpoint", { id: child.todo.id, revision: terminalChild.todo.revision, key: `note-${status}`, changes: { next_actions: ["Keep historical notes"] } });
    const archived = await activity.call("todo_artifact", { action: "upsert", id: child.todo.id, revision: noted.todo.revision, ...activityMetadata, artifact_id: artifactStarted.todo.artifacts[0].id, body: `# ${status} notes` });
    assert.equal(archived.todo.status, status);
    assert.deepEqual((await locate(activityRoot, parent.todo.id)).todo, terminalParent.todo);
  }
  process.env.PI_TODO_PATH = root;

  // Hierarchical picker: latest saved status + Goal, hidden IDs, no attachment while browsing.
  const pickerRoot = join(scratch, "picker-todos");
  const pickerProject = await create(pickerRoot, "project", "Rollout", "Complete a safe production rollout");
  await checkpoint(pickerRoot, pickerProject.todo.id, 1, { status: "in_progress", current_state: { summary: "UAT complete; telemetry sign-off pending.", evidence: [] } }, "picker-status", "test");
  const pickerChild = await create(pickerRoot, "simple", "Migrate 你好", "Convert unresolved work without replaying side effects", pickerProject.todo.id);
  await checkpoint(pickerRoot, pickerChild.todo.id, 1, { current_state: { summary: "Dry run verified 你好. " + "Awaiting operator review. ".repeat(30), evidence: [] } }, "picker-child-status", "test");
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
    assert.match(view, /Latest status/); assert.match(view, /UAT complete; telemetry sign-off pending/);
    assert.match(view, /Goal/); assert.doesNotMatch(view, /Outcome/);
    assert.ok(view.indexOf("Latest status") < view.indexOf("Goal"));
    assert.doesNotMatch(view, /Migrate|Observe|Waiting|Old work|Other child|[a-f0-9]{8}-[a-f0-9-]{27}/);
    assert.equal(restoreSelection(picker.stored), undefined);
    component.handleInput("\r");
  }, (component, terminal) => {
    let view = panelText(component);
    assert.match(view, /Todos › Rollout/); assert.match(view, /\[!\] Waiting/);
    assert.match(view, /\[✓\] Old work/); assert.match(view, /\[-\] Dropped/);
    assert.doesNotMatch(view, /Chore|Other child|[a-f0-9]{8}-[a-f0-9-]{27}/);
    assert.equal(restoreSelection(picker.stored), undefined);
    assert.match(view, /UAT complete; telemetry sign-off pending/); // Project overview shares the preview.
    component.handleInput("\x1b[B");
    view = panelText(component);
    assert.match(view, /Convert unresolved work without replaying side effects/);
    assert.match(view, /Dry run verified 你好/); assert.match(view, /…/);
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
    assert.match(panelText(component), /No status summary saved yet/);
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
  await checkpoint(completedRoot, doneChild.todo.id, 1, { status: "done", current_state: { summary: "Child delivery verified. Retain the investigation notes.", evidence: [] } }, "done-child", "test");
  await checkpoint(completedRoot, doneProject.todo.id, 2, { status: "done", current_state: { summary: "Project delivered. Preserved context is available for questions.", evidence: [] } }, "done-project", "test");
  const doneStandalone = await create(completedRoot, "simple", "Saved answer", "Recall an earlier answer");
  await checkpoint(completedRoot, doneStandalone.todo.id, 1, { status: "done", current_state: { summary: "Earlier answer verified and saved.", evidence: [] } }, "done-answer", "test");
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
    assert.match(view, /\[✓\] Delivered child/); assert.match(view, /Project delivered/);
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
      assert.match(messages.at(-1).content[0].text, /Preserve discoveries/);
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
  assert.match(smallContext.messages.at(-1).content, /Preserve evidence and decision history/);
  const [repeatSmall] = await smallModel.emit("context", { messages: smallContext.messages });
  assert.equal(repeatSmall.messages.filter(message => message.customType === "todo-context-size-warning-v1").length, 1);
  assert.equal(smallModel.warnings.filter(text => text.includes("10%")).length, 1);
  smallModel.ctx.model = { contextWindow: 2000 };
  await smallModel.emit("context", { messages: smallContext.messages });
  assert.equal(smallModel.warnings.filter(text => text.includes("10%")).length, 2);
  smallModel.ctx.model = { contextWindow: 1000000 };
  const [noSizeWarning] = await smallModel.emit("context", { messages: repeatSmall.messages });
  assert.equal(noSizeWarning.messages.filter(message => message.customType === "todo-context-size-warning-v1").length, 2); // Delivered warnings remain at their original positions.

  // Pi's session-usage estimate nudges at 70%, even for a small Todo. Unknown/below-threshold usage is not guessed.
  smallModel.ctx.getContextUsage = () => ({ percent: 69.9, tokens: 699000, contextWindow: 1000000 });
  assert.equal((await smallModel.emit("context", { messages: [] }))[0].messages.filter(m => m.customType === "todo-context-size-warning-v1").length, 2);
  smallModel.ctx.getContextUsage = () => ({ percent: 70, tokens: 700000, contextWindow: 1000000 });
  const [usageContext] = await smallModel.emit("context", { messages: [] });
  assert.match(usageContext.messages.at(-1).content, /session context usage at 70%/);
  assert.match(usageContext.messages.at(-1).content, /todo_tighten/);
  const usageWarnings = smallModel.warnings.length;
  await smallModel.emit("context", { messages: usageContext.messages });
  assert.equal(smallModel.warnings.length, usageWarnings);
  assert.deepEqual(await smallModel.emit("agent_before_settle", boundary), []);
  smallModel.ctx.getContextUsage = () => ({ percent: null, tokens: null, contextWindow: 1000000 });
  assert.equal((await smallModel.emit("context", { messages: usageContext.messages }))[0].messages.filter(m => m.customType === "todo-context-size-warning-v1").length, 3);

  // Autonomous saving records existing user approval without another confirmation; no approval still fails closed.
  const autonomousTodo = await create(root, "simple", "Autonomous saving", "Original outcome");
  const auto = await instance();
  await auto.call("todo", { action: "resume", selector: autonomousTodo.todo.id });
  const autoChanges = { outcome: "User-approved outcome", approval_evidence: "User: use the revised outcome", decisions: [{ summary: "Keep history readable", rationale: "Preserve evidence", approval: "approved", evidence: [] }] };
  const autoSaved = await auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges });
  assert.ok(autoSaved.todo.decisions[0].evidence.includes("User approval: User: use the revised outcome"));
  assert.ok(autoSaved.todo.current_state.evidence.includes("User approval: User: use the revised outcome"));
  assert.deepEqual((await auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 1, key: "existing-approval", changes: autoChanges })).todo, autoSaved.todo);
  await assert.rejects(auto.call("todo_checkpoint", { id: autonomousTodo.todo.id, revision: 2, key: "no-approval", changes: { outcome: "Unapproved outcome" } }), /sign-off/);
  assert.match(auto.stored.find(m => m.customType === "todo-context-v1").content, /Explicit approval of a minor tweak is not by itself a durable decision/);

  // Tightening changes durable orientation without rewriting the current conversation.
  const optional = await auto.call("todo_artifact", { action: "upsert", id: autonomousTodo.todo.id, revision: 2, title: "Old implementation detail", kind: "research", description: "No longer needed to orient", lifecycle: "current", required: false, applies_to: [], body: "HISTORICAL_DETAIL" });
  const hide = { id: autonomousTodo.todo.id, revision: 3, reason: "Verified progress makes earlier detail redundant; active outcome retained", consult_on_demand_decisions: [autoSaved.todo.decisions[0].id], consult_on_demand_artifacts: [optional.todo.artifacts[0].id], current_state: { summary: "Verified progress. Next: review results.", evidence: [] }, next_actions: ["Review results"], references: [] };
  const tightened = await auto.call("todo_tighten", hide);
  assert.equal(tightened.revision, 4); assert.equal(tightened.history_retained, true);
  assert.equal(tightened.todo, undefined); assert.equal(tightened.context_refreshed, false);
  const history = await auto.call("todo", { action: "get", selector: autonomousTodo.todo.id });
  assert.equal(history.todo.decisions.length, 1);
  const changedHiddenDecision = applyChanges(history.todo, { decisions: [{ ...history.todo.decisions[0], summary: "Updated active rule" }] });
  assert.deepEqual(changedHiddenDecision.context_policy.consult_on_demand_decisions, []);
  assert.equal(history.todo.context_policy.consult_on_demand_decisions.length, 1); // Input remains immutable.
  assert.equal(history.todo.outcome, "User-approved outcome");
  const snapshot = history.todo.artifacts.find(a => a.kind === "context-history");
  assert.match((await auto.call("todo_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: snapshot.id })).body, /User approval/);
  assert.match((await auto.call("todo_artifact", { action: "read", id: autonomousTodo.todo.id, artifact_id: optional.todo.artifacts[0].id })).body, /HISTORICAL_DETAIL/);
  const hiddenBundle = await resumeBundle(root, autonomousTodo.todo.id);
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
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).scopes[0].context.decisions.length, 1);
  assert.equal((await resumeBundle(root, autonomousTodo.todo.id)).scopes[0].context.artifacts.length, 1); // Reference snapshot remains on demand.
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
  await auto.extension.commands.get("todo").handler("tighten", auto.ctx);
  assert.match(auto.stored.at(-1).content, /use todo_tighten only if verified progress/);

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
  const external = await checkpoint(root, boundaryTodo.todo.id, 2, { current_state: { summary: "External finding", evidence: [] } }, "external-write", "other-session");
  const [drift] = await boundarySession.emit("context", { messages: refreshedBoundary.messages });
  assert.match(drift.messages.at(-1).content, /changed outside this session/);
  assert.equal(noteMessages().length, 2);
  const driftCount = () => boundarySession.stored.filter(entry => entry.customType === "todo-context-drift-v1").length;
  await boundarySession.emit("context", { messages: drift.messages }); assert.equal(driftCount(), 1);
  await boundarySession.call("todo", { action: "get", selector: boundaryTodo.todo.id });
  const own = await boundarySession.call("todo_checkpoint", { id: boundaryTodo.todo.id, revision: external.todo.revision, key: "own-write", changes: { next_actions: ["Verify the finding"] } });
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
  const externalCache = await checkpoint(root, cacheTodo.todo.id, 1, { next_actions: ["External finding"] }, "cache-external", "other-session");
  const [withDrift] = await cached.emit("context", { messages: historyMessages(cached) });
  const driftPayload = await providerPayload(withDrift.messages);
  respond(cached, 2); cached.flush();
  await cached.call("todo", { action: "get", selector: cacheTodo.todo.id });
  await cached.call("todo_checkpoint", { id: cacheTodo.todo.id, revision: externalCache.todo.revision, key: "cache-local", changes: { next_actions: ["Verify external finding"] } });
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
  await checkpoint(root, jointTodo.todo.id, 1, { next_actions: ["External finding"] }, "joint-external", "other-session");
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
  const cDone = await depsSession.call("todo_checkpoint", { id: c.todo.id, revision: 1, key: "c-done", changes: { status: "done" } });
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
  const note = await set(cDone, { next_actions: ["Review reopened prerequisite"] }, "note");
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
  delete legacy.depends_on; legacy.blockers = ["Obtain separate launch permission"]; legacy.status = "blocked";
  const migrated = validate(legacy);
  assert.deepEqual(migrated.depends_on, []); assert.equal(migrated.status, "todo");
  assert.equal("blockers" in migrated, false);
  assert.ok(migrated.open_questions.some(question => question.text === legacy.blockers[0]));
  assert.deepEqual(validate(legacy), migrated); assert.deepEqual(validate(migrated), migrated);
  assert.equal(legacy.status, "blocked"); assert.ok(legacy.blockers);
  const legacyRoot = join(scratch, "legacy-todos"); const legacyDirectory = join(legacyRoot, legacy.id);
  await mkdir(legacyDirectory, { recursive: true }); const legacyFile = join(legacyDirectory, "todo.json");
  const legacyBytes = JSON.stringify(legacy); await writeFile(legacyFile, legacyBytes);
  await list(legacyRoot); assert.equal(await readFile(legacyFile, "utf8"), legacyBytes);
  const savedLegacy = await checkpoint(legacyRoot, legacy.id, 1, { next_actions: ["Model preserved prerequisites"] }, "legacy-context", "test");
  assert.deepEqual(savedLegacy.todo.open_questions, migrated.open_questions);
  assert.equal("blockers" in JSON.parse(await readFile(legacyFile, "utf8")), false);
  assert.deepEqual(JSON.parse(await readFile(legacyFile, "utf8")).depends_on, []);

  // Both former character ceilings accept full context, including reopen/refresh/compaction and updates.
  const largeState = { summary: "Large orientation", evidence: Array.from({ length: 12 }, (_, i) => `${i}:${"e".repeat(1900)}`) };
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
  const repaired = await largeSession.call("todo_checkpoint", { id: child.todo.id, revision: largeChild.todo.revision, key: "repair-large-context", changes: { current_state: { summary: "Consolidated", evidence: [] } } });
  assert.equal(repaired.todo.current_state.summary, "Consolidated");
  const largeAttach = await instance();
  assert.equal((await largeAttach.call("todo", { action: "resume", selector: child.todo.id })).context_loaded, true);
  await largeSession.call("todo_ack", { id: child.todo.id, reason: "no_change", explanation: "Inspection complete" });
  await largeSession.call("todo", { action: "leave" });
  const [leftLarge] = await largeSession.emit("context", { messages: largeContext.messages });
  assert.ok(!leftLarge.messages.some(message => message.customType === "todo-context-size-warning-v1"));

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
