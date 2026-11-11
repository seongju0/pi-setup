import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { SPINNERS } from "./spinners.ts";

// Keep native input, shortcuts, completion and embedded loader; add only a gap.
class SpacedEditor extends CustomEditor {
	render(width: number): string[] {
		const lines = super.render(width);
		lines.splice(1, 0, "");
		return lines;
	}

	handleMouse(event: TuiMouseEvent) {
		return super.handleMouse({ ...event, y: Math.max(0, event.y - 1) });
	}
}

// Keep existing status ANSI styling, but never let a status create extra rows.
const oneLine = (text: string) => text.replace(/[\r\n\t\u2028\u2029]+/g, " ");
const capacity = (n: number) => n >= 1_000_000
	? `${+(n / 1_000_000).toFixed(1)}m`
	: n >= 1_000 ? `${+(n / 1_000).toFixed(1)}k` : `${n}`;

type LoaderConfig = { frames?: string[]; intervalMs: number; messages: string[] };

function readLoaderConfig(): LoaderConfig {
	const config = JSON.parse(readFileSync(new URL("./loader.json", import.meta.url), "utf8"));
	const singleLines = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 &&
		value.every(text => typeof text === "string" && text.trim().length > 0 && !/[\x00-\x1f\x7f\u2028\u2029]/.test(text));
	const custom = config?.frames !== undefined;
	const native = !custom && config?.spinner === "native";
	const frames = custom ? config.frames : (typeof config?.spinner === "string" && Object.hasOwn(SPINNERS, config.spinner)
		? [...SPINNERS[config.spinner]] : undefined);
	if (!config || (!native && !singleLines(frames)) || !singleLines(config.messages) ||
		!Number.isInteger(config.intervalMs) || config.intervalMs <= 0 || config.intervalMs > 2_147_483_647) {
		throw new Error("Expected a known spinner or custom frames, messages and a positive intervalMs");
	}
	return { frames, intervalMs: config.intervalMs, messages: config.messages };
}

export default function personalStatus(pi: ExtensionAPI) {
	let loader: LoaderConfig | undefined;
	let refresh: (() => void) | undefined;
	let dispose: (() => void) | undefined;
	let requestRender: (() => void) | undefined;

	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		if (ctx.mode !== "tui") return;

		loader = undefined;
		ctx.ui.setWorkingMessage();
		try {
			loader = readLoaderConfig();
			ctx.ui.setWorkingIndicator(loader.frames ? { frames: loader.frames, intervalMs: loader.intervalMs } : undefined);
		} catch {
			ctx.ui.setWorkingIndicator();
			ctx.ui.notify("personal-status: invalid or unreadable loader.json; using the native loader. Fix the file and /reload.", "warning");
		}
		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new SpacedEditor(tui, theme, keybindings, { embedWorkingStatus: true }));
		ctx.ui.setFooter((tui, theme, footerData) => {
			let cacheLeaf: string | null | undefined;
			let cacheRate: number | undefined;
			const cacheLabel = () => {
				const leaf = ctx.sessionManager.getLeafId();
				if (leaf !== cacheLeaf) {
					cacheLeaf = leaf;
					cacheRate = undefined;
					const entries = ctx.sessionManager.getBranch();
					for (let i = entries.length - 1; i >= 0; i--) {
						const entry = entries[i];
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						const usage = entry.message.usage;
						if (!usage) break;
						const { input, cacheRead, cacheWrite } = usage;
						const total = input + cacheRead + cacheWrite;
						if ([input, cacheRead, cacheWrite].every(n => Number.isFinite(n) && n >= 0) && total > 0) {
							cacheRate = cacheRead / total * 100;
						}
						break;
					}
				}
				return theme.fg("muted", `cache ${cacheRate === undefined ? "—" : `${Math.round(cacheRate)}%`}`);
			};
			let disposed = false;
			let generation = 0;
			let controller: AbortController | undefined;
			let dirty: boolean | undefined;
			const redraw = () => { if (!disposed) tui.requestRender(); };
			const updateDirty = async () => {
				const current = ++generation;
				controller?.abort();
				controller = new AbortController();
				dirty = undefined;
				redraw();
				if (!footerData.getGitBranch()) return;
				try {
					const result = await pi.exec("git", [
						"--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal",
					], { cwd: ctx.cwd, timeout: 1500, maxBuffer: 64 * 1024, signal: controller.signal });
					if (disposed || current !== generation) return;
					dirty = result.code === 0 && !result.killed && !result.truncated
						? result.stdout.length > 0 : undefined;
				} catch {
					if (disposed || current !== generation) return;
					dirty = undefined;
				}
				redraw();
			};
			const triggerRefresh = () => { if (!disposed) void updateDirty(); };
			const unsubscribe = footerData.onBranchChange(triggerRefresh);
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				generation++;
				controller?.abort();
				unsubscribe();
				if (refresh === triggerRefresh) {
					refresh = undefined;
					requestRender = undefined;
				}
			};
			refresh = triggerRefresh;
			dispose = cleanup;
			requestRender = redraw;
			triggerRefresh();

			return {
				dispose: cleanup,
				invalidate() {}, // No themed/layout cache: every render uses live host data.
				render(width: number): string[] {
					if (width <= 0) return [""];
					const usage = ctx.getContextUsage();
					const percent = usage?.percent;
					const known = percent != null && Number.isFinite(percent);
					const window = usage?.contextWindow ?? ctx.model?.contextWindow;
					const context = theme.fg(known && percent >= 90 ? "error" : known && percent >= 70 ? "warning" : "muted",
						`ctx ${known ? `${Math.round(percent)}%` : "?"}${window && window > 0 ? `/${capacity(window)}` : ""}`);
					const model = oneLine(ctx.model?.id ?? "no-model");
					const thinking = pi.getThinkingLevel();
					const primary = `${theme.fg("muted", `${model} · ${thinking}`)} · ${context}`;
					let right = `${primary} · ${cacheLabel()}`;
					// Cache is secondary: hide it before sacrificing model/context.
					if (visibleWidth(right) > width) right = primary;
					if (visibleWidth(right) > width) right = `${theme.fg("muted", model)} · ${context}`;
					if (visibleWidth(right) > width) {
						const modelWidth = width - visibleWidth(context) - 3;
						right = modelWidth >= 4
							? `${theme.fg("muted", truncateToWidth(model, modelWidth))} · ${context}`
							: truncateToWidth(context, width);
					}
					const branch = footerData.getGitBranch();
					const left = theme.fg("muted", oneLine(`${basename(ctx.cwd) || ctx.cwd}${branch ? ` (${branch}${dirty ? "*" : ""})` : ""}`));
					const available = width - visibleWidth(right) - 2;
					const clippedLeft = available >= 4 ? truncateToWidth(left, available) : "";
					const first = clippedLeft + " ".repeat(Math.max(0, width - visibleWidth(clippedLeft) - visibleWidth(right))) + right;
					const statuses = [...footerData.getExtensionStatuses()]
						.sort(([a], [b]) => Number(b === "on-call-mode") - Number(a === "on-call-mode"))
						.map(([key, value]) => key === "todo"
							? theme.fg("muted", oneLine(stripTerminalSequences(value))) : oneLine(value))
						.filter(value => visibleWidth(value) > 0);
					const inset = Math.min(2, Math.floor((width - 1) / 2));
					const padding = " ".repeat(inset);
					return statuses.length
						? [
							truncateToWidth(first, width),
							theme.fg("borderMuted", `${padding}${"─".repeat(width - inset * 2)}${padding}`),
							truncateToWidth(statuses.join(" · "), width),
						]
						: [truncateToWidth(first, width)];
				},
			};
		});
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !loader) return;
		// One choice per run, not per tool, token or animation frame.
		ctx.ui.setWorkingMessage(loader.messages[Math.floor(Math.random() * loader.messages.length)]);
	});
	pi.on("agent_settled", (_event, ctx) => {
		refresh?.();
		if (ctx.mode === "tui" && loader) ctx.ui.setWorkingMessage();
	});
	pi.on("tool_execution_end", event => { if (event.toolName === "bash") refresh?.(); });
	pi.on("model_select", () => { requestRender?.(); });
	pi.on("thinking_level_select", () => { requestRender?.(); });
	pi.on("session_shutdown", () => { dispose?.(); });
}
