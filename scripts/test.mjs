import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = JSON.parse(await readFile(join(repo, "manifests/resources.json"), "utf8"));
const piRoot = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const scratch = await mkdtemp(join(tmpdir(), "pi-setup-test-"));
const before = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_TODO_PATH: process.env.PI_TODO_PATH };
const env = { ...process.env, HOME: join(scratch, "home"), PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TODO_PATH: join(scratch, "todos"), PI_TEST_PACKAGE_ROOT: piRoot };

try {
  for (const path of [env.HOME, env.PI_CODING_AGENT_DIR]) await mkdir(path);
  for (const key of Object.keys(before)) process.env[key] = env[key];
  for (const path of resources.instructions) await access(join(repo, path));
  for (const path of resources.skills) await access(join(repo, path, "SKILL.md"));
  for (const path of resources.support) await access(join(repo, path));

  // Real Pi loader, no session_start, provider calls, or user-state access.
  const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(piRoot, "dist/core/extensions/loader.js")));
  const entries = resources.extensions.map(path => extname(path) ? join(repo, path) : join(repo, path, "index.ts"));
  const loaded = await loadExtensions(entries, scratch, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, entries.length);
  console.log(`PASS: all ${entries.length} foundation extension entry points load.`);

  let suites = 0;
  for (const path of resources.extensions) {
    const test = join(extname(path) ? dirname(join(repo, path)) : join(repo, path), "tests/test.mjs");
    try { await access(test); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    console.log(`\n--- ${path} ---`);
    const result = spawnSync(process.execPath, [test], { cwd: repo, env, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${path} suite failed${result.signal ? ` (${result.signal})` : ""}`);
    suites++;
  }
  for (const suite of ["setup", "client", "tools", "checkout"]) {
    const result = spawnSync(process.execPath, [join(repo, `tests/${suite}.test.mjs`)], { cwd: repo, env, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${suite} flow checks failed`);
  }
  console.log(`\nPASS: loader check, ${suites} retained suites, and setup/client/tool/checkout flows; temporary state only.`);
} finally {
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
}
