import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "darwin") {
  console.log("SKIP: Herdr reboot restore requires macOS.");
  process.exit(0);
}
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pi-restore-test-")));
const originalEnv = { ...process.env };
const originalArgv = process.argv;
const originalCwd = process.cwd();
const signals = ["SIGTERM", "SIGHUP"];
let baseline;
const home = join(scratch, "home");
const agentDir = join(scratch, "agent");
const bin = join(scratch, "bin");
const launchDir = join(scratch, "launch");
const cwd1 = join(scratch, "moved1");
const cwd2 = join(scratch, "moved2");
for (const path of [home, agentDir, bin, launchDir, cwd1, cwd2]) mkdirSync(path);
Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: agentDir, TMPDIR: scratch, PATH: `${bin}:${dirname(process.execPath)}`, HC_TERMINAL_ID: "t1", TEST_KEPT: "1" });
for (const key of ["HERDR_RESEARCH_DIR", "HERDR_RESEARCH_WORKER", "PI_HERDR_MANAGED", "PI_TODO_PATH"]) delete process.env[key];
const launchesFile = join(scratch, "launches.jsonl");
const fakePi = join(scratch, "fake-pi.mjs");
writeFileSync(fakePi, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(launchesFile)}, JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),agentDir:process.env.PI_CODING_AGENT_DIR})+'\\n');\n`);
writeFileSync(join(bin, "hc"), `#!${process.execPath}
const args = process.argv.slice(2);
const pane = { address: 't1', pid: Number(process.env.TEST_HC_PID), keep: process.env.TEST_KEPT !== '0', labels: process.env.TEST_HIDDEN === '1' ? {} : {'herdr.space':'sp1','herdr.tab':'tb1'} };
if (args[0] === 'server' && args[1] === 'status') console.log(JSON.stringify({core:{id:'core1'}}));
else if (args[0] === 'get') console.log(JSON.stringify(pane));
else if (args[0] === 'connect') {
  let data = ''; process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => { const r = JSON.parse(data); console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,...(r.method === 'terminal.label' ? {result:{ok:true}} : {error:{code:-32601,message:'unsupported test RPC'}})})); });
} else process.exit(1);
`, { mode: 0o700 });
const recordFile = join(home, ".local/state/pi-setup/herdr-sessions/core1/t1.json");
const systemFile = join(dirname(recordFile), "t1.system-prompt.md");
const appendFile = join(dirname(recordFile), "t1.append-system-prompt.md");
const record = () => JSON.parse(readFileSync(recordFile, "utf8"));
const launches = () => existsSync(launchesFile) ? readFileSync(launchesFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
function reboot() { writeFileSync(recordFile, JSON.stringify({ ...record(), bootId: "previous-boot" }), { mode: 0o600 }); }
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
function hook({ nested = false, kept = true, hidden = false } = {}) {
  const command = `export TEST_HC_PID=${nested ? "1" : "$$"}; source ${quote(join(directory, "restore.zsh"))}; print HOOK_DONE`;
  const result = spawnSync("/usr/bin/script", ["-q", "/dev/null", "/bin/zsh", "-f", "-i", "-c", command], {
    env: { ...process.env, TEST_KEPT: kept ? "1" : "0", TEST_HIDDEN: hidden ? "1" : "0" }, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + result.stderr;
  assert.match(output, /HOOK_DONE/);
  return output;
}
let runtime;
let modelRuntime;
try {
  process.chdir(launchDir);
  const { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, parseArgs, ModelRuntime, SettingsManager } = await import(pathToFileURL(join(packageRoot, "dist/index.js")));
  modelRuntime = await ModelRuntime.create({ authPath: join(scratch, "auth.json"), modelsPath: null, modelsStorePath: join(scratch, "models.json"), allowModelNetwork: false });
  baseline = signals.map(signal => process.listenerCount(signal));
  function manager(cwd = launchDir, saved = true) {
    const sm = SessionManager.create(cwd);
    if (saved) sm.appendMessage({ role: "user", content: [{ type: "text", text: "Synthetic saved conversation; never replay as task" }], timestamp: 1 });
    return sm;
  }
  async function start(sm, cli = []) {
    process.argv = [process.execPath, fakePi, ...cli];
    const parsed = parseArgs(process.argv.slice(2));
    const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: false } });
    const create = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager,
        resourceLoaderOptions: { additionalExtensionPaths: [join(directory, "index.ts")], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
          systemPrompt: parsed.systemPrompt, appendSystemPrompt: parsed.appendSystemPrompt } });
      assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
      const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    runtime = await createAgentSessionRuntime(create, { cwd: sm.getCwd(), agentDir, sessionManager: sm });
    const bind = session => session.bindExtensions({ mode: "tui", onError: error => { throw new Error(error.message); } });
    runtime.setRebindSession(bind);
    await bind(runtime.session);
    return runtime;
  }
  function parity(file, text) {
    assert.equal(readFileSync(file, "utf8"), text);
    assert(runtime.session.systemPrompt.includes(text), `live prompt must include snapshot ${JSON.stringify(text)}`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  async function move(cwd) {
    const fork = SessionManager.forkFrom(runtime.session.sessionManager.getSessionFile(), cwd);
    const file = fork.getSessionFile();
    assert.equal((await runtime.switchSession(file)).cancelled, false);
    assert.equal(runtime.cwd, cwd);
    assert.equal(record().sessionFile, file);
    return file;
  }
  async function quit() { await runtime.dispose(); runtime = undefined; }

  // A: real resource loader and runtime replacements, including relative prompt semantics.
  const guide = join(launchDir, "guide.md");
  writeFileSync(guide, "G1: explicit launch guidance");
  const sm0 = manager();
  await start(sm0, ["--session", sm0.getSessionFile(), "--model", "test/chosen", "--append-system-prompt", "guide.md", "--", "original task never replayed"]);
  parity(appendFile, "G1: explicit launch guidance");
  writeFileSync(join(cwd1, "guide.md"), "DECOY: wrong cwd");
  await move(cwd1);
  parity(appendFile, "G1: explicit launch guidance");
  writeFileSync(guide, "G2: updated guidance");
  await runtime.session.reload();
  parity(appendFile, "G2: updated guidance");
  unlinkSync(guide);
  // No replacement yet: deleting the original cannot erase the already-captured text.
  parity(appendFile, "G2: updated guidance");
  const f2 = await move(cwd2);
  parity(appendFile, "guide.md");
  assert(!runtime.session.systemPrompt.includes("G2: updated guidance"));
  const f2Id = runtime.session.sessionManager.getSessionId();
  process.emit("SIGTERM");
  await quit();
  assert.equal(record().eligible, true);
  hook(); assert.equal(launches().length, 0, "same boot stays inert");
  reboot();
  const beforeNested = readFileSync(recordFile, "utf8");
  hook({ nested: true }); hook({ kept: false }); hook({ hidden: true });
  assert.equal(readFileSync(recordFile, "utf8"), beforeNested, "wrong shell/non-kept/hidden terminal cannot consume");
  const statusResult = spawnSync(process.execPath, [join(directory, "restore.mjs"), "status"], { env: process.env, encoding: "utf8" });
  assert.equal(statusResult.status, 0);
  assert.deepEqual(JSON.parse(statusResult.stdout), { sessionFile: f2, cwd: cwd2, eligible: true, unsupported: [] });
  assert.equal(readFileSync(recordFile, "utf8"), beforeNested, "status is read-only");
  hook();
  assert.deepEqual(launches(), [{ argv: [fakePi, "--append-system-prompt", appendFile, "--session", f2], cwd: cwd2, agentDir }]);
  assert.equal(record().sessionId, f2Id);
  assert.equal(record().eligible, false);
  hook(); assert.equal(launches().length, 1, "record consumed exactly once");
  assert.equal(statSync(recordFile).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(recordFile)).mode & 0o777, 0o700);
  console.log("PASS A: real startup, two moves, reload, private prompt parity, root membership, status and one reboot restore.");

  // B: resumed idle session needs no provider turn; Pi-shaped signal listener ordering.
  const sm3 = manager();
  const f3 = sm3.getSessionFile();
  const cliB = ["--session", f3, "--system-prompt", "custom: explicit system", "--offline", "--models", "a,b", "--tui-mode", "regular"];
  writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "Discovered append stays dynamic");
  await start(SessionManager.open(f3), cliB);
  parity(systemFile, "custom: explicit system");
  assert(runtime.session.systemPrompt.includes("Discovered append stays dynamic"));
  assert(!existsSync(appendFile), "discovered append text is not captured; stale CLI snapshot removed");
  let disposal;
  const asyncHup = () => { disposal = (async () => { await Promise.resolve(); await quit(); })(); };
  process.prependListener("SIGHUP", asyncHup);
  process.emit("SIGHUP");
  await disposal;
  process.removeListener("SIGHUP", asyncHup);
  reboot(); hook();
  assert.deepEqual(launches().at(-1), { argv: [fakePi, "--offline", "--models", "a,b", "--tui-mode", "regular", "--system-prompt", systemFile, "--session", f3], cwd: launchDir, agentDir });
  await start(SessionManager.open(f3), cliB);
  // Force the opposite ordering through the real shutdown dispatcher, without bypassing recorder decisions.
  const syncHup = () => { void runtime.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); };
  process.prependListener("SIGHUP", syncHup);
  process.emit("SIGHUP");
  process.removeListener("SIGHUP", syncHup);
  assert.equal(record().eligible, true, "signal observer re-arms after synchronous quit");
  await quit();
  await start(SessionManager.open(f3), cliB);
  await quit();
  assert.equal(record().eligible, false);
  const countB = launches().length;
  reboot(); hook(); assert.equal(launches().length, countB, "normal quit stays disarmed across reboot");
  assert.deepEqual(signals.map(signal => process.listenerCount(signal)), baseline);
  const interactive = readFileSync(join(packageRoot, "dist/modes/interactive/interactive-mode.js"), "utf8");
  const disposalSource = readFileSync(join(packageRoot, "dist/core/agent-session-runtime.js"), "utf8").split("async dispose() {")[1];
  const abortIndex = disposalSource?.indexOf("await this.session.abort()") ?? -1;
  const quitIndex = disposalSource?.indexOf('reason: "quit"') ?? -1;
  assert(interactive.includes("process.prependListener(signal, handler)") && interactive.includes("shutdown({ fromSignal: true })") &&
    abortIndex >= 0 && quitIndex > abortIndex, "re-verify restore eligibility ordering");
  console.log("PASS B: idle resume, both signal orderings, quit disarm and installed Pi signal contract.");

  // C: unsupported, missing/mismatched target and unsafe private state leave a working shell.
  const countC = launches().length;
  async function arm(sm, cli = []) { await start(sm, cli); process.emit("SIGTERM"); await quit(); reboot(); }
  await arm(SessionManager.open(f3), ["--tools", "read", "--api-key", "PRIVATE_TEST_SECRET"]);
  assert.deepEqual(record().unsupported, ["--api-key", "--tools"]);
  assert(!readFileSync(recordFile, "utf8").includes("PRIVATE_TEST_SECRET"));
  assert.match(hook(), /not restored.*--tools/);
  assert.equal(record().eligible, false);
  const blank = manager(launchDir, false);
  await arm(blank, ["--system-prompt", "blank: explicit"]);
  assert(!existsSync(blank.getSessionFile()), "real Pi session remains lazy without a conversation");
  assert.match(hook(), /not restored.*session file/); assert.equal(record().eligible, false);
  const mismatch = manager();
  await arm(mismatch);
  const content = readFileSync(mismatch.getSessionFile(), "utf8");
  const lines = content.split("\n");
  lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), id: "another-session" });
  writeFileSync(mismatch.getSessionFile(), lines.join("\n"));
  assert.match(hook(), /not restored.*header/); assert.equal(record().eligible, false);
  writeFileSync(mismatch.getSessionFile(), content);
  await arm(SessionManager.open(mismatch.getSessionFile()));
  lines[0] = JSON.stringify({ ...JSON.parse(content.split("\n")[0]), cwd: cwd2 });
  writeFileSync(mismatch.getSessionFile(), lines.join("\n"));
  assert.match(hook(), /not restored.*header/); assert.equal(record().eligible, false);
  await arm(SessionManager.open(f3), cliB);
  chmodSync(systemFile, 0o644);
  assert.match(hook(), /not restored.*prompt/); assert.equal(record().eligible, false);
  chmodSync(systemFile, 0o600);
  // Recorder failure must not leave the preceding, different session armed.
  await arm(SessionManager.open(f3), cliB);
  unlinkSync(systemFile); symlinkSync(guide, systemFile);
  const other = manager(cwd1);
  await start(other, ["--system-prompt", "new association"]);
  assert.equal(record().eligible, false, "snapshot failure invalidates old session");
  await quit(); unlinkSync(systemFile);
  assert.equal(launches().length, countC);
  // Hidden and non-kept Pi starts are not admitted even when HC_TERMINAL_ID is set.
  unlinkSync(recordFile);
  process.env.TEST_KEPT = "0";
  await start(SessionManager.open(f3)); await quit(); assert(!existsSync(recordFile));
  process.env.TEST_KEPT = "1"; process.env.TEST_HIDDEN = "1";
  await start(SessionManager.open(f3)); await quit(); assert(!existsSync(recordFile));
  delete process.env.TEST_HIDDEN;
  assert.deepEqual(signals.map(signal => process.listenerCount(signal)), baseline);
  console.log("PASS C: rejected flags stay private; lazy/mismatched sessions, unsafe snapshots and ineligible panes never launch.");
} finally {
  if (runtime) await runtime.dispose();
  process.chdir(originalCwd);
  process.argv = originalArgv;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  rmSync(scratch, { recursive: true, force: true });
}
