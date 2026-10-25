// Run from the repository root: npm test. Direct: node agent/extensions/task/tests/test.mjs
// Uses Pi's real extension loader; no model calls or real task data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apply, blockers, emptyState, loadState, parseState, saveState, sessionPath } from "../state.ts";

const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const { initTheme } = await import(pathToFileURL(join(packageRoot, "dist/modes/interactive/theme/theme.js")));
const themeModule = await import(pathToFileURL(join(packageRoot, "dist/modes/interactive/theme/theme.js")));
const { visibleWidth } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")));
const { validateToolArguments } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/utils/validation.js")));
const scratch = await mkdtemp(join(tmpdir(), "pi-task-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = scratch;
initTheme("dark", false);

async function instance(id, persistent = true, mode = "print") {
  const loaded = await loadExtensions([join(directory, "index.ts")], scratch, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const widgets = new Map();
  const stored = [];
  const warnings = [];
  const selections = [];
  const inputs = [];
  const editors = [];
  const ctx = {
    cwd: scratch, mode, hasUI: mode === "tui",
    sessionManager: {
      getSessionId: () => id,
      getSessionFile: () => persistent ? join(scratch, `${id}.jsonl`) : undefined,
      buildContextEntries: () => stored,
    },
    ui: {
      notify: message => warnings.push(message),
      setWidget: (key, widget) => widget ? widgets.set(key, widget) : widgets.delete(key),
      input: async () => inputs.shift(), editor: async () => editors.shift(),
      select: async () => "in_progress", confirm: async () => true,
      custom: async (factory, options) => {
        assert.equal(options.overlay, true);
        return new Promise(resolve => {
          const component = factory({ requestRender() {} }, themeModule.theme, {}, resolve);
          for (const width of [12, 40, 80]) {
            for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
          }
          component.invalidate();
          const selectedIndex = selections.shift();
          if (selectedIndex === undefined) component.handleInput("\x1b");
          else {
            for (let i = 0; i < selectedIndex; i++) component.handleInput("\x1b[B");
            component.handleInput("\r");
          }
        });
      },
    },
  };
  const emit = async (event) => {
    const results = [];
    for (const handler of extension.handlers.get(event.type) ?? []) results.push(await handler(event, ctx));
    if (event.type === "before_agent_start") for (const result of results) if (result?.message) stored.push({ type: "custom_message", ...result.message });
    return results;
  };
  const tool = extension.tools.get("task").definition;
  const call = async (params, signal) => {
    const args = validateToolArguments(tool, { id: "test", name: "task", arguments: params });
    const result = (await tool.execute("test", args, signal, undefined, ctx)).structuredContent;
    validateToolArguments({ name: "task", parameters: tool.outputSchema }, { id: "output", name: "task", arguments: result });
    return result;
  };
  await emit({ type: "session_start", reason: "startup" });
  return { ctx, tool, call, emit, widgets, warnings, selections, inputs, editors, stored, extension, switchTo: next => { id = next; stored.length = 0; } };
}

try {
  // Whole-graph validation and mutation rollback.
  let state = emptyState();
  for (const [subject, dependsOn] of [["Inspect", []], ["Fix", ["1"]], ["Verify", ["2"]]]) {
    state = apply(state, { action: "create", subject, description: "Acceptance criteria", dependsOn }).state;
  }
  const original = structuredClone(state);
  assert.throws(() => apply(state, { action: "update", id: "1", dependsOn: ["3"] }), /cycle/);
  assert.throws(() => apply(state, { action: "update", id: "1", dependsOn: ["1"] }), /itself/);
  assert.throws(() => apply(state, { action: "update", id: "1", dependsOn: ["99"] }), /does not exist/);
  assert.throws(() => apply(state, { action: "update", id: "2", status: "in_progress" }), /blocked/);
  assert.deepEqual(state, original);
  state = apply(state, { action: "update", id: "1", status: "cancelled" }).state;
  assert.deepEqual(blockers(state, state.tasks[1]), ["1"]);
  state = apply(state, { action: "update", id: "1", status: "completed" }).state;
  assert.deepEqual(blockers(state, state.tasks[1]), []);
  state = apply(state, { action: "update", id: "2", status: "in_progress" }).state;
  assert.equal(state.tasks[1].status, "in_progress");
  assert.throws(() => parseState({ ...state, version: 2 }), /version/);
  assert.throws(() => parseState({ ...state, nextId: 1 }), /counter/);
  assert.throws(() => parseState({ ...state, tasks: [null] }), /list/);
  assert.throws(() => sessionPath(scratch, "../../escape"), /session ID/);

  // Atomic persistence and a fail-closed load boundary.
  const file = sessionPath(scratch, "storage-test");
  await saveState(file, state);
  assert.deepEqual(await loadState(file), state);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.ok(!(await readdir(dirname(file))).some(name => name.endsWith(".tmp")));
  await writeFile(file, "{broken");
  await assert.rejects(loadState(file), /Cannot read/);
  assert.equal(await readFile(file, "utf8"), "{broken");

  // Actual extension wiring: parallel mutation calls, resume, new, fork, /tree.
  const first = await instance("session-a");
  assert.equal(first.tool.parameters.type, "object");
  assert.equal(first.tool.executionMode, "sequential");
  await assert.rejects(stat(sessionPath(scratch, "session-a")), { code: "ENOENT" });
  await Promise.all(Array.from({ length: 12 }, (_, i) => first.call({ action: "create", subject: `Task ${i}`, description: "Done when checked" })));
  const listed = await first.call({ action: "list" });
  assert.equal(listed.tasks.length, 12);
  assert.equal(new Set(listed.tasks.map(task => task.id)).size, 12);
  await first.call({ action: "update", id: "2", dependsOn: ["1"] });
  assert.deepEqual((await first.call({ action: "get", id: "2" })).tasks[0].blockedBy, ["1"]);
  const beforeCycle = await readFile(listed.storage, "utf8");
  await assert.rejects(first.call({ action: "update", id: "1", dependsOn: ["2"] }), /cycle/);
  assert.equal(await readFile(listed.storage, "utf8"), beforeCycle);
  const resumed = await instance("session-a");
  assert.equal((await resumed.call({ action: "list" })).tasks.length, 12);
  await resumed.emit({ type: "session_tree" });
  assert.equal((await resumed.call({ action: "list" })).tasks.length, 12);
  resumed.switchTo("session-b");
  await resumed.emit({ type: "session_start", reason: "new" });
  assert.deepEqual((await resumed.call({ action: "list" })).tasks, []);
  resumed.switchTo("session-fork");
  await resumed.emit({ type: "session_start", reason: "fork" });
  assert.deepEqual((await resumed.call({ action: "list" })).tasks, []);
  const aborted = AbortSignal.abort();
  await assert.rejects(resumed.call({ action: "create", subject: "Never saved", description: "" }, aborted), /abort/i);
  assert.deepEqual((await resumed.call({ action: "list" })).tasks, []);

  const ephemeral = await instance("ephemeral", false);
  await ephemeral.call({ action: "create", subject: "Memory only", description: "" });
  assert.equal((await ephemeral.call({ action: "list" })).storage, null);
  await assert.rejects(stat(sessionPath(scratch, "ephemeral")), { code: "ENOENT" });
  assert.deepEqual((await (await instance("ephemeral", false)).call({ action: "list" })).tasks, []);

  // Keyboard-driven create/status UI, width safety, widget cleanup on /new.
  const interactive = await instance("ui-test", true, "tui");
  interactive.selections.push(0, 0, 0, undefined);
  interactive.inputs.push("UI task 界\x1b[31m");
  interactive.editors.push("Acceptance\ncriteria");
  await interactive.extension.commands.get("task").handler("", interactive.ctx);
  const uiTask = (await interactive.call({ action: "list" })).tasks[0];
  assert.equal(uiTask.status, "in_progress");
  assert.deepEqual(interactive.warnings, []);
  const widget = interactive.widgets.get("task")({}, themeModule.theme);
  for (const width of [1, 12, 40, 80]) {
    for (const line of widget.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  const [context] = await interactive.emit({ type: "before_agent_start" });
  assert.equal(context.message.customType, "task-context-v1");
  assert.match(context.message.content, /Session task snapshot/);
  assert.equal((await interactive.emit({ type: "before_agent_start" }))[0], undefined);
  assert.deepEqual(await interactive.emit({ type: "context", messages: [] }), []);
  await interactive.call({ action: "update", id: uiTask.id, status: "completed" });
  const followup = (await interactive.call({ action: "create", subject: "Remaining work", description: "One active task", dependsOn: [uiTask.id] })).tasks[0];
  const [activeContext] = await interactive.emit({ type: "before_agent_start" });
  assert.match(activeContext.message.content, /Remaining work/);
  assert.doesNotMatch(activeContext.message.content, /UI task/);
  interactive.stored.length = 0; // Compaction omitted the prior snapshot; reload current saved tasks once.
  assert.match((await interactive.emit({ type: "before_agent_start" }))[0].message.content, /Remaining work/);
  assert.equal((await interactive.emit({ type: "before_agent_start" }))[0], undefined);
  await interactive.call({ action: "update", id: followup.id, status: "cancelled" });
  assert.match((await interactive.emit({ type: "before_agent_start" }))[0].message.content, /No active tasks remain/);
  assert.equal((await interactive.emit({ type: "before_agent_start" }))[0], undefined);
  assert.equal((await interactive.call({ action: "list" })).tasks.length, 2); // Hidden, not deleted.
  interactive.switchTo("ui-new");
  await interactive.emit({ type: "session_start", reason: "new" });
  assert.equal(interactive.widgets.has("task"), false);

  // Corrupt existing data is never silently overwritten by tools.
  await writeFile(sessionPath(scratch, "session-a"), "{broken");
  await assert.rejects(first.call({ action: "create", subject: "Do not overwrite", description: "" }), /Cannot read/);
  assert.equal(await readFile(sessionPath(scratch, "session-a"), "utf8"), "{broken");
  console.log("task checks passed: storage, validation, concurrency, lifecycle, tools, keyboard UI, narrow rendering");
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(scratch, { recursive: true, force: true });
}
