import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

export type Tone = "success" | "warning" | "error" | "accent" | "muted" | "dim";
export const taskStyles = {
  pending: { tone: "muted", glyph: "○", label: "Pending" },
  in_progress: { tone: "accent", glyph: "▶", label: "In progress" },
  completed: { tone: "success", glyph: "✓", label: "Completed" },
  failed: { tone: "error", glyph: "✗", label: "Failed" },
  cancelled: { tone: "dim", glyph: "×", label: "Cancelled" },
} as const;
export const todoStyles = {
  todo: { tone: "muted", glyph: "○", label: "Todo" },
  in_progress: { tone: "accent", glyph: "▶", label: "In progress" },
  done: { tone: "success", glyph: "✓", label: "Done" },
  canceled: { tone: "dim", glyph: "×", label: "Canceled" },
} as const;

/** Domain labels are plain text, not terminal control sequences. */
export const cleanLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
export function statusText(theme: Theme, tone: Tone, label: string, glyph?: string) {
  // Foreground only: a background reset would erase the enclosing tool box's background.
  return theme.fg(tone, `${glyph ? `${glyph} ` : ""}${cleanLabel(label)}`);
}
export function statusCard(theme: Theme, title: string, lines: string[]) {
  const card = new Container();
  card.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
  if (lines.length) card.addChild(new Text(lines.join("\n"), 0, 0));
  return card;
}
