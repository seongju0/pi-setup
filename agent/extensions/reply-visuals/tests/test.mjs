// Real Pi loader, Markdown and Mermaid; no model calls or live state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const root = process.env.PI_TEST_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const moduleAt = path => import(pathToFileURL(join(root, path)));
const { loadExtensions, createExtensionRuntime } = await moduleAt("dist/core/extensions/loader.js");
const { Markdown, visibleWidth } = await moduleAt("node_modules/@earendil-works/pi-tui/dist/index.js");
const { initTheme, theme, getMarkdownTheme } = await moduleAt("dist/modes/interactive/theme/theme.js");
const { createMermaidMarkdownTransformer } = await moduleAt("dist/modes/interactive/components/mermaid.js");
const scratch = await mkdtemp(join(tmpdir(), "pi-reply-visuals-"));
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, "");
try {
  initTheme("dark", false);
  const loaded = await loadExtensions([join(directory, "index.ts")], scratch, undefined, createExtensionRuntime());
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.deepEqual([...extension.markdownTransformer.messageTypes], ["assistant"]);
  const transform = extension.markdownTransformer.transformer;
  const hook = extension.handlers.get("before_agent_start")[0];
  const context = { messageType: "assistant", isStreaming: false, availableWidth: 80 };
  assert.equal(transform("[[Done]]", context), "[[Done]]");
  const event = { systemPromptOptions: {} };
  await hook(event, { mode: "tui", ui: { theme } });
  const guidance = event.systemPromptOptions.sections.visual_replies;
  assert.match(guidance, /\[\[Done\]\]/);
  assert.match(guidance, /not on every reply/);
  await hook(event, { mode: "tui", ui: { theme } });
  assert.equal(event.systemPromptOptions.sections.visual_replies, guidance);

  const chip = transform("[[Done]] [[Passed 12/12]]", context);
  assert.notEqual(chip, "[[Done]] [[Passed 12/12]]");
  assert.equal(strip(chip).replaceAll("\u00a0", " "), " Done   Passed 12/12 ");
  const protectedSources = [
    "```sh\n[[Done]] **bold** →\n```", "- Nested\n    ```sh\n    [[Done]] **bold** →\n    ```",
    "    [[Done]] **bold** →\n", "`[[Done]] →`", "``one ` [[Done]] →``", "\\*\\*literal\\*\\*",
    "[label](https://example.com/a/**/[[Done]])", "<https://example.com/[[Done]]>", "https://example.com/[[Done]]",
    "src/**/*.ts", "[[ -f x ]] [[0]] [[Unknown]]", "[[Don", "**incomplete",
  ];
  for (const source of protectedSources) assert.equal(transform(source, { ...context, isStreaming: true }), source, source);
  assert.equal(transform("**Cause:** [[Blocked]]", context).includes("\x1b["), true);
  assert.match(strip(transform("> [!WARNING]\n> Keep the backup.", context)), /> \*\*WARNING:\*\*/);
  // Combining components must decorate their content, not merely fit a table at each width.
  const combined = "| Item | State |\n| --- | --- |\n| Build | [[Passed 12/12]] |\n| Literal | `[[Done]] →` |\n\n> [!WARNING]\n> [[Blocked]] by **x** →\n> Run the check.\n\n> plain [[Done]]";
  const decorated = transform(combined, context);
  assert.doesNotMatch(decorated, /\[\[(Passed|Blocked)/);
  assert.ok(decorated.includes("`[[Done]] →`"));
  assert.doesNotMatch(decorated, /> plain \[\[Done\]\]/);
  assert.equal(transform("> ```sh\n> [[Done]] **x** →\n> ```", context), "> ```sh\n> [[Done]] **x** →\n> ```");
  const combinedView = new Markdown(decorated, 0, 0, getMarkdownTheme()).render(80).join("\n");
  assert.doesNotMatch(strip(combinedView), /\[\[(Passed|Blocked)/);
  assert.match(strip(combinedView), /Passed 12\/12/);

  // Actual upstream Mermaid transformer runs first; even labels with backticks stay intact.
  const mermaid = createMermaidMarkdownTransformer({ getMode: () => "final", theme });
  const diagram = mermaid('```mermaid\ngraph LR\n A["plain ` tick"] --> B[Done]\n```', { ...context, availableWidth: 200 });
  assert.doesNotMatch(diagram, /```mermaid/);
  assert.equal(transform(diagram, context), diagram);
  const source = "**Checks**\n\n| Item | State |\n| --- | --- |\n| Build | [[Passed 12/12]] |\n| Review | [[Needs you]] |\n\n> [!NOTE]\n> Read the evidence.\n\n- [x] Inspect\n- [ ] Build";
  for (const width of [12, 40, 80]) {
    const markdown = new Markdown(source, 0, 0, getMarkdownTheme(), undefined, { transform: (text, availableWidth) => transform(text, { ...context, availableWidth }) });
    for (const line of markdown.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${strip(line)}`);
    markdown.invalidate();
    assert.ok(markdown.render(width).length);
  }
  // Rendering twice/reflowing never writes decorated text back to the source.
  assert.equal(transform(source, context), transform(source, context));
  await hook(event, { mode: "print", ui: {} });
  assert.equal(event.systemPromptOptions.sections.visual_replies, undefined);
  assert.equal(transform("[[Done]]", context), "[[Done]]");
  await hook(event, { mode: "rpc", ui: {} });
  assert.equal(event.systemPromptOptions.sections.visual_replies, undefined);
  console.log("reply visuals passed: real loader/hooks, Markdown/table widths, protected syntax, native Mermaid, TUI-only guidance");
} finally { await rm(scratch, { recursive: true, force: true }); }
