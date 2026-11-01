// Offline flow checks: real filesystem, accounting, command loader and panel.
// Only the terminal surface is synthetic; no providers or private sessions are used.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { aggregate, createScanner, periodRange } from "../accounting.mjs";

process.env.TZ = "America/New_York";
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT || join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const themes = await import(pathToFileURL(join(packageRoot, "dist/modes/interactive/theme/theme.js")));
const { KeybindingsManager } = await import(pathToFileURL(join(packageRoot, "dist/core/keybindings.js")));
const { visibleWidth, stripTerminalSequences } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")));
themes.initTheme("dark", false);
const scratch = await mkdtemp(join(tmpdir(), "pi-usage-test-"));
const agent = join(scratch, "agent");
const oldAgent = process.env.PI_CODING_AGENT_DIR;
const now = new Date();
const timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
const header = (id, parentSession) => ({ type: "session", version: 3, id, timestamp, cwd: scratch, ...(parentSession ? { parentSession } : {}) });
function usage(input, output, cacheRead = 0, cacheWrite = 0, cost = 1, reasoning) {
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
    ...(reasoning !== undefined ? { reasoning } : {}), ...(cost === null ? {} : { cost: { total: cost } }) };
}
function response(id, provider, model, counts, stopReason = "stop") {
  return { type: "message", id, parentId: null, timestamp, message: {
    role: "assistant", provider, model, usage: counts, stopReason, content: [{ type: "text", text: "SENSITIVE_TRANSCRIPT_MARKER" }],
  } };
}
const jsonl = rows => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
async function put(path, rows) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, jsonl(rows)); }
async function until(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await delay(10); }
  throw new Error("Panel did not settle");
}
const main = join(agent, "sessions", "project", "main.jsonl");
const fork = join(agent, "sessions", "project", "fork.jsonl");
const child = join(agent, "subagents", "owner", "child", "child.jsonl");
try {
  const codex = response("copied", "openai-codex", "codex-model", usage(100, 20, 200, 0, 120, 8));
  const anthropic = response("anthropic", "anthropic", "claude-model", usage(1000, 100, 400, 50, 12));
  const compaction = { type: "compaction", id: "compact", timestamp, usage: usage(50, 10, 0, 0, 2), details: { readFiles: ["PRIVATE_PATH"] } };
  await put(main, [header("main"), codex, anthropic, compaction,
    response("aborted", "anthropic", "claude-model", usage(10, 1, 0, 0, 3), "aborted"),
    { type: "usage", id: "warm", timestamp, kind: "cache_warm", provider: "anthropic", model: "claude-model", usage: usage(1, 1, 10, 0, .01) },
    { type: "message", id: "search", timestamp, message: { role: "toolResult", toolName: "web_search", usage: usage(5, 5, 0, 0, 1), details: { provider: "codex", model: "openai/search-model", answer: "PRIVATE_SEARCH_RESULT" } } },
    { type: "message", id: "nested", timestamp, message: { role: "toolResult", toolName: "codemode", usage: usage(20, 5, 0, 0, .5), details: { calls: [{ name: "web_search" }] } } },
    { type: "custom", id: "snapshot", timestamp, customType: "subagent-state", data: { latest: { usage: { tokens: 999999, cost: 999999 } } } },
    // An incurred old branch is counted even though the fork doesn't contain it.
    response("abandoned", "anthropic", "claude-model", usage(3, 1, 0, 0, .25)),
  ]);
  await put(fork, [header("fork", main), { ...codex, parentId: "different-link" }, { ...compaction, parentId: "different-link" },
    // Same short id but different accounting must survive.
    response("abandoned", "anthropic", "claude-model", usage(4, 1, 0, 0, .5)),
  ]);
  await put(child, [header("child"), response("child-call", "openai", "codex-model", usage(40, 5, 0, 0, 20))]);
  await put(join(agent, "sessions", "project", "subagent-artifacts", "copy.jsonl"), [header("debug"), response("debug-copy", "openai", "codex-model", usage(999, 1, 0, 0, 500))]);
  const scanner = createScanner(agent);
  let snapshot = await scanner.scan();
  let report = aggregate(snapshot, "month", 0, 100, now);
  const row = key => report.rows.find(row => row.key === key);
  assert.equal(row("codex").totalTokens, 375, "main, child and search count exactly once");
  assert.equal(row("codex").cost, 141);
  assert.equal(row("codex").cost - report.monthlyFee, 41);
  assert.equal(row("codex").reasoning, 8, "reasoning doesn't inflate total/output");
  assert.equal(row("anthropic").records, 5, "aborted, warming and both incurred branches count");
  assert.equal(row("anthropic").cost, 15.76);
  assert.equal(row("unattributed").totalTokens, 85, "compaction and nested aggregate aren't guessed into a provider");
  assert.equal(snapshot.stats.duplicates, 2);
  assert.equal(snapshot.stats.files, 3);
  assert.equal(row("codex").models.length, 3, "retain original provider/model identities");
  assert.ok(!JSON.stringify(snapshot).includes("SENSITIVE_TRANSCRIPT_MARKER"));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_SEARCH_RESULT"));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_PATH"));

  // Missing estimates, old helpers, absent parents and a concurrently written tail.
  await appendFile(main, jsonl([
    response("unpriced", "anthropic", "unknown-model", usage(30, 0, 0, 0, null)),
    { type: "custom", id: "legacy-search", timestamp, customType: "web-search-results", data: { answer: "not accounting" } },
    { type: "message", id: "search-without-usage", timestamp, message: { role: "toolResult", toolName: "web_search", isError: false } },
  ]) + '{"unfinished":');
  await put(join(agent, "sessions", "project", "orphan.jsonl"), [header("orphan", join(scratch, "deleted-parent.jsonl")), response("zero-price", "openai", "unknown-codex", usage(10, 0, 0, 0, 0))]);
  snapshot = await scanner.scan();
  report = aggregate(snapshot, "month", 0, 100, now);
  assert.equal(row("anthropic").unpriced, 1);
  assert.equal(row("codex").unpriced, 1, "zero-filled pricing is not silently free");
  assert.equal(snapshot.stats.partialLines, 1);
  assert.equal(snapshot.stats.unresolvedParents, 1);
  assert.ok(report.coverage.some(line => line.includes("without usage metadata")));
  assert.ok(snapshot.stats.cachedFiles >= 2, "unchanged transcripts are cached");
  const cached = await scanner.scan();
  assert.equal(cached.stats.readFiles ?? 0, 0);
  // Complete the partial line and append new accounting, then remove a child.
  await appendFile(main, 'true}\n' + jsonl([response("new", "anthropic", "claude-model", usage(1, 1, 0, 0, 2))]));
  await rm(child);
  snapshot = await scanner.scan();
  report = aggregate(snapshot, "month", 0, 100, now);
  assert.equal(snapshot.stats.partialLines ?? 0, 0);
  assert.equal(row("codex").cost, 121);
  assert.ok(Math.abs(row("anthropic").cost - 17.76) < 1e-9);

  // Explicit local calendar ranges cover a DST week and a year transition.
  const dst = periodRange("week", 0, new Date(2026, 2, 8, 12));
  assert.equal(dst.start.getDay(), 1);
  assert.equal(dst.start.getDate(), 2);
  assert.equal(dst.end.getDate(), 9);
  assert.equal((dst.end - dst.start) / 3600000, 167);
  const previous = periodRange("month", -1, new Date(2026, 0, 31));
  assert.equal(previous.start.getFullYear(), 2025);
  assert.equal(previous.start.getMonth(), 11);
  const bounded = aggregate({ records: [
    { ...snapshot.records[0], timestamp: dst.start.getTime() },
    { ...snapshot.records[0], id: "end", timestamp: dst.end.getTime() },
  ], stats: { files: 1 }, refreshedAt: new Date() }, "week", 0, 100, new Date(2026, 2, 8, 12));
  assert.equal(bounded.rows.reduce((n, r) => n + r.records, 0), 1, "period is half-open");

  // Command -> real scanner -> real panel; synthetic terminal is the UI boundary.
  await writeFile(join(agent, "settings.json"), JSON.stringify({ usage: { subscriptionMonthlyUsd: 100 }, meter: { subscriptionMonthlyUsd: 80 } }));
  process.env.PI_CODING_AGENT_DIR = agent;
  const loaded = await loadExtensions([join(dirname(fileURLToPath(import.meta.url)), "../index.ts")], scratch, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  const command = loaded.extensions[0].commands.get("usage");
  assert.ok(command, "renamed /usage command is registered");
  assert.ok(!loaded.extensions[0].commands.has("meter"), "old command name is retired");
  const notices = [];
  let component, finish, options, renderRequests = 0;
  const terminal = { rows: 80, columns: 160 };
  const ctx = { mode: "tui", ui: {
    notify: (message, level) => notices.push({ message, level }),
    custom: (factory, config) => {
      options = config;
      return new Promise(resolve => {
        finish = () => resolve();
        component = factory({ terminal, requestRender: () => { renderRequests++; } }, themes.theme, new KeybindingsManager(), finish);
      });
    },
  } };
  const running = command.handler("month", ctx);
  const screen = (width = 150) => component.render(width).map(stripTerminalSequences).join("\n");
  await until(() => component && screen().includes("Anthropic") && !screen().includes("Loading"));
  assert.equal(options.overlay, true);
  assert.equal(options.overlayOptions.width, 110);
  const frame = component.render(100).map(stripTerminalSequences);
  assert.ok(frame[0].startsWith("╭") && frame[0].endsWith("╮"));
  assert.ok(frame.at(-1).startsWith("╰") && frame.at(-1).endsWith("╯"));
  assert.ok(frame.slice(1, -1).every(line => line.startsWith("│  ") && line.endsWith("  │")), "consistent horizontal padding");
  assert.ok(frame.every(line => visibleWidth(line) === 100), "opaque full-width frame");
  assert.match(frame.join("\n"), /Codex.*Anthropic/, "providers align in one comparison header");
  assert.match(screen(), /Codex/);
  assert.match(screen(), /100/);
  assert.match(screen(), /17\.76/);
  assert.match(screen(), /121\.00/);
  assert.match(screen(), /Partial cost avoided/);
  // Ratios use summed input buckets, including writes/warming but not output.
  // Unequal prompt sizes and the copied fork distinguish weighting and dedup.
  assert.match(screen(), /Cached input %\s+63\.5%\s+27\.2%/);
  assert.match(screen(60), /Cached input %: 63\.5%/, "narrow comparison retains cache metric");
  component.handleInput("b"); // model breakdown
  assert.match(screen(), /claude-model[\s\S]*?Cached input: 27\.7%/);
  assert.match(screen(), /unknown-model[\s\S]*?Cached input: 0\.0%/, "recorded miss differs from no input");
  component.handleInput("c"); // coverage
  assert.match(screen(), /[Cc]overage/);
  component.handleInput("w");
  await until(() => !screen().includes("Loading"));
  assert.match(screen(), /[Ww]eek/);
  assert.doesNotMatch(screen(), /cost avoided|below plan/, "weekly view never subtracts the monthly fee");
  component.handleInput("\x1b[D");
  await until(() => !screen().includes("Loading"));
  component.handleInput("m");
  await until(() => !screen().includes("Loading"));
  component.handleInput("b"); // collapse models before inspecting an empty month
  component.handleInput("\x1b[D");
  await until(() => screen().includes("No recorded usage in this period."));
  assert.match(screen(), /Cached input %\s+—\s+—/, "zero input has no percentage");
  assert.match(screen(60), /Cached input %: —/, "narrow comparison also shows no input");
  component.handleInput("m");
  await until(() => !screen().includes("Loading"));
  component.handleInput("r");
  await until(() => !screen().includes("Loading"));
  for (const width of [12, 40, 80, 150]) {
    const lines = component.render(width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
    assert.ok(lines.length <= Math.floor(terminal.rows * .85), "panel fits overlay without clipping its controls");
  }
  terminal.rows = 14;
  assert.ok(component.render(80).length <= Math.floor(14 * .85));
  assert.ok(stripTerminalSequences(component.render(80).at(-1)).endsWith("╯"), "short-terminal resize preserves bottom border");
  assert.match(screen(80), /Esc close/, "short-terminal resize preserves controls");
  component.handleInput("\x1b[B");
  component.handleInput("\x1b");
  await running;
  component.dispose?.();
  const afterClose = renderRequests;
  await delay(30);
  assert.equal(renderRequests, afterClose, "closed panel doesn't request late renders");
  assert.deepEqual(notices, []);
  await writeFile(join(agent, "settings.json"), JSON.stringify({ meter: { subscriptionMonthlyUsd: 80 } }));
  component = undefined;
  terminal.rows = 80;
  const legacyRunning = command.handler("", ctx);
  await until(() => component && screen().includes("$80.00/mo"));
  component.handleInput("\x1b");
  await legacyRunning;
  component.dispose?.();
  await command.handler("bad-period", ctx);
  assert.equal(notices.at(-1).level, "error");
  await command.handler("", { ...ctx, mode: "rpc" });
  assert.equal(notices.at(-1).level, "error");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ usage: { subscriptionMonthlyUsd: -1 } }));
  await command.handler("", ctx);
  assert.match(notices.at(-1).message, /nonnegative/);
  assert.match(await readFile(join(agent, "settings.json"), "utf8"), /-1/, "usage never rewrites settings");
  console.log("usage checks passed: provider/model accounting, subscription comparison, fork/child dedup, overhead and missing estimates, failed-call usage, local calendar/DST boundaries, changed/deleted/partial files and cache, command/overlay navigation, narrow rendering and cleanup.");
} finally {
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgent;
  await rm(scratch, { recursive: true, force: true });
}
