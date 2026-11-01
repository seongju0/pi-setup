import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { aggregate, createScanner } from "./accounting.mjs";
import { createUsagePanel } from "./panel.ts";
import type { Period } from "./types.ts";

async function monthlySubscription(agentDir: string): Promise<number> {
  let settings;
  try { settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 100;
    throw new Error("Cannot read personal settings.json; check its JSON and permissions.");
  }
  // Keep existing personal configuration working after the command rename.
  const config = settings?.usage === undefined ? settings?.meter : settings.usage;
  if (config === undefined) return 100;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Personal settings.json usage must be an object.");
  }
  const fee = config.subscriptionMonthlyUsd === undefined ? 100 : config.subscriptionMonthlyUsd;
  if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
    throw new Error("usage.subscriptionMonthlyUsd must be a nonnegative USD amount.");
  }
  return fee;
}

export default function (pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const scanner = createScanner(agentDir);
  pi.registerCommand("usage", {
    description: "Local Pi token usage, API estimates, and subscription value (/usage [week|month])",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/usage requires Pi's interactive terminal UI.", "error");
        return;
      }
      const period = (args.trim() || "month") as Period;
      if (!["week", "month"].includes(period)) {
        ctx.ui.notify("Usage: /usage [week|month]", "error");
        return;
      }
      try {
        const fee = await monthlySubscription(agentDir);
        await ctx.ui.custom<void>((tui, theme, keybindings, done) => createUsagePanel({
          tui, theme, keybindings, done: () => done(), period,
          load: async (selectedPeriod, offset) => aggregate(await scanner.scan(), selectedPeriod, offset, fee),
        }), { overlay: true, overlayOptions: { width: 110, maxHeight: "85%", anchor: "center", margin: 1 } });
      } catch (error) {
        ctx.ui.notify(`/usage: ${error instanceof Error ? error.message : "Unable to open usage panel"}`, "error");
      }
    },
  });
}
