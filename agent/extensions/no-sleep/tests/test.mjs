// Direct: node agent/extensions/no-sleep/tests/test.mjs; repository: npm test.
// Real Pi extension loading and handlers; only native process creation is mocked.
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const entry = join(dirname(fileURLToPath(import.meta.url)), "../index.ts");
const { loadExtensions, clearExtensionCache, createExtensionRuntime } = await import(pathToFileURL(join(root, "dist/core/extensions/loader.js")));
const keys = ["PI_NO_SLEEP", "PI_NO_SLEEP_SCOPE", "PI_NO_SLEEP_DISPLAY"];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalSpawn = childProcess.spawn;
const children = [];
const runtimes = [];
const darwin = process.platform === "darwin";
const listeners = Object.fromEntries(["exit", "SIGINT", "SIGTERM"].map(name => [name, process.listenerCount(name)]));

function environment(values = {}) {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
}

async function load({ hasUI = true } = {}) {
  clearExtensionCache();
  const before = children.length;
  const loaded = await loadExtensions([entry], process.cwd(), undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.ok(extension.commands.has("no-sleep"));
  assert.equal(children.length, before, "factory must not acquire resources");
  for (const [name, count] of Object.entries(listeners)) assert.equal(process.listenerCount(name), count);
  const notices = [];
  let idle = true;
  const ctx = { hasUI, mode: hasUI ? "tui" : "json", isIdle: () => idle,
    ui: { notify: (message, level) => notices.push({ message, level }) } };
  const runtime = {
    notices,
    async event(type, fields = {}) {
      if (type === "agent_start") idle = false;
      if (type === "agent_settled") idle = true;
      for (const handler of extension.handlers.get(type) ?? []) await handler({ type, ...fields }, ctx);
    },
    command: args => extension.commands.get("no-sleep").handler(args, ctx),
  };
  runtimes.push(runtime);
  return runtime;
}

childProcess.spawn = (command, args, options) => {
  // Never fall through to the real OS, including on an unexpected executable.
  assert.equal(command, "/usr/bin/caffeinate");
  const child = new EventEmitter();
  Object.assign(child, { pid: 50000 + children.length, command, args, options, kills: [], unrefs: 0,
    unref() { this.unrefs++; },
    kill(signal) { this.kills.push(signal); return true; },
  });
  children.push(child);
  return child;
};
syncBuiltinESMExports();

try {
  // 1. Session default, owned release, and a replacement runtime resetting policy.
  environment();
  {
    const start = children.length;
    const runtime = await load();
    await runtime.event("session_start", { reason: "startup" });
    await runtime.event("agent_start");
    await runtime.event("agent_end", { messages: [] });
    await runtime.event("agent_settled", { aborted: false });
    await runtime.command("");
    assert.match(runtime.notices.at(-1).message, /enabled.*session/);
    if (darwin) {
      assert.equal(children.length, start + 1);
      const first = children[start];
      assert.deepEqual(first.args, ["-i", "-s", "-w", String(process.pid)]);
      assert.deepEqual(first.options, { stdio: "ignore" });
      assert.equal(first.unrefs, 1);
      assert.deepEqual(first.kills, [], "session protection survives idle");
      assert.match(runtime.notices.at(-1).message, /running.*not independently verified.*PID/);
      await runtime.command("off");
      assert.deepEqual(first.kills, ["SIGTERM"]);
      await runtime.command("on");
      await runtime.command("on");
      assert.equal(children.length, start + 2, "on cannot duplicate a running helper");
      await runtime.event("session_shutdown", { reason: "reload" });
      await runtime.event("session_shutdown", { reason: "reload" });
      assert.deepEqual(children[start + 1].kills, ["SIGTERM"]);
    } else {
      assert.equal(children.length, start);
      assert.match(runtime.notices.at(-1).message, /unsupported platform/);
      await runtime.command("on");
      assert.equal(runtime.notices.at(-1).level, "warning");
    }
    await runtime.command("off");
    await runtime.event("session_shutdown", { reason: "reload" });
    const replacement = await load();
    await replacement.event("session_start", { reason: "reload" });
    const count = runtime.notices.length;
    for (const child of children.slice(start, -1)) child.emit("exit", 0, "SIGTERM");
    assert.equal(runtime.notices.length, count, "old callbacks cannot report after shutdown");
    await replacement.command("status");
    assert.match(replacement.notices.at(-1).message, /enabled.*session/);
    if (darwin) assert.equal(children.length, start + 3);
    await replacement.event("session_shutdown", { reason: "quit" });
  }
  console.log("PASS no-sleep 1: session default and release/replacement");

  // 2. Agent continuation/abort, disabled scope changes, display acquisition, commands.
  environment({ PI_NO_SLEEP_SCOPE: "agent" });
  {
    const start = children.length;
    const runtime = await load();
    await runtime.event("session_start", { reason: "startup" });
    assert.equal(children.length, start);
    await runtime.event("agent_start");
    await runtime.event("agent_end", { messages: [] });
    await runtime.event("agent_start");
    if (darwin) {
      assert.equal(children.length, start + 1);
      assert.deepEqual(children[start].kills, []);
    }
    await runtime.event("agent_settled", { aborted: false });
    if (darwin) assert.deepEqual(children[start].kills, ["SIGTERM"]);
    await runtime.event("agent_start");
    await runtime.event("agent_settled", { aborted: true });
    if (darwin) assert.deepEqual(children[start + 1].kills, ["SIGTERM"]);
    await runtime.command("session");
    if (darwin) assert.equal(children.length, start + 3);
    await runtime.command("off");
    await runtime.command("agent");
    assert.match(runtime.notices.at(-1).message, /disabled.*agent/);
    await runtime.command("on");
    if (darwin) {
      assert.equal(children.length, start + 3);
      assert.match(runtime.notices.at(-1).message, /waiting for agent/);
    }
    process.env.PI_NO_SLEEP_DISPLAY = "1";
    await runtime.event("agent_start");
    if (darwin) assert.deepEqual(children.at(-1).args, ["-i", "-s", "-d", "-w", String(process.pid)]);
    await runtime.command(" status ");
    const state = runtime.notices.at(-1).message;
    await runtime.command("help");
    assert.match(runtime.notices.at(-1).message, /local|Local/);
    await runtime.command("off extra");
    assert.equal(runtime.notices.at(-1).level, "warning");
    await runtime.command("status");
    assert.equal(runtime.notices.at(-1).message, state, "help and invalid syntax do not mutate policy");
    await runtime.event("session_shutdown", { reason: "quit" });
  }
  console.log("PASS no-sleep 2: agent-only user flow and commands");

  // 3. Explicit disable and a malformed disable preference fail closed.
  environment({ PI_NO_SLEEP: "0" });
  {
    const start = children.length;
    const runtime = await load();
    await runtime.event("session_start", { reason: "startup" });
    assert.equal(children.length, start);
    await runtime.command("status");
    assert.match(runtime.notices.at(-1).message, /disabled.*off/);
    await runtime.command("on");
    assert.equal(children.length, start + Number(darwin));
    await runtime.event("session_shutdown", { reason: "quit" });
    environment({ PI_NO_SLEEP: "disbaled" });
    const invalid = await load();
    const before = children.length;
    await invalid.event("session_start", { reason: "startup" });
    assert.equal(invalid.notices.at(-1).level, "warning");
    assert.match(invalid.notices.at(-1).message, /configuration.*Correct.*reload/);
    process.env.PI_NO_SLEEP = "1";
    await invalid.command("on");
    await invalid.event("agent_start");
    assert.equal(children.length, before, "commands cannot bypass invalid startup configuration");
    await invalid.command("status");
    assert.match(invalid.notices.at(-1).message, /disabled.*invalid configuration/);
    await invalid.event("session_shutdown", { reason: "quit" });
  }
  console.log("PASS no-sleep 3: disabled and strict configuration flow");

  // 4. Native failures report once, suppress automatic retries, and permit explicit recovery.
  environment();
  {
    const runtime = await load();
    await runtime.event("session_start", { reason: "startup" });
    if (darwin) {
      const failed = children.at(-1);
      failed.emit("error", new Error("mock helper unavailable"));
      failed.emit("exit", 1, null);
      assert.equal(runtime.notices.filter(notice => notice.level === "error").length, 1);
      await runtime.command("status");
      assert.match(runtime.notices.at(-1).message, /enabled.*failed/);
      const attempts = children.length;
      await runtime.event("agent_start");
      await runtime.event("agent_settled", { aborted: false });
      assert.equal(children.length, attempts, "routine events must not retry");
      await runtime.command("on");
      const recovered = children.at(-1);
      assert.equal(children.length, attempts + 1);
      await runtime.command("off");
      await runtime.command("on");
      const current = children.at(-1);
      recovered.emit("exit", 0, "SIGTERM");
      await runtime.command("status");
      assert.match(runtime.notices.at(-1).message, new RegExp(`running.*PID ${current.pid}`));
      assert.equal(runtime.notices.filter(notice => notice.level === "error").length, 1);
      await runtime.event("session_shutdown", { reason: "quit" });
      current.emit("exit", 0, "SIGTERM");
      assert.equal(runtime.notices.filter(notice => notice.level === "error").length, 1);

      const originalStderr = process.stderr.write;
      const originalStdout = process.stdout.write;
      const stderr = [], stdout = [];
      process.stderr.write = chunk => { stderr.push(String(chunk)); return true; };
      process.stdout.write = chunk => { stdout.push(String(chunk)); return true; };
      try {
        const noUI = await load({ hasUI: false });
        await noUI.event("session_start", { reason: "startup" });
        children.at(-1).emit("exit", 2, null);
        assert.equal(stderr.length, 1);
        assert.match(stderr[0], /^\[no-sleep\].*unavailable.*on.*retry/);
        await noUI.command("status");
        assert.match(stderr.at(-1), /failed/);
        assert.deepEqual(stdout, [], "no diagnostic text may pollute protocol stdout");
        assert.deepEqual(noUI.notices, []);
        await noUI.event("session_shutdown", { reason: "quit" });
      } finally {
        process.stderr.write = originalStderr;
        process.stdout.write = originalStdout;
      }
    }
    await runtime.event("session_shutdown", { reason: "quit" });
  }
  console.log(`PASS no-sleep 4: helper failure and manual recovery${darwin ? "" : " (native paths Darwin-only)"}`);
  for (const [name, count] of Object.entries(listeners)) assert.equal(process.listenerCount(name), count);
} finally {
  for (const runtime of runtimes) await runtime.event("session_shutdown", { reason: "quit" });
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
