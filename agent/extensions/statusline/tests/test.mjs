// Native Node tests: real extension lifecycle/rendering + installed pi-tui helpers.
// Only Pi's host API, terminal/theme and Git process boundary are synthetic.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = process.env.PI_TEST_PACKAGE_ROOT || join(
	execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
	"@earendil-works/pi-coding-agent",
);
const requirePi = createRequire(join(root, "package.json"));
const tuiURL = pathToFileURL(requirePi.resolve("@earendil-works/pi-tui")).href;
const codingURL = pathToFileURL(join(root, "dist/index.js")).href;
const hostModules = () => registerHooks({
	resolve(specifier, context, next) {
		const url = specifier === "@earendil-works/pi-tui" ? tuiURL
			: specifier === "@earendil-works/pi-coding-agent" ? codingURL : undefined;
		return url ? { url, shortCircuit: true } : next(specifier, context);
	},
});
const hook = hostModules();
const { default: install } = await import("../index.ts");
hook.deregister();
const { visibleWidth, stripTerminalSequences } = await import(tuiURL);
const plain = stripTerminalSequences;
const tick = () => new Promise(resolve => setImmediate(resolve));

function host(mode = "tui", branch = "main", installExtension = install) {
	const handlers = new Map();
	const calls = [];
	const subscribers = new Set();
	const statuses = new Map();
	const indicators = [], messages = [], notifications = [];
	let component;
	let editorFactory;
	let entries = [];
	let leaf = null;
	let branchReads = 0;
	let revision = 0;
	let renders = 0;
	let thinking = "high";
	let usage = { tokens: 100_000, percent: 50, contextWindow: 200_000 };
	const ctx = {
		mode, cwd: "/projects/工作🌿", model: { id: "claude-sonnet-5-5", contextWindow: 200_000 },
		getContextUsage: () => usage,
		sessionManager: { getLeafId: () => leaf, getBranch: () => { branchReads++; return entries; } },
		ui: {
			setWorkingIndicator(value) { indicators.push(value); },
			setWorkingMessage(value) { messages.push(value); },
			notify(...args) { notifications.push(args); },
			setEditorComponent(factory) { editorFactory = factory; }, setFooter(factory) {
			component?.dispose();
			component = factory({ requestRender: () => renders++ }, {
				fg: (color, text) => `\x1b[${({ muted: 2, borderMuted: 90, warning: 33, error: 31 })[color]}m${text}\x1b[0m`,
			}, {
				getGitBranch: () => branch,
				getExtensionStatuses: () => statuses,
				onBranchChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
			});
		} },
	};
	installExtension({
		on: (event, fn) => handlers.set(event, fn),
		getThinkingLevel: () => thinking,
		exec(command, args, options) {
			return new Promise((resolve, reject) => calls.push({ command, args, options, resolve, reject }));
		},
	});
	return {
		ctx, calls, statuses, subscribers, indicators, messages, notifications,
		emit: (event, payload = {}) => handlers.get(event)?.(payload, ctx),
		get component() { return component; },
		get editorFactory() { return editorFactory; },
		get branchReads() { return branchReads; },
		set entries(value) { entries = value; leaf = `${++revision}`; },
		get renders() { return renders; },
		set usage(value) { usage = value; },
		set thinking(value) { thinking = value; },
		branch(value) { branch = value; for (const fn of subscribers) fn(); },
	};
}
const result = (stdout = "", rest = {}) => ({ code: 0, killed: false, truncated: false, stdout, ...rest });

test("interactive-only footer; live wide/narrow Unicode, ANSI and context semantics", async () => {
	for (const mode of ["rpc", "json", "print"]) {
		const h = host(mode);
		h.emit("session_start");
		assert.equal(h.component, undefined);
		assert.equal(h.calls.length, 0);
		h.emit("agent_start");
		h.emit("agent_settled");
		assert.deepEqual(h.indicators, []);
		assert.deepEqual(h.messages, []);
	}
	const h = host();
	h.emit("session_start");
	assert.equal(h.calls.length, 1);
	h.calls[0].resolve(result(" M index.ts\n"));
	await tick();
	assert.match(plain(h.component.render(100)[0]), /工作🌿 \(main\*\).*claude-sonnet-5-5 · high · ctx 50%\/200k · cache —$/);
	h.statuses.set("todo", "\x1b[36mTODO " + "長い".repeat(70) + "\x1b[0m");
	h.statuses.set("on-call-mode", "\x1b[31mON-CALL · ⚠ unsafe\nprovider\x1b[0m");
	const lines = h.component.render(100);
	assert.equal(lines[1], `\x1b[90m  ${"─".repeat(96)}  \x1b[0m`, "subtle divider is centered with a two-column inset");
	assert.equal(lines.length, 4, "main status, divider and one row per extension");
	assert.equal(plain(lines[2]), "ON-CALL · ⚠ unsafe provider");
	assert.match(plain(lines[3]), /^TODO /);
	assert.ok(lines[2].includes("\x1b[31m"), "keep warning status ANSI");
	assert.ok(lines[3].includes("\x1b[2mTODO"), "TODO uses the footer's live muted theme");
	assert.ok(!lines[3].includes("\x1b[36m"), "TODO publisher colors do not override the footer style");
	for (const width of [0, 1, 4, 9, 15, 24, 40, 80, 120]) {
		for (const line of h.component.render(width)) {
			assert.ok(visibleWidth(line) <= width, `fits ${width}: ${JSON.stringify(line)}`);
			assert.ok(!/[\r\n]/.test(line));
		}
	}
	assert.match(plain(h.component.render(24)[0]), /ctx 50%\/200k$/);
	assert.match(plain(h.component.render(24)[2]), /^ON-CALL/);
	h.statuses.clear();
	assert.equal(h.component.render(100).length, 1, "no divider without status info");
	h.usage = { tokens: null, percent: null, contextWindow: 200_000 };
	assert.match(plain(h.component.render(100)[0]), /ctx \?\/200k/);
	h.usage = undefined;
	assert.match(plain(h.component.render(100)[0]), /ctx \?\/200k/);
	for (const [percent, color] of [[69, 2], [70, 33], [90, 31]]) {
		h.usage = { tokens: percent * 2000, percent, contextWindow: 200_000 };
		assert.ok(h.component.render(100)[0].includes(`\x1b[${color}mctx ${percent}%/200k`));
	}
	h.ctx.model.id = "模型🌿e\u0301-very-long-id";
	h.thinking = "off";
	h.emit("model_select");
	h.emit("thinking_level_select");
	assert.match(plain(h.component.render(100)[0]), /模型🌿é-very-long-id · off/);
	assert.ok(visibleWidth(h.component.render(24)[0]) <= 24);
	h.emit("session_shutdown");
});

test("loader presets/custom frames and one phrase per run; config errors restore native loader", async t => {
	const dir = mkdtempSync(join(tmpdir(), "statusline-loader-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	copyFileSync(new URL("../index.ts", import.meta.url), join(dir, "index.ts"));
	copyFileSync(new URL("../spinners.ts", import.meta.url), join(dir, "spinners.ts"));
	const configPath = join(dir, "loader.json");
	const config = { spinner: "native", frames: [".", "o", "O", "o"], intervalMs: 200, messages: ["First phrase", "Second phrase"] };
	writeFileSync(configPath, JSON.stringify(config));
	const hook = hostModules();
	let fixtureInstall;
	try { fixtureInstall = (await import(pathToFileURL(join(dir, "index.ts")).href)).default; }
	finally { hook.deregister(); }
	let roll = 0;
	t.mock.method(Math, "random", () => roll);
	const h = host("tui", null, fixtureInstall);
	h.emit("session_start");
	assert.deepEqual(h.indicators.at(-1), { frames: config.frames, intervalMs: 200 });
	assert.deepEqual(h.notifications, []);
	h.emit("agent_start");
	assert.equal(h.messages.at(-1), "First phrase");
	const count = h.messages.length;
	h.component.render(80);
	h.emit("tool_execution_end", { toolName: "read" });
	assert.equal(h.messages.length, count, "no word cycling during rendering/tools");
	h.emit("agent_settled");
	assert.equal(h.messages.at(-1), undefined, "settled runs restore the native message");
	roll = 0.999;
	h.emit("agent_start");
	assert.equal(h.messages.at(-1), "Second phrase");
	h.emit("agent_settled");
	const { SPINNERS } = await import("../spinners.ts");
	for (const spinner of ["scan", "stack"]) {
		writeFileSync(configPath, JSON.stringify({ spinner, intervalMs: 150, messages: ["Preset phrase"] }));
		h.emit("session_start");
		assert.deepEqual(h.indicators.at(-1), { frames: [...SPINNERS[spinner]], intervalMs: 150 });
		assert.ok(h.indicators.at(-1).frames.length > 1);
		const expectedWidth = spinner === "scan" ? 5 : 6;
		assert.ok(h.indicators.at(-1).frames.every(frame => visibleWidth(frame) === expectedWidth));
	}
	writeFileSync(configPath, JSON.stringify({ spinner: "native", intervalMs: 150, messages: ["Native phrase"] }));
	h.emit("session_start");
	assert.equal(h.indicators.at(-1), undefined, "native delegates to Pi rather than copying its frame data");
	h.emit("agent_start");
	assert.equal(h.messages.at(-1), "Native phrase", "native spinner retains configured words");
	for (const invalid of ["{", "null", JSON.stringify({ spinner: "braille", intervalMs: 80, messages: ["Test"] }),
		JSON.stringify({ spinner: "__proto__", intervalMs: 80, messages: ["Test"] }), JSON.stringify({ ...config, messages: [] }),
		JSON.stringify({ ...config, frames: ["bad\nframe"] }), JSON.stringify({ ...config, intervalMs: 0 })]) {
		writeFileSync(configPath, invalid);
		h.emit("session_start");
		assert.equal(h.indicators.at(-1), undefined, "bad config resets the indicator");
		assert.equal(h.notifications.at(-1)[1], "warning");
		const count = h.messages.length;
		h.emit("agent_start");
		assert.equal(h.messages.length, count, "old custom phrases do not survive an invalid reload");
		assert.ok(h.component.render(80).length > 0, "config errors do not disable the footer");
	}
	writeFileSync(configPath, JSON.stringify({ ...config, messages: ["Restored"] }));
	h.emit("session_start");
	h.emit("agent_start");
	assert.equal(h.messages.at(-1), "Restored", "fixed configuration is read on reload");
	h.emit("session_shutdown");
});

test("cache uses latest active-branch call, counts writes in denominator and yields to context", () => {
	const h = host("tui", null);
	h.emit("session_start");
	const assistant = usage => ({ type: "message", message: { role: "assistant", usage } });
	assert.match(plain(h.component.render(120)[0]), /cache —$/);
	h.entries = [assistant({ input: 60, cacheRead: 30, cacheWrite: 10, output: 900 })];
	assert.match(plain(h.component.render(120)[0]), /cache 30%$/);
	const reads = h.branchReads;
	h.component.render(120);
	assert.equal(h.branchReads, reads, "unchanged branch is not rescanned per frame");
	h.entries = [assistant({ input: 1, cacheRead: 99, cacheWrite: 0 }),
		assistant({ input: 100, cacheRead: 0, cacheWrite: 0 }),
		{ type: "message", message: { role: "toolResult" } }];
	assert.match(plain(h.component.render(120)[0]), /cache 0%$/);
	h.entries = [assistant({ input: 0, cacheRead: 0, cacheWrite: 100 })];
	assert.match(plain(h.component.render(120)[0]), /cache 0%$/);
	for (const usage of [undefined, { input: 0, cacheRead: 0, cacheWrite: 0 }, { input: 2 },
		{ input: 2, cacheRead: NaN, cacheWrite: 0 }]) {
		h.entries = [assistant({ input: 1, cacheRead: 99, cacheWrite: 0 }), assistant(usage)];
		assert.match(plain(h.component.render(120)[0]), /cache —$/, "do not fall back to an older call");
	}
	const compact = plain(h.component.render(24)[0]);
	assert.ok(!compact.includes("cache"));
	assert.match(compact, /ctx 50%\/200k$/);
	h.entries = [];
	assert.match(plain(h.component.render(120)[0]), /cache —$/);
	h.emit("session_shutdown");
});

test("native editor spaces the top border while keeping cursor, mouse and app shortcuts", async () => {
	const { CustomEditor, initTheme, getSelectListTheme } = await import(codingURL);
	const { KeybindingsManager } = await import(pathToFileURL(join(root, "dist/core/keybindings.js")).href);
	initTheme("dark", false);
	const h = host("tui", null);
	h.emit("session_start");
	const tui = { requestRender() {}, terminal: { rows: 30, columns: 80 } };
	const theme = { borderColor: text => text, selectList: getSelectListTheme() };
	const keys = new KeybindingsManager();
	const spaced = h.editorFactory(tui, theme, keys);
	const native = new CustomEditor(tui, theme, keys, { embedWorkingStatus: true });
	for (const editor of [spaced, native]) {
		editor.setPaddingX(3);
		editor.setText("abc\n한글é");
		editor.focused = true;
		editor.setWorkingStatusIndicator({ renderInBorder: () => "Working", renderSpinnerInBorder: () => "*" });
	}
	for (const width of [12, 80]) {
		const base = native.render(width);
		assert.deepEqual(spaced.render(width), ["", base[0], "", ...base.slice(1)], "one gap above and below the border preserves native cursor/input lines");
	}
	assert.match(plain(spaced.render(80)[1]), /Working/);
	const click = { type: "click", button: "left", x: 4, y: 1, width: 80, height: 6 };
	native.handleMouse(click);
	spaced.handleMouse({ ...click, y: 3 });
	assert.deepEqual(spaced.getCursor(), native.getCursor(), "mouse coordinates follow both inserted gaps");
	spaced.handleInput("X");
	native.handleInput("X");
	assert.equal(spaced.getText(), native.getText());
	let escaped = false;
	spaced.onEscape = () => { escaped = true; };
	spaced.handleInput("\x1b");
	assert.ok(escaped, "native interrupt shortcut survives");
	h.emit("session_shutdown");
});

test("Git is bounded, read-only and never runs in render; failures clear stale dirty", async () => {
	const h = host();
	h.emit("session_start");
	const first = h.calls[0];
	assert.equal(first.command, "git");
	assert.deepEqual(first.args, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal"]);
	assert.equal(first.options.cwd, h.ctx.cwd);
	assert.equal(first.options.timeout, 1500);
	assert.equal(first.options.maxBuffer, 65536);
	first.resolve(result("?? new.ts\n"));
	await tick();
	assert.match(plain(h.component.render(100)[0]), /main\*/);
	for (let i = 0; i < 5; i++) h.component.render(40);
	assert.equal(h.calls.length, 1);
	h.emit("tool_execution_end", { toolName: "read" });
	assert.equal(h.calls.length, 1);
	h.emit("tool_execution_end", { toolName: "bash" });
	h.calls.at(-1).resolve(result("", { code: 128 }));
	await tick();
	assert.doesNotMatch(plain(h.component.render(100)[0]), /main\*/);
	h.emit("agent_settled");
	h.calls.at(-1).resolve(result());
	await tick();
	assert.doesNotMatch(plain(h.component.render(100)[0]), /main\*/);
	h.branch("topic");
	h.calls.at(-1).reject(new Error("timeout"));
	await tick();
	assert.match(plain(h.component.render(100)[0]), /\(topic\)/);
	h.emit("session_shutdown");
});

test("branch refresh ignores out-of-order completions and disposal aborts/unsubscribes", async () => {
	const h = host();
	h.emit("session_start");
	const old = h.calls[0];
	h.branch("new-branch");
	assert.ok(old.options.signal.aborted);
	h.calls[1].resolve(result());
	await tick();
	old.resolve(result(" M stale.ts\n"));
	await tick();
	assert.match(plain(h.component.render(100)[0]), /\(new-branch\)/);
	h.emit("agent_settled");
	const pending = h.calls.at(-1);
	h.component.dispose();
	h.emit("session_shutdown");
	assert.ok(pending.options.signal.aborted);
	assert.equal(h.subscribers.size, 0);
	const renders = h.renders;
	pending.resolve(result(" M late.ts\n"));
	await tick();
	h.emit("agent_settled");
	h.branch("later");
	assert.equal(h.renders, renders);
	assert.equal(h.calls.length, 3);
});

test("non-repository is normal and losing a repository clears dirty", async () => {
	const h = host("tui", null);
	h.emit("session_start");
	assert.equal(h.calls.length, 0);
	assert.match(plain(h.component.render(100)[0]), /^工作🌿\s+claude/);
	h.branch("main");
	h.calls[0].resolve(result(" M file\n"));
	await tick();
	assert.match(plain(h.component.render(100)[0]), /main\*/);
	h.branch(null);
	assert.equal(h.calls.length, 1);
	assert.doesNotMatch(plain(h.component.render(100)[0]), /main|\*/);
	h.emit("session_shutdown");
});
