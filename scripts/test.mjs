import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const piRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const scratch = await mkdtemp(join(tmpdir(), "pi-setup-test-"));
const before = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_TODO_PATH: process.env.PI_TODO_PATH };
const env = { ...process.env, HOME: join(scratch, "home"), PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TODO_PATH: join(scratch, "todos"), PI_TEST_PACKAGE_ROOT: piRoot };

async function itemDirectories(root, entry) {
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const path = join(root, item.name);
    try { await access(join(path, entry)); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    result.push(path);
  }
  return result.sort();
}

try {
  for (const path of [env.HOME, env.PI_CODING_AGENT_DIR]) await mkdir(path);
  for (const key of Object.keys(before)) process.env[key] = env[key];
  const extensions = await itemDirectories(join(repo, "agent/extensions"), "index.ts");
  const skillDirs = await itemDirectories(join(repo, "agent/skills"), "SKILL.md");
  assert.ok(extensions.length > 0);
  assert.ok(skillDirs.length > 0);

  // Exercise adoption by copying source, preserving sibling dependencies. Real
  // Pi discovery must load entries, not lib/ or nested tests/. No lifecycle hooks
  // are fired: no provider calls, browser actions or installed user-state access.
  await cp(join(repo, "agent/extensions"), join(env.PI_CODING_AGENT_DIR, "extensions"), { recursive: true });
  await cp(join(repo, "agent/skills"), join(env.PI_CODING_AGENT_DIR, "skills"), { recursive: true });
  const { discoverAndLoadExtensions } = await import(pathToFileURL(join(piRoot, "dist/core/extensions/loader.js")));
  const loaded = await discoverAndLoadExtensions([], scratch, env.PI_CODING_AGENT_DIR);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.extensions.map(extension => extension.path).sort(), extensions.map(path => join(env.PI_CODING_AGENT_DIR, "extensions", basename(path), "index.ts")).sort());
  assert.ok(loaded.extensions.some(extension => extension.tools.has("session_history")));
  const context = loaded.extensions.filter(extension => extension.tools.has("context_project_recap"));
  assert.equal(context.length, 1);
  assert.equal(basename(dirname(context[0].path)), "context");
  assert.ok(context[0].tools.has("task"));
  assert.ok(!loaded.extensions.some(extension => ["task", "todo"].includes(basename(dirname(extension.path)))));
  assert.ok(!loaded.extensions.some(extension => extension.commands.has("skills")), "Copied catalog does not register the retired skill-updater command");
  console.log(`PASS: all ${extensions.length} copied extension entry points load through Pi discovery; support files are not extensions.`);

  const { loadSkills } = await import(pathToFileURL(join(piRoot, "dist/core/skills.js")));
  const skills = loadSkills({ cwd: scratch, agentDir: env.PI_CODING_AGENT_DIR, skillPaths: [join(env.PI_CODING_AGENT_DIR, "skills")], includeDefaults: false });
  assert.deepEqual(skills.diagnostics, []);
  assert.equal(skills.skills.length, skillDirs.length);
  const authed = skills.skills.filter(skill => skill.name === "authed-browser");
  assert.equal(authed.length, 1);
  assert.equal(authed[0].disableModelInvocation, false);
  assert.equal(authed[0].filePath, join(env.PI_CODING_AGENT_DIR, "skills/authed-browser/SKILL.md"));
  console.log(`PASS: all ${skills.skills.length} copied skills load; authed-browser is discoverable for model selection.`);

  let suites = 0;
  for (const path of extensions) {
    const test = join(path, "tests/test.mjs");
    try { await access(test); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    console.log(`\n--- ${path.slice(repo.length + 1)} ---`);
    const result = spawnSync(process.execPath, [test], { cwd: repo, env, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${path} suite failed${result.signal ? ` (${result.signal})` : ""}`);
    suites++;
  }
  for (const suite of ["tests/checkout.test.mjs", "agent/extensions/herdr-session/tests/restore.test.mjs"]) {
    const result = spawnSync(process.execPath, [join(repo, suite)], { cwd: repo, env, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${suite} flow checks failed`);
  }
  console.log(`\nPASS: copied-resource discovery, ${suites} retained extension suites, checkout and reboot-restore flows; temporary state only.`);
} finally {
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
}
