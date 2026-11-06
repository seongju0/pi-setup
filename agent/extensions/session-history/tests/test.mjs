import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scratch = await mkdtemp(join(tmpdir(), "pi-history-test-"));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/core/session-manager.js")));
const { validateToolArguments } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/utils/validation.js")));
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
const cwd = join(scratch, "project");
const sessions = join(scratch, "sessions");
const user = text => ({ role: "user", content: text, timestamp: 1 });
const assistant = content => ({ role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
try {
  await mkdir(cwd);
  const manager = SessionManager.create(cwd, sessions);
  const first = manager.appendMessage(user("Needle!? precompaction original"));
  manager.appendMessage(assistant([{ type: "text", text: "Needle!? assistant" }, { type: "thinking", thinking: "secret-thinking" }, { type: "toolCall", id: "call-1", name: "lookup", namespace: "test", arguments: { query: "Needle!? requested" } }]));
  const resultId = manager.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "lookup", namespace: "test", content: [{ type: "text", text: "Needle!? failed result" }, { type: "image", data: "secret-image", mimeType: "image/png" }], isError: true, timestamp: 3 });
  const longText = "Needle!? " + "long supported text. ".repeat(1600);
  const longId = manager.appendMessage(user(longText));
  const parallelId = manager.appendMessage(assistant([
    { type: "toolCall", id: "parallel-a", name: "first_tool", arguments: {} },
    { type: "toolCall", id: "parallel-b", name: "second_tool", arguments: { query: "Needle!? second call" } },
  ]));
  const base = manager.getLeafId();
  manager.appendMessage(user("unrelated Needle!? branch"));
  const offBranch = manager.getLeafId();
  manager.branch(base);
  manager.appendCompaction("Needle!? compaction derived", longId, 100);
  manager.appendCustomMessageEntry("coordination", "Needle!? visible coordination", true);
  manager.appendCustomMessageEntry("hidden", "secret-hidden", false);
  manager.appendCustomEntry("state", { text: "secret-state" });
  manager.appendMessage({ role: "bashExecution", command: "echo Needle!?", output: "Needle!? bash", exitCode: 0, cancelled: false, truncated: false, timestamp: 4 });
  manager.appendContextEdit(first, null);
  manager.branchWithSummary(manager.getLeafId(), "Needle!? branch derived");
  manager.appendMessage({ role: "system", content: "secret-system" });
  const head = manager.getLeafId();
  const beforeLoad = await readdir(scratch);
  const loaded = await loadExtensions([join(directory, "index.ts")], cwd, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(await readdir(scratch), beforeLoad);
  const extension = loaded.extensions[0];
  assert.equal(extension.handlers.size, 0);
  const tool = extension.tools.get("session_history").definition;
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const callRaw = (params, sm = manager, signal) => tool.execute("test", validateToolArguments(tool, { id: "test", name: "session_history", arguments: params }), signal, undefined, { cwd, sessionManager: sm });
  const call = async (...args) => (await callRaw(...args)).structuredContent;
  const initial = await call({ action: "search", query: " Needle!? ", limit: 2 });
  assert.ok(initial.next_cursor);
  manager.appendMessage(user("Needle!? new retrieval receipt"));
  const hits = [...initial.results];
  let cursor = initial.next_cursor;
  while (cursor) {
    const next = await call({ action: "search", query: "Needle!?", limit: 2, cursor });
    hits.push(...next.results); cursor = next.next_cursor;
  }
  assert.ok(hits.some(hit => hit.entry_id === first));
  assert.ok(!hits.some(hit => hit.entry_id === offBranch || /new retrieval/.test(hit.excerpt)));
  const derived = hits.findIndex(hit => hit.provenance !== "historical_original");
  assert.ok(derived > 0);
  assert.ok(hits.slice(derived).every(hit => hit.provenance !== "historical_original"));
  assert.equal(hits.find(hit => hit.entry_id === resultId).is_error, true);
  assert.equal(hits.find(hit => hit.entry_id === resultId).tool_call_id, "call-1");
  assert.equal(hits.find(hit => hit.tool_call_id === "call-1").tool_namespace, "test");
  const parallelHit = hits.find(hit => hit.entry_id === parallelId);
  assert.equal(parallelHit.tool_call_id, undefined);
  assert.equal(parallelHit.tool_name, undefined);
  const parallelRead = await call({ action: "read", ref: parallelHit.ref });
  assert.match(parallelRead.text, /parallel-a/);
  assert.match(parallelRead.text, /parallel-b/);
  assert.ok(hits.some(hit => hit.kind === "custom_coordination" && hit.provenance === "derived_coordination"));
  assert.ok(hits.some(hit => hit.kind === "branch_summary" && hit.provenance === "derived_summary"));
  const toolRead = await call({ action: "read", ref: hits.find(hit => hit.kind === "assistant_tool_call" && hit.tool_call_id === "call-1").ref });
  assert.match(toolRead.text, /Arguments:.*requested/);
  assert.doesNotMatch(toolRead.text, /secret-thinking/);
  const resultRead = await call({ action: "read", ref: hits.find(hit => hit.entry_id === resultId).ref });
  assert.doesNotMatch(resultRead.text, /secret-image/);
  assert.match(resultRead.text, /\[image omitted\]/);
  assert.ok(!JSON.stringify(hits).includes("secret-"));
  assert.deepEqual((await call({ action: "search", query: "secret-" })).results, []);
  const ref = hits.find(hit => hit.entry_id === longId).ref;
  let text = "", offset = 0;
  do {
    const raw = await callRaw({ action: "read", ref, offset });
    const page = raw.structuredContent;
    assert.deepEqual(raw.details, page);
    assert.ok(page.text.length <= 12000);
    assert.equal(raw.content[0].text.split("\n\n").slice(1).join("\n\n"), page.text);
    text += page.text; offset = page.next_offset;
  } while (offset !== null);
  assert.equal(text, longText);
  assert.match((await call({ action: "read", ref: `pi-history:v1/${manager.getSessionId()}/${offBranch}` })).text, /unrelated/);

  // A new same-cwd session reads archived bytes without the SDK's newline-writing loader.
  const file = manager.getSessionFile();
  const original = (await readFile(file, "utf8")).trimEnd();
  await writeFile(file, original);
  const fresh = SessionManager.create(cwd, sessions);
  assert.equal((await call({ action: "read", ref, limit: 40 }, fresh)).text, longText.slice(0, 40));
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(call({ action: "read", ref }, fresh, AbortSignal.abort()), /abort/i);
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(call({ action: "read", ref: "pi-history:v1/%2e%2e/bad" }, fresh), /Invalid/);
  await assert.rejects(call({ action: "read", ref: "pi-history:v2/a/b" }, fresh), /Invalid/);
  await assert.rejects(call({ action: "search", query: "Needle!?", limit: 21 }), /limit/);
  await assert.rejects(call({ action: "search", query: "Needle!?", surprise: true }), /validation|additional/i);
  for (const params of [
    { action: "search", query: "q".repeat(2001) },
    { action: "search", query: "Needle!?", cursor: "c".repeat(6001) },
    { action: "read", ref: "r".repeat(2001) },
  ]) await assert.rejects(call(params), /validation/i);
  await assert.rejects(call({ action: "search", query: "Needle!?", cursor: "bad" }), /cursor/);
  await assert.rejects(call({ action: "search", query: "other", cursor: initial.next_cursor }), /cursor/);
  manager.branch(first);
  await assert.rejects(call({ action: "search", query: "Needle!?", cursor: initial.next_cursor }), /ancestry/);
  manager.branch(head);
  const outside = SessionManager.create(join(scratch, "other-project"), sessions);
  outside.appendMessage(user("outside"));
  outside.appendMessage(assistant([{ type: "text", text: "flush" }]));
  await assert.rejects(call({ action: "read", ref: `pi-history:v1/${outside.getSessionId()}/${outside.getLeafId()}` }, fresh), /outside|missing/);
  const escaped = join(scratch, "escaped.jsonl");
  await writeFile(escaped, original);
  await rm(file);
  await symlink(escaped, file);
  await assert.rejects(call({ action: "read", ref }, fresh), /outside/);
  await rm(file);
  await assert.rejects(call({ action: "read", ref }, fresh), /missing|deleted/);
  console.log("session-history: real SDK search/read, pagination, archived immutability and scope checks passed");
} finally {
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  await rm(scratch, { recursive: true, force: true });
}
