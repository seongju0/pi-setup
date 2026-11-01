import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Box, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { UsageReport, Period, ProviderTotals, Totals } from "./types.ts";

interface PanelOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  done: () => void;
  load: (period: Period, offset: number) => Promise<UsageReport>;
  period: Period;
}

// Saved metadata is not trusted terminal markup.
function plain(value: string): string {
  return stripTerminalSequences(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ");
}
const number = (value: number) => value.toLocaleString("en-US");
const money = (value: number) => value > 0 && value < .01 ? "<$0.01" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const estimate = (row: Totals) => `~${money(row.cost)}${row.unpriced ? "*" : ""}`;
function cachedInput(row: Totals): string {
  const inputTokens = row.input + row.cacheRead + row.cacheWrite;
  return inputTokens === 0 ? "—" : `${(row.cacheRead / inputTokens * 100).toFixed(1)}%`;
}
function cell(text: string, width: number, right = false): string {
  const clipped = truncateToWidth(text, width);
  const pad = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return right ? pad + clipped : clipped + pad;
}

export function createUsagePanel({ tui, theme, keybindings, done, load, period: initialPeriod }: PanelOptions): Component & { dispose(): void } {
  let period = initialPeriod;
  let offset = 0;
  let report: UsageReport | undefined;
  let loading = true;
  let failed = false;
  let closed = false;
  let request = 0;
  let models = false;
  let coverage = false;
  let scroll = 0;
  let maxScroll = 0;

  const redraw = () => { if (!closed) tui.requestRender(); };
  const refresh = async () => {
    const current = ++request;
    loading = true;
    failed = false;
    report = undefined;
    scroll = 0;
    redraw();
    try {
      const result = await load(period, offset);
      if (closed || current !== request) return;
      report = result;
    } catch {
      if (closed || current !== request) return;
      failed = true; // Loader errors may contain private paths; don't display them.
    }
    if (closed || current !== request) return;
    loading = false;
    redraw();
  };
  const heading = (text: string) => theme.fg("accent", theme.bold(text));
  const muted = (text: string) => theme.fg("muted", text);
  const rule = (width: number) => theme.fg("border", "─".repeat(Math.max(0, width)));

  const comparison = (width: number, codex: ProviderTotals, anthropic: ProviderTotals): string[] => {
    const partial = codex.unpriced ? "Partial " : "";
    const difference = codex.cost - report!.monthlyFee;
    const metrics: [string, string, string][] = [
      ["Total tokens", number(codex.totalTokens), number(anthropic.totalTokens)],
      ["Input (uncached)*", number(codex.input), number(anthropic.input)],
      ["Output", number(codex.output), number(anthropic.output)],
      ["Cache read", number(codex.cacheRead), number(anthropic.cacheRead)],
      ["Cache write", number(codex.cacheWrite), number(anthropic.cacheWrite)],
      ["Cached input %", cachedInput(codex), cachedInput(anthropic)],
      ["Reasoning¹", codex.reasoning === null ? "—" : number(codex.reasoning), anthropic.reasoning === null ? "—" : number(anthropic.reasoning)],
      ["", "", ""],
      ["API-equivalent²", estimate(codex), "—"],
      ["Estimated API spend", "—", estimate(anthropic)],
      ["Plan reference", `${money(report!.monthlyFee)}/mo`, "—"],
    ];
    if (report!.period === "month") metrics.push([
      difference >= 0 ? `${partial}cost avoided` : `${partial}below plan`,
      `${difference < 0 ? "−" : ""}~${money(Math.abs(difference))}`, "—",
    ]);
    if (width >= 64) {
      const labelWidth = 23;
      const valueWidth = Math.floor((width - labelWidth - 4) / 2);
      const tableRow = (label: string, left: string, right: string) => `${cell(label, labelWidth)}  ${cell(left, valueWidth, true)}  ${cell(right, valueWidth, true)}`;
      return [
        heading(tableRow("", "Codex", "Anthropic")), rule(width),
        ...metrics.map(([label, left, right], index) => index === 0
          ? theme.bold(tableRow(label, left, right))
          : label ? tableRow(label, left, right) : rule(width)),
      ];
    }
    // Narrow terminals retain the same comparison without squeezing two values into tiny columns.
    return [codex, anthropic].flatMap((provider, index) => [
      heading(provider.label),
      ...metrics.filter(([label, left, right]) => label && (label === "Cached input %" || (index === 0 ? left : right) !== "—"))
        .map(([label, left, right]) => `${label}: ${index === 0 ? left : right}`),
      "",
    ]);
  };

  const body = (width: number): string[] => {
    if (loading) return [muted("Loading local usage metadata…")];
    if (failed || !report) return [theme.fg("error", "Unable to load usage. Press R to retry.")];
    const lines: string[] = [];
    if (report.rows.every(row => row.records === 0)) lines.push(muted("No recorded usage in this period."), "");
    const codex = report.rows.find(row => row.key === "codex")!;
    const anthropic = report.rows.find(row => row.key === "anthropic")!;
    lines.push(...comparison(width, codex, anthropic));
    const unpriced = report.rows.filter(row => row.unpriced);
    for (const row of unpriced) lines.push(...wrapTextWithAnsi(muted(`* ${plain(row.label)}: known priced subtotal; ${number(row.unpriced)} unpriced records.`), width));
    lines.push("", ...wrapTextWithAnsi(muted("* Input excludes separately listed cache writes."), width));
    lines.push(...wrapTextWithAnsi(muted("Cached input %: input tokens served from cache, not % of requests."), width));
    lines.push(muted("¹ Recorded subset of output.  ² Hypothetical API cost, not a charge."));
    const additional = report.rows.filter(row => ["other", "unattributed"].includes(row.key));
    if (additional.length) {
      lines.push("", heading("Additional usage"));
      for (const row of additional) {
        lines.push(...wrapTextWithAnsi(`${plain(row.label)}  ·  ${number(row.totalTokens)} tokens  ·  ${estimate(row)}`, width));
      }
      lines.push(...wrapTextWithAnsi(muted("Excluded from the two-provider comparison; billing attribution is unknown."), width));
    }
    lines.push("", heading(`${models ? "▾" : "▸"} Models  [B]`));
    if (models) {
      for (const row of report.rows) {
        if (!row.models.length) continue;
        lines.push("", theme.bold(plain(row.label)));
        for (const model of row.models) {
          lines.push(...wrapTextWithAnsi(plain(`${model.provider} / ${model.model}`), width));
          lines.push(...wrapTextWithAnsi(`  ${number(model.totalTokens)} tokens  ·  ${estimate(model)} catalog estimate`, width));
          lines.push(...wrapTextWithAnsi(muted(`  In ${number(model.input)} · Out ${number(model.output)} · Cache read ${number(model.cacheRead)} · Write ${number(model.cacheWrite)}`), width));
          lines.push(...wrapTextWithAnsi(muted(`  Cached input: ${cachedInput(model)}`), width));
        }
      }
    }
    lines.push(heading(`${coverage ? "▾" : "▸"} Coverage  [C]`));
    if (coverage) {
      for (const note of [...report.coverage, "Cached input % = cache read / (input + cache read + cache write); includes saved cache-warming usage. Missing cache reporting may appear as zero.", "Missing usage and service/helper fees may not be recorded.", "The plan is a configured reference, not a historical invoice."]) {
        lines.push(...wrapTextWithAnsi(muted(`• ${plain(note)}`), width));
      }
    }
    return lines;
  };

  const height = () => Math.max(1, Math.floor(tui.terminal.rows * .85));
  const content = new Box(2, 1);
  content.addChild({
    render(width: number): string[] {
      const compact = height() < 18;
      const selected = (value: Period) => period === value ? heading(`[${value === "week" ? "Week" : "Month"}]`) : muted(value === "week" ? "Week" : "Month");
      const tabs = `${selected("week")}  ${selected("month")}`;
      const title = heading("Usage");
      const titleLine = width >= 35 ? `${title}${" ".repeat(Math.max(2, width - visibleWidth(title) - visibleWidth(tabs)))}${tabs}` : title;
      const dates = report ? `${report.start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${new Date(report.end.getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : period === "week" ? "Week (Mon–Sun)" : "Calendar month";
      const timezone = plain(Intl.DateTimeFormat().resolvedOptions().timeZone);
      const header = compact ? [titleLine] : [titleLine, muted(`${dates} · ${timezone}`), rule(width)];
      const controls = compact
        ? [muted("W/M period · ←/→ history · Esc close"), muted("B models · C coverage · R refresh · ↑↓ scroll")]
        : [rule(width), muted("W/M period · ←/→ history · B models · C coverage"), muted("R refresh · ↑↓ scroll · Esc close")];
      const lines = body(width);
      // Border + Box vertical padding consume four rows outside this content.
      const viewport = Math.max(0, height() - 4 - header.length - controls.length);
      maxScroll = Math.max(0, lines.length - viewport);
      scroll = Math.min(scroll, maxScroll);
      if (!compact) {
        const refreshed = report ? `Updated ${report.refreshedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Local Pi activity";
        const position = maxScroll ? ` · ${scroll + 1}–${Math.min(lines.length, scroll + viewport)}/${lines.length} ↓` : "";
        controls[controls.length - 1] += muted(`  ·  ${refreshed}${position}`);
      }
      return [...header, ...lines.slice(scroll, scroll + viewport), ...controls].map(line => truncateToWidth(line, width));
    },
    invalidate() {},
  });

  void refresh();
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width - 2);
      const edge = (left: string, right: string) => theme.fg("border", left + "─".repeat(inner) + right);
      return [
        edge("╭", "╮"),
        ...content.render(inner).map(line => theme.fg("border", "│") + line + theme.fg("border", "│")),
        edge("╰", "╯"),
      ].slice(0, height()).map(line => truncateToWidth(line, Math.max(0, width)));
    },
    handleInput(data: string): void {
      if (closed) return;
      if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "escape")) {
        closed = true;
        done();
        return;
      }
      if (matchesKey(data, "w") || matchesKey(data, "shift+w")) {
        period = "week"; offset = 0; void refresh();
      } else if (matchesKey(data, "m") || matchesKey(data, "shift+m")) {
        period = "month"; offset = 0; void refresh();
      } else if (matchesKey(data, "left")) {
        offset--; void refresh();
      } else if (matchesKey(data, "right") && offset < 0) {
        offset++; void refresh();
      } else if (matchesKey(data, "r") || matchesKey(data, "shift+r")) {
        void refresh();
      } else if (matchesKey(data, "b") || matchesKey(data, "shift+b")) {
        models = !models; scroll = 0; redraw();
      } else if (matchesKey(data, "c") || matchesKey(data, "shift+c")) {
        coverage = !coverage; redraw();
      } else if (keybindings.matches(data, "tui.select.up") || matchesKey(data, "up")) {
        scroll = Math.max(0, scroll - 1); redraw();
      } else if (keybindings.matches(data, "tui.select.down") || matchesKey(data, "down")) {
        scroll = Math.min(maxScroll, scroll + 1); redraw();
      }
    },
    invalidate(): void { content.invalidate(); },
    dispose(): void { closed = true; },
  };
}
