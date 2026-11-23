// Public package runner: source, host initialization and all state stay isolated.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const feature = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const scratch = await mkdtemp(join(tmpdir(), "pi-context-test-"));
const source = join(scratch, "source", "context");
const env = { ...process.env, HOME: join(scratch, "home"), PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TODO_PATH: join(scratch, "todos"), PI_TEST_PACKAGE_ROOT: packageRoot };
try {
  await cp(feature, source, { recursive: true });
  await mkdir(env.HOME);
  await mkdir(env.PI_CODING_AGENT_DIR);
  console.log(`Context isolated test root: ${scratch}`);
  const failures = [];
  for (const suite of ["domain.mjs", "library.mjs", "projects.mjs", "tasks.mjs", "package.mjs"]) {
    const result = spawnSync(process.execPath, [join(source, "tests", suite)], { cwd: source, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) failures.push(`Context ${suite} failed${result.signal ? ` (${result.signal})` : ""}`);
  }
  assert.deepEqual(failures, []);
  console.log("PASS: standalone Context package, retained project/task suites and single-entry discovery; temporary state only.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
