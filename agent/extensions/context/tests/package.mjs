import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const feature = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "pi-context-package-"));
try {
  const agent = join(scratch, "agent");
  const entry = join(agent, "extensions", "context", "index.ts");
  await mkdir(agent);
  await cp(feature, dirname(entry), { recursive: true });
  const { discoverAndLoadExtensions } = await import(pathToFileURL(join(process.env.PI_TEST_PACKAGE_ROOT, "dist/core/extensions/loader.js")));
  const loaded = await discoverAndLoadExtensions([], scratch, agent);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.extensions.map(extension => extension.path), [entry]);
  const extension = loaded.extensions[0];
  for (const name of ["task", "todo", "todo_recap", "context", "context_knowledge", "context_link"]) assert.ok(extension.tools.has(name), name);
  assert.deepEqual([...extension.commands.keys()].sort(), ["context", "task", "todo"]);
  for (const name of ["context", "context_knowledge", "context_link"]) {
    const schema = extension.tools.get(name).definition.parameters;
    assert.equal(schema.type, "object");
    const check = value => { if (!value || typeof value !== "object") return; assert.ok(!value.anyOf && !value.oneOf && !value.allOf, `${name} schema must not use unions`); Object.values(value).forEach(check); };
    check(schema);
  }
  await assert.rejects(stat(join(process.env.PI_TODO_PATH, "todo.sqlite")), { code: "ENOENT" });
  console.log("PASS: one discovered Context entry owns current task/todo tools and commands, without initializing SQLite.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
