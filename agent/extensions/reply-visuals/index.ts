import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Marked } from "@earendil-works/pi-tui";
import { pillWords, type Tone } from "../lib/status-style.ts";

const parser = new Marked();
const alerts: Record<string, Tone> = { NOTE: "accent", TIP: "success", IMPORTANT: "accent", WARNING: "warning", CAUTION: "error" };
// A compact capability description, not a second mandatory reply-style policy.
export const visualGuidance = `Terminal chat supports optional status chips: ${Object.keys(pillWords).map(word => `[[${word}]]`).join(", ")}. A known label may have short detail, e.g. [[Passed 12/12]]. Use these proactively when states help scanning, not on every reply or claim. Pair a failure, blocker, risk or ask with the cause, next action or decision the reader needs. Labels report evidence, never grant approval. Use ordinary task lists, comparison tables, progress counts, bold anchors, trees/arrows and Mermaid when helpful; combine forms when useful. > [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION] introduce callouts. Pi draws task/TODO tool cards from their actual results; do not invent progress or duplicate them in prose. Keep chip markers in terminal replies only, never in authored files, commits, PRs, issues, code, commands, paths or exact-format output. Plain replies can stay plain.`;

interface Cell { tokens: Node[] }
interface Node { type: string; raw: string; tokens?: Node[]; items?: Node[]; header?: Cell[]; rows?: Cell[][] }

function decorateText(text: string, theme: Theme): string {
  // Links parsed by Marked are skipped below; protect raw URLs as well.
  return text.split(/(https?:\/\/\S+)/g).map((part, index) => index % 2 ? part : part.replace(
    /\[\[([^\]\n]{1,64})\]\]|[✓✗→]|[├└]──/g,
    (match, label?: string) => {
      if (label !== undefined) {
        const entry = Object.entries(pillWords).find(([word]) => {
          const lower = label.toLowerCase();
          return lower === word.toLowerCase() || lower.startsWith(`${word.toLowerCase()} `) || lower.startsWith(`${word.toLowerCase()}:`);
        });
        if (!entry) return match;
        const [word, tone] = entry;
        const background = tone === "success" ? "toolSuccessBg" : tone === "error" ? "toolErrorBg" : "customMessageBg";
        return theme.bg(background, theme.fg(tone, `\u00a0${word}${label.slice(word.length)}\u00a0`));
      }
      return theme.fg(match === "✓" ? "success" : match === "✗" ? "error" : match === "→" ? "accent" : "dim", match);
    },
  )).join("");
}

/** Preserve original syntax; only replace child raw spans we can locate without guessing. */
function replaceChildren(raw: string, children: Node[], theme: Theme): string {
  let cursor = 0, result = "";
  for (const child of children) {
    if (!child.raw) continue;
    const start = raw.indexOf(child.raw, cursor);
    // Nested quote/list indentation may not be contiguous in the original source.
    // Leave that subtree alone rather than reparsing code with hand-written regexes.
    if (start < 0) return raw;
    result += raw.slice(cursor, start) + decorateNode(child, theme);
    cursor = start + child.raw.length;
  }
  return result + raw.slice(cursor);
}

function decorateNode(node: Node, theme: Theme): string {
  if (["code", "codespan", "link", "image", "html", "def", "escape"].includes(node.type)) return node.raw;
  if (node.type === "table") {
    const cells = [...(node.header ?? []), ...(node.rows ?? []).flat()];
    return replaceChildren(node.raw, cells.flatMap(cell => cell.tokens), theme);
  }
  if (node.type === "blockquote") {
    // Parse the logical body, then restore each original quote prefix (including lazy lines).
    // This also keeps quoted code protected instead of decorating quote lines as plain text.
    const lines = node.raw.split("\n");
    const prefixes = lines.map(line => line.match(/^ {0,3}>[ \t]?/)?.[0] ?? "");
    const body = lines.map((line, index) => line.slice(prefixes[index].length)).join("\n");
    const decorated = decorate(body, theme).replace(/^([ \t]*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/, (_all, space, kind) =>
      `${space}**${theme.fg(alerts[kind], kind)}:**`);
    const updated = decorated.split("\n");
    return updated.length === lines.length ? updated.map((line, index) => prefixes[index] + line).join("\n") : node.raw;
  }
  if (node.type === "strong") {
    const inner = node.raw.slice(2, -2);
    return node.raw.slice(0, 2) + theme.fg("accent", replaceChildren(inner, node.tokens ?? [], theme)) + node.raw.slice(-2);
  }
  if (node.tokens || node.items) return replaceChildren(node.raw, node.items ?? node.tokens!, theme);
  return node.type === "text" ? decorateText(node.raw, theme) : node.raw;
}

export function decorate(markdown: string, theme: Theme): string {
  return replaceChildren(markdown, parser.lexer(markdown) as Node[], theme);
}

export default function replyVisuals(pi: ExtensionAPI) {
  let currentTheme: (() => Theme) | undefined;
  pi.on("session_start", (_event, ctx) => { currentTheme = ctx.mode === "tui" ? () => ctx.ui.theme : undefined; });
  pi.on("before_agent_start", (event, ctx) => {
    const sections = (event.systemPromptOptions.sections ??= {});
    currentTheme = ctx.mode === "tui" ? () => ctx.ui.theme : undefined;
    if (currentTheme) sections.visual_replies = visualGuidance;
    else delete sections.visual_replies;
  });
  pi.registerMarkdownTransformer(markdown => currentTheme ? decorate(markdown, currentTheme()) : markdown, { messageTypes: ["assistant"] });
}
