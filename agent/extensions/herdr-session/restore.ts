import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { getAgentDir, parseArgs, type Args, type ExtensionContext, type SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import { piInvocation } from "../lib/pi-invocation.ts";
import { currentBootId, hcJson, isKeptPane, isSafeId, parseRecord, promptPath, readPrivateSync, recordPath, removePrivateSync, restoreRoot, writePrivateSync, writeRecordSync } from "./restore-record.mjs";

type RestoreRecord = {
  version: 1; coreId: string; terminal: string; bootId: string; eligible: boolean;
  sessionFile: string; sessionId: string; cwd: string; agentDir: string;
  invocation: { command: string; args: string[] }; replay: string[]; promptFiles: string[]; unsupported: string[];
};
let coreId: string | undefined;
async function currentCoreId() {
  if (!coreId) {
    const value = (await hcJson(["server", "status"]))?.core?.id;
    if (!isSafeId(value)) throw new Error("Herdr core identity unavailable");
    coreId = value;
  }
  return coreId!;
}

// Mirror Pi's resolvePromptInput at every runtime start. Relative sources deliberately
// follow process.cwd() (the launch directory), never the session's moved ctx.cwd.
function resolvePromptSource(source: string): string | undefined {
  if (!source) return undefined;
  if (!existsSync(source)) return source;
  try { return readFileSync(source, "utf8").replace(/^\uFEFF/, ""); } catch { return source; }
}
const rejected: [keyof Args, string][] = [
  ["apiKey", "--api-key"], ["sessionDir", "--session-dir"], ["noSession", "--no-session"],
  ["tools", "--tools"], ["excludeTools", "--exclude-tools"], ["noTools", "--no-tools"],
  ["noBuiltinTools", "--no-builtin-tools"], ["extensions", "--extension"], ["noExtensions", "--no-extensions"],
  ["noMcp", "--no-mcp"], ["skills", "--skill"], ["noSkills", "--no-skills"],
  ["promptTemplates", "--prompt-template"], ["noPromptTemplates", "--no-prompt-templates"],
  ["themes", "--theme"], ["noThemes", "--no-themes"], ["noContextFiles", "--no-context-files"],
];

export function createRestoreRecorder(): { start(ctx: ExtensionContext): Promise<void>; shutdown(event: SessionShutdownEvent): void } {
  let armed: RestoreRecord | undefined;
  let closed = false;
  let signaled = false;
  let warned = false;
  let context: ExtensionContext | undefined;
  let path: string | undefined;
  function warn(error: unknown) {
    if (warned) return;
    warned = true;
    const message = (error instanceof Error ? error.message : String(error)).split(/[\r\n]/)[0];
    try { context?.ui.notify(`Herdr reboot restore unavailable: ${message}`, "warning"); } catch { /* Never disrupt Pi teardown. */ }
  }
  function invalidate(error: unknown) {
    // If a new association could not be recorded, never keep an older session armed.
    try {
      const terminal = process.env.HC_TERMINAL_ID;
      // If core discovery itself failed, best-effort disarm this terminal's old
      // associations; this is invalidation only, never cross-core restore selection.
      const paths = path ? [path] : isSafeId(terminal)
        ? readdirSync(restoreRoot()).filter(isSafeId).map((core) => recordPath(core, terminal)) : [];
      for (const file of paths) {
        try {
          const previous = parseRecord(readPrivateSync(file));
          if (previous) writeRecordSync({ ...previous, eligible: false });
          else removePrivateSync(file);
        } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
      }
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== "ENOENT") warn("restore state could not be invalidated; inspect it before enabling the hook");
    }
    warn(error);
  }
  const signal = () => {
    signaled = true;
    if (armed) {
      try { writeRecordSync(armed); } catch (error) { invalidate(error); }
    }
  };
  return {
    async start(ctx) {
      context = ctx;
      const terminal = process.env.HC_TERMINAL_ID;
      if (closed || ctx.mode !== "tui" || !isSafeId(terminal) || process.platform !== "darwin") return;
      try {
        const core = await currentCoreId();
        path = recordPath(core, terminal);
        const pane = await hcJson(["get", terminal]);
        if (closed) return;
        if (!isKeptPane(pane, terminal)) {
          // An existing association is no longer a local kept pane.
          try { const old = parseRecord(readPrivateSync(path)); if (old) writeRecordSync({ ...old, eligible: false }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          return;
        }
        const bootId = await currentBootId();
        if (closed) return;
        const args = parseArgs(process.argv.slice(2));
        const invocation = piInvocation([]);
        const unsupported = rejected.filter(([key]) => args[key] !== undefined && args[key] !== false).map(([, flag]) => flag);
        if (args.projectTrustOverride !== undefined) unsupported.push(args.projectTrustOverride ? "--approve" : "--no-approve");
        unsupported.push(...[...args.unknownFlags.keys()].map((name) => `--${name}`));
        if (!isAbsolute(invocation.command)) unsupported.push("Pi executable path unknown");
        const sessionFile = ctx.sessionManager.getSessionFile() ?? "";
        if (!sessionFile) unsupported.push("no saved session file");
        const replay: string[] = [];
        if (args.offline) replay.push("--offline");
        if (args.models) replay.push("--models", args.models.join(","));
        if (args.tuiMode) replay.push("--tui-mode", args.tuiMode);
        // Resolve both before writing: a restored invocation can read these very snapshots.
        const system = args.systemPrompt === undefined ? undefined : resolvePromptSource(args.systemPrompt) ?? "";
        const append = args.appendSystemPrompt === undefined ? undefined : args.appendSystemPrompt.map(resolvePromptSource).filter((s): s is string => s !== undefined).join("\n\n");
        const promptFiles: string[] = [];
        for (const [kind, flag, text] of [["system", "--system-prompt", system], ["append", "--append-system-prompt", append]] as const) {
          const file = promptPath(core, terminal, kind);
          if (text === undefined) removePrivateSync(file);
          else { writePrivateSync(file, text); promptFiles.push(file); replay.push(flag, file); }
        }
        const record: RestoreRecord = { version: 1, coreId: core, terminal, bootId, eligible: true,
          sessionFile, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, agentDir: getAgentDir(),
          invocation, replay, promptFiles, unsupported };
        writeRecordSync(record);
        armed = record;
        signaled = false;
        process.on("SIGTERM", signal);
        process.on("SIGHUP", signal);
      } catch (error) { if (!closed) invalidate(error); }
    },
    shutdown(event) {
      process.removeListener("SIGTERM", signal);
      process.removeListener("SIGHUP", signal);
      closed = true;
      if (event.reason === "quit" && !signaled && armed) {
        try { writeRecordSync({ ...armed, eligible: false }); } catch (error) { invalidate(error); }
      }
    },
  };
}
