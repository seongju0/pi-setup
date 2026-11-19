import { execFile } from "node:child_process";
import { mkdtempSync, chmodSync, realpathSync, readdirSync, lstatSync, linkSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { publishAnnotationEndpoint } from "./runtime.ts";
import { UUID, validateEndpoint, validateRequest, matches, receipt } from "./annotations-protocol.mjs";
import { atomicRecord, manifest, readPrivate } from "./annotations-cli.mjs";

const probe = 'console.log(JSON.stringify({name:process.release.name,node:process.versions.node,bun:process.versions.bun??null,execPath:process.execPath}))';
// Pi may be a compiled executable or Bun. Never execute that binary as a Node helper.
export function discoverAnnotationNode(runtime = process, execute = execFile): Promise<string> {
  const standalone = runtime.release?.name === "node" && !runtime.versions.bun && basename(runtime.execPath) === "node";
  const command = standalone ? runtime.execPath : "node";
  return new Promise((resolve, reject) => {
    execute(command, ["-e", probe], { encoding: "utf8", timeout: 3000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      try {
        if (error) throw error;
        const value = JSON.parse(String(stdout));
        if (value.name !== "node" || value.bun || !/^\d+\.\d+\.\d+/.test(value.node) || Number(value.node.split('.')[0]) < 26 || !isAbsolute(value.execPath)) throw new Error();
        resolve(value.execPath);
      } catch { reject(new Error("Files review unavailable: standalone Node 26+ could not be verified")); }
    });
  });
}
let verifiedNode: Promise<string> | undefined;

export function createAnnotationReceiver(pi: ExtensionAPI) {
  let generation = 0;
  let binding: { ctx: ExtensionContext; endpoint: any; epoch: number; timer?: ReturnType<typeof setInterval>; publishing?: AbortController } | undefined;
  let startingSession: string | undefined;
  function stop() {
    generation++;
    startingSession = undefined;
    const old = binding;
    binding = undefined;
    if (!old) return;
    if (old.timer) clearInterval(old.timer);
    old.publishing?.abort();
    // Shutdown must never await hc. Only close this instance's local owned manifest.
    try { atomicRecord(old.endpoint, "manifest.json", { endpoint: old.endpoint, open: false }, true); } catch {}
  }
  function current(b: NonNullable<typeof binding>) {
    return binding === b && generation === b.epoch && b.ctx.mode === "tui" && b.ctx.sessionManager.getSessionId() === b.endpoint.sessionId;
  }
  function poll(b: NonNullable<typeof binding>) {
    if (!current(b)) return;
    // Bounded synchronous local operations make claim -> identity check -> void API atomic
    // with respect to JS lifecycle handlers. There is no model wait and no replay of claims.
    try {
      if (!manifest(b.endpoint).open) return;
      const files = readdirSync(b.endpoint.inbox).filter(n => n.endsWith('.request.json')).slice(0, 20);
      for (const name of files) {
        const id = name.slice(0, -'.request.json'.length);
        if (!UUID.test(id)) continue;
        // Final records are permanent deduplication evidence for this endpoint.
        try { lstatSync(join(b.endpoint.inbox, `${id}.result.json`)); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
        const claimed = join(b.endpoint.inbox, `${id}.claimed.json`);
        try { linkSync(join(b.endpoint.inbox, name), claimed); unlinkSync(join(b.endpoint.inbox, name)); } catch { continue; }
        let result;
        try {
          const request = validateRequest(readPrivate(claimed));
          if (request.id !== id || !matches(request, b.endpoint)) throw new Error();
          // Do not introduce an await between this exact-session check and dispatch.
          if (!current(b)) throw new Error();
          pi.sendUserMessage(request.text, { deliverAs: "followUp", expandPromptTemplates: false });
          result = receipt(b.endpoint, id, "handed_to_pi");
        } catch { result = receipt(b.endpoint, id, "rejected", "Request invalid, receiver stopped, or handoff refused"); }
        try {
          atomicRecord(b.endpoint, `${id}.result.json`, result);
          unlinkSync(claimed);
        } catch { /* A claim without a receipt is unconfirmed and must never be replayed. */ }
      }
    } catch { /* An unavailable mailbox never authorizes dispatch. */ }
  }
  function bind(ctx: ExtensionContext) {
    const terminal = process.env.HC_TERMINAL_ID?.trim();
    const sessionId = ctx.sessionManager.getSessionId();
    if (ctx.mode !== "tui" || !terminal) { stop(); return; }
    if ((binding && current(binding) && binding.endpoint.sessionId === sessionId) || startingSession === sessionId) return;
    stop();
    const epoch = generation;
    startingSession = sessionId;
    const active = () => generation === epoch && ctx.sessionManager.getSessionId() === sessionId;
    void (async () => {
      let startupInbox: string | undefined;
      let startedPolling = false;
      try {
        verifiedNode ??= discoverAnnotationNode().catch(error => {
          verifiedNode = undefined;
          throw error;
        });
        const node = await verifiedNode;
        if (!active()) return;
        const inbox = mkdtempSync(join(realpathSync(tmpdir()), "pi-files-review-"));
        startupInbox = inbox;
        chmodSync(inbox, 0o700);
        const endpoint = validateEndpoint({ v: 1, sessionId, terminal, instance: randomUUID(), inbox, node, cli: fileURLToPath(new URL("./annotations-cli.mjs", import.meta.url)) });
        const b = { ctx, endpoint, epoch, publishing: new AbortController() } as NonNullable<typeof binding>;
        binding = b;
        atomicRecord(endpoint, "manifest.json", { endpoint, open: true });
        if (!current(b)) { stop(); return; }
        await publishAnnotationEndpoint(endpoint, b.publishing!.signal);
        if (!current(b)) return;
        b.timer = setInterval(() => poll(b), 1000);
        startedPolling = true;
        b.timer.unref();
      } catch {
        if (!active()) return;
        stop();
        ctx.ui.notify("Files review unavailable: standalone Node 26+ and Herdr receiver publication are required", "warning");
      } finally {
        // Only this startup attempt owns this freshly allocated directory. Failed
        // or aborted publication must not leak it. Once polling began, stop only
        // closes the manifest so existing final receipts remain available.
        if (startupInbox && !startedPolling) {
          try { rmSync(startupInbox, { recursive: true, force: true }); } catch {}
        }
        if (generation === epoch) startingSession = undefined;
      }
    })();
  }
  return { bind, stop };
}
