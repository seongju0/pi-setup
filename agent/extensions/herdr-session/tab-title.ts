import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { app } from "./runtime.ts";

const TITLE_PROMPT = "Write a 2–5 word title (max 40 characters) for a terminal tab, describing the task in the user's request. Do not include people's names, customer or patient details, email addresses, credentials, IDs or numbers. Reply with the title only.";
type Space = { machine?: string | null; tabs: { id: string; name: string; terminals: { terminal: string }[] }[] };

async function ownTab(terminal: string, signal: AbortSignal) {
  const { spaces } = await app<{ spaces: Space[] }>(["ls"], signal);
  const matches = spaces.filter((space) => !space.machine).flatMap((space) =>
    space.tabs.flatMap((tab, index) => tab.terminals.some((pane) => pane.terminal === terminal)
      ? [{ id: tab.id, numbered: tab.name === String(index + 1) }] : []));
  return matches.length === 1 ? matches[0] : undefined;
}

function sanitize(text: string) {
  let title = (text.split(/\r?\n/).find((line) => line.trim()) ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[#*_`]/g, "").trim()
    .replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "")
    .replace(/\s+/g, " ").trim();
  if (title.length > 40) {
    const cut = title.slice(0, 40);
    const boundary = cut.lastIndexOf(" ");
    title = (title[40] !== " " && boundary > 0 ? cut.slice(0, boundary) : cut).trim();
  }
  return /^\d+$/.test(title) ? "" : title;
}

async function nameTab(terminal: string, text: string, model: NonNullable<ExtensionContext["model"]>, registry: ExtensionContext["modelRegistry"], signal: AbortSignal) {
  const tab = await ownTab(terminal, signal);
  if (!tab) return false;
  if (!tab.numbered) return true;
  const reply = await registry.complete(model, {
    systemPrompt: TITLE_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: text.slice(0, 4000) }], timestamp: Date.now() }],
  }, { signal });
  if (reply.stopReason !== "stop") return false;
  const title = sanitize(reply.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  if (!title) return false;
  const current = await ownTab(terminal, signal);
  if (!current || current.id !== tab.id) return false;
  if (!current.numbered) return true;
  await app(["do", "tab.rename", JSON.stringify({ id: tab.id, name: title })], signal);
  return true;
}

export function registerTabTitle(pi: ExtensionAPI) {
  let done = false;
  let pending: AbortController | undefined;
  pi.on("input", (event, ctx) => {
    const terminal = process.env.HC_TERMINAL_ID;
    if (done || pending || event.source !== "interactive" || ctx.mode !== "tui" ||
      !terminal || process.env.PI_HERDR_MANAGED === "1" || !ctx.model || !event.text.trim()) return;
    const controller = new AbortController();
    pending = controller;
    void nameTab(terminal, event.text, ctx.model, ctx.modelRegistry, controller.signal)
      .catch(() => false).then((finished) => {
        if (pending !== controller) return;
        if (!controller.signal.aborted) done = finished;
        pending = undefined;
      });
  });
  pi.on("session_shutdown", () => {
    pending?.abort();
    pending = undefined;
  });
}
