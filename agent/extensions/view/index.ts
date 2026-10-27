import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("view", {
    description: "Open a path in your configured editor (default: Zed; usage: /view [path])",
    handler: async (args, ctx) => {
      try {
        // Executable configuration is personal-only, never taken from a project.
        const settingsPath = join(getAgentDir(), "settings.json");
        let config;
        try { config = JSON.parse(await readFile(settingsPath, "utf8")).view; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) {
          throw new Error(`Expected a view configuration object in ${settingsPath}`);
        }
        const editor = config?.editor === undefined ? "zed" : config.editor;
        const editorArgs = config?.args === undefined ? [] : config.args;
        if (typeof editor !== "string" || !editor.trim()) throw new Error("view.editor must be a nonempty executable name or path");
        if (!Array.isArray(editorArgs) || editorArgs.some(arg => typeof arg !== "string")) throw new Error("view.args must be an array of strings");

        const target = args.trim() ? resolve(ctx.cwd, args.trim()) : ctx.cwd;
        await new Promise<void>((resolve, reject) => {
          const child = spawn(editor, [...editorArgs, target], { cwd: ctx.cwd, detached: true, stdio: "ignore" });
          child.once("error", reject);
          child.once("spawn", () => { child.unref(); resolve(); });
        });
        ctx.ui.notify(`Launched ${editor} for ${target}`, "info");
      } catch (error) {
        ctx.ui.notify(`/view: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
