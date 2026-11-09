import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scratch = await mkdtemp(join(tmpdir(), "pi-move-test-"));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")));
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/core/session-manager.js")));
const { getKeybindings } = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/keybindings.js")));
const before = { HOME: process.env.HOME, PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
const home = join(scratch, "home"), agent = join(scratch, "agent"), cwd = join(scratch, "cwd");
const work = join(home, "Work"), other = join(scratch, "other"), bin = join(scratch, "bin");
const configPath = join(agent, "extensions/move/config.json"), log = join(scratch, "fd.log"), responses = join(scratch, "responses.json");
async function eventually(check) { for (let n = 0; n < 200; n++) { if (check()) return; await setTimeout(5); } assert.ok(check(), "async UI did not update"); }
try {
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agent;
  for (const path of [cwd, work, other, bin, dirname(configPath), join(agent, "bin"), join(work, "nested/project"), join(work, ".hidden"), join(other, "outside"), join(work, ".git"), join(work, "node_modules")]) await mkdir(path, { recursive: true });
  await writeFile(join(work, "file"), "not a directory");
  const executable = `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');\nconst data=JSON.parse(fs.readFileSync(${JSON.stringify(responses)},'utf8'))[args.at(-1)]??{};\nprocess.stdout.write((data.names??[]).map(x=>x+'\\0').join('')); process.stderr.write(data.stderr??''); process.exitCode=data.code??0;\n`;
  const installFd = async path => { await writeFile(path, executable); await chmod(path, 0o755); };
  await installFd(join(bin, "fd"));
  process.env.PATH = bin;
  await writeFile(responses, JSON.stringify({ [work]: { names: ["nested/", "nested/project/", ".hidden/"] }, [other]: { names: ["outside/"], stderr: "permission denied: restricted child" } }));
  const loaded = await loadExtensions([join(dirname(dirname(fileURLToPath(import.meta.url))), "index.ts")], cwd, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  const command = loaded.extensions[0].commands.get("move");
  const source = SessionManager.create(cwd, join(scratch, "source-sessions"));
  source.appendMessage({ role: "user", content: "Retain this history", timestamp: 1 });
  const sourceFile = source.getSessionFile(), sourceText = await readFile(sourceFile, "utf8");
  const notices = [], switches = [], order = [];
  let dialog, dismiss, renders = 0, cancelled = false;
  const ctx = {
    cwd, mode: "tui", sessionManager: source,
    ui: {
      notify: (...args) => notices.push(args),
      custom: factory => new Promise(resolve => {
        const component = factory({ requestRender: () => renders++ }, { fg: (_color, text) => text }, getKeybindings(), value => { component.dispose?.(); resolve(value); });
        dismiss = () => { component.dispose?.(); resolve(undefined); };
        dialog = component;
      }),
    },
    waitForIdle: async () => { order.push("idle"); },
    switchSession: async (path, options) => {
      order.push("switch");
      const moved = SessionManager.open(path);
      switches.push({ path, cwd: moved.getCwd(), entries: moved.getEntries() });
      assert.match(await readFile(path, "utf8"), /Retain this history/);
      if (!cancelled) await options.withSession({ ui: { notify: (...args) => notices.push(args) } });
      return { cancelled };
    },
  };
  const configure = async value => { if (value === undefined) await rm(configPath, { force: true }); else await writeFile(configPath, typeof value === "string" ? value : JSON.stringify(value)); };
  const open = async () => { dialog = undefined; const result = command.handler("", ctx); await eventually(() => dialog !== undefined); return { result, ui: dialog }; };
  const text = ui => ui.render(200).join("\n");
  const query = (ui, value) => { ui.handleInput("\x01"); ui.handleInput("\x0b"); for (const char of value) ui.handleInput(char); };
  const close = async opened => { opened.ui.handleInput("\x1b"); await opened.result; };
  const calls = async () => { try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { if (e.code === "ENOENT") return []; throw e; } };

  // Captured defaults, explicit [] precedence, legacy compatibility, and malformed fail-closed config.
  for (const config of [undefined, { root: work, scope: [] }, { root: work }, { scope: "~/Work" }]) {
    await configure(config);
    const opened = await open();
    assert.equal((await calls()).at(-1).at(-1), config === undefined || config.scope?.length === 0 ? cwd : work);
    assert.match(text(opened.ui), /Scope —/);
    await close(opened);
  }
  const legacyText = JSON.stringify({ root: work });
  await configure(legacyText); await close(await open()); assert.equal(await readFile(configPath, "utf8"), legacyText);
  for (const config of [{ scope: "relative" }, { scope: [work, ""] }, { scope: "bad\0path" }, { scope: 3 }, { root: [] }, "{", "null"]) {
    await configure(config); dialog = undefined;
    const count = (await calls()).length;
    await command.handler("", ctx);
    assert.equal(dialog, undefined); assert.equal((await calls()).length, count); assert.equal(notices.at(-1)[1], "error");
  }
  const missing = join(scratch, "never-created");
  await configure({ scope: [missing, work, other] });
  let opened = await open();
  await assert.rejects(access(missing), { code: "ENOENT" });
  assert.match(text(opened.ui), /never-created/);
  assert.match(text(opened.ui), /permission denied/); // Successful exit stderr is not silently swallowed.
  query(opened.ui, "nested/project");
  assert.match(text(opened.ui), /nested\/project/);
  const count = (await calls()).length;
  opened.ui.handleInput("\r"); await opened.result;
  assert.equal(switches.at(-1).cwd, join(work, "nested/project"));
  assert.deepEqual(order.slice(-2), ["idle", "switch"]);
  assert.equal((await calls()).length, count);
  const args = (await calls()).find(args => args.at(-1) === work);
  assert.deepEqual(args.slice(0, -1), ["--type", "d", "--relative-path", "--show-errors", "--color", "never", "--print0", "--hidden", "--no-ignore", "--exclude", ".git", "--exclude", "node_modules", "--max-results", "20001", ""]);

  // The extra NUL-delimited sentinel reports an incomplete snapshot and is not offered.
  const responseData = JSON.parse(await readFile(responses, "utf8"));
  responseData[cwd] = { names: [...Array.from({ length: 20_000 }, (_, n) => `directory-${n}/`), "overflow-last/"] };
  await writeFile(responses, JSON.stringify(responseData));
  await configure({ scope: cwd });
  opened = await open();
  assert.match(text(opened.ui), /Limited to 20000 directories/);
  query(opened.ui, "overflow-last"); assert.match(text(opened.ui), /No matching directories/);
  await close(opened);
  responseData[cwd] = {}; await writeFile(responses, JSON.stringify(responseData));

  // Explicit home/absolute parent listings escape scope only on explicit input, cache once, and ignore stale/closed async results.
  await configure({ scope: cwd });
  opened = await open();
  query(opened.ui, "Work"); assert.doesNotMatch(text(opened.ui), /Use path|nested\/project/);
  query(opened.ui, "~/Wo");
  await eventually(() => text(opened.ui).includes("~/Work"));
  assert.match(text(opened.ui), /Use path — ~\/Wo/);
  query(opened.ui, "~/Work/");
  await eventually(() => text(opened.ui).includes("~/Work/nested"));
  assert.doesNotMatch(text(opened.ui), /~\/Work\/(file|\.git|node_modules)/);
  await mkdir(join(work, "new-after-cache"));
  query(opened.ui, "~/Work/n");
  assert.doesNotMatch(text(opened.ui), /new-after-cache/);
  query(opened.ui, `${other}/`);
  query(opened.ui, "~/Work/");
  await setTimeout(30);
  assert.doesNotMatch(text(opened.ui), /outside/);
  opened.ui.handleInput("\x1b[B"); // Use path remains first; select a real child.
  opened.ui.handleInput("\r"); await opened.result;
  assert.equal(switches.at(-1).cwd, join(work, ".hidden"));
  opened = await open(); query(opened.ui, `${other}/`); await close(opened);
  const closedRenders = renders;
  await setTimeout(30); assert.equal(renders, closedRenders);
  opened.ui.handleInput("\r"); assert.equal(renders, closedRenders);
  opened = await open(); query(opened.ui, `${other}/`); opened.ui.dispose();
  const disposedRenders = renders; await setTimeout(30); assert.equal(renders, disposedRenders);
  opened.ui.handleInput("\r");
  dismiss(); await opened.result;
  // Host disposal completes the dialog itself; no selection or new session is published by disposed components.

  // Actual OS ENOENT invokes local fallback; EACCES does not. Missing both leaves explicit path selection useful.
  await rm(join(bin, "fd")); await installFd(join(agent, "bin/fd"));
  await configure({ scope: work }); opened = await open(); assert.match(text(opened.ui), /nested\/project/); await close(opened);
  await writeFile(join(bin, "fd"), "not executable"); await chmod(join(bin, "fd"), 0o644);
  const beforeDenied = (await calls()).length;
  opened = await open(); assert.match(text(opened.ui), /EACCES/); await close(opened); assert.equal((await calls()).length, beforeDenied);
  await rm(join(bin, "fd")); await rm(join(agent, "bin/fd"));
  opened = await open(); assert.match(text(opened.ui), /ENOENT/);
  query(opened.ui, `${other}/outside`); opened.ui.handleInput("\r"); await opened.result;
  assert.equal(switches.at(-1).cwd, join(other, "outside"));

  // Nonpicker command contract: config bypass, relative paths, validation, cancellation cleanup and guards.
  await configure("{");
  const beforeDirect = (await calls()).length;
  cancelled = true;
  await command.handler(" ../other ", ctx);
  const cancelledFork = switches.at(-1).path;
  await assert.rejects(access(cancelledFork), { code: "ENOENT" });
  assert.equal((await calls()).length, beforeDirect);
  assert.equal(await readFile(sourceFile, "utf8"), sourceText);
  cancelled = false;
  const switchCount = switches.length;
  await command.handler(".", ctx); assert.match(notices.at(-1)[0], /already in/);
  await command.handler(join(work, "file"), ctx); assert.match(notices.at(-1)[0], /Not a directory/);
  await command.handler(join(scratch, "absent"), ctx); assert.equal(notices.at(-1)[1], "error");
  ctx.mode = "rpc"; await command.handler("", ctx); assert.match(notices.at(-1)[0], /interactive mode/);
  await command.handler(other, ctx); assert.equal(switches.at(-1).cwd, other);
  ctx.sessionManager = SessionManager.inMemory(cwd); await command.handler(other, ctx); assert.match(notices.at(-1)[0], /unsaved/);
  assert.equal(switches.length, switchCount + 1);
  assert.equal(source.getCwd(), cwd);
  console.log("PASS: move command scoped discovery, explicit completion lifecycle, real ENOENT fallback, and session fork/switch contracts (host and fd process boundary controlled)");
} finally {
  for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(scratch, { recursive: true, force: true });
}
