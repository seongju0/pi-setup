import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, resolve } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { requireLaunchModel } from "../lib/models.ts";
import { piInvocation } from "../lib/pi-invocation.ts";

export const WORKER_ENTRY = "herdr-research-worker";
export type WorkerIdentity = { dir: string; worker: string; sessionId: string };

const execFileAsync = promisify(execFile);

export type CoreTerminal = {
  address: string;
  state: string;
  parent?: string | null;
  labels: Record<string, string>;
  status?: { app?: string; state: string } | null;
};

export type SessionResult = {
  backend: "hc";
  terminalId?: string;
  name: string;
  sessionId: string;
  sessionPath: string;
  label: string;
  cwd: string;
  model?: string;
  appendSystemPrompt?: string;
  handoff?: string;
  launchState: "created" | "starting" | "started";
  deliveryState: "not_requested" | "not_submitted" | "unconfirmed" | "accepted";
  workspace?: string;
  workspaceId?: string;
  tabId?: string;
  paneId?: string;
};

type SessionInput = {
  workspace?: string;
  cwd?: string;
  label?: string;
  model?: string;
  handoff?: string;
  appendSystemPrompt?: string;
  research?: { dir: string; worker: string };
};
type AppSpace = { id: string; name: string; machine?: string | null; tabs: { id: string; terminals: { terminal: string; pane: string }[] }[] };
type AppStatus = { space?: string; tab?: string; focused_pane?: string };

async function core(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const deadline = AbortSignal.any([AbortSignal.timeout(65000), ...(signal ? [signal] : [])]);
  const id = randomUUID();
  return new Promise((resolveResponse, reject) => {
    const child = spawn("hc", ["connect"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      deadline.removeEventListener("abort", abort);
      child.kill();
      if (error) reject(error); else resolveResponse(result);
    };
    const abort = () => finish(deadline.reason);
    deadline.addEventListener("abort", abort, { once: true });
    child.on("error", finish);
    child.stdin.on("error", finish);
    child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr = (stderr + data).slice(-8192); });
    child.stdout.setEncoding("utf8").on("data", (data: string) => {
      output += data;
      if (output.length > 1024 * 1024) return finish(new Error("hc response exceeded 1 MiB"));
      let newline: number;
      while ((newline = output.indexOf("\n")) !== -1) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.jsonrpc !== "2.0") throw new Error("Invalid hc JSON-RPC response");
          if (message.id === undefined && typeof message.method === "string") continue;
          if (message.id !== id) throw new Error("Mismatched hc JSON-RPC response ID");
          if (message.error) throw new Error(`hc ${method}: ${message.error.message ?? JSON.stringify(message.error)}`);
          if (!("result" in message)) throw new Error("Missing hc JSON-RPC result");
          finish(undefined, message.result);
        } catch (error) { finish(error); }
      }
    });
    child.on("close", (code) => finish(new Error(`hc connect closed before its response (${code}): ${stderr}`)));
    child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    if (deadline.aborted) abort();
  });
}

function terminalResult(value: unknown): CoreTerminal {
  const terminal = value as CoreTerminal;
  if (!terminal || typeof terminal.address !== "string" || !terminal.address ||
    !["live", "finished"].includes(terminal.state) || !terminal.labels || typeof terminal.labels !== "object") {
    throw new Error("Invalid hc terminal response");
  }
  return terminal;
}

export async function getCoreTerminal(terminalId: string, signal?: AbortSignal) {
  const terminal = terminalResult(await core("terminal.get", { terminal: terminalId, caller: process.env.HC_TERMINAL_ID }, signal));
  if (terminal.address !== terminalId) throw new Error("hc returned a different terminal address");
  return terminal;
}

export async function publishSessionIdentity(ctx: ExtensionContext) {
  if (ctx.mode !== "tui" || !process.env.HC_TERMINAL_ID) return;
  await core("terminal.label", { terminal: process.env.HC_TERMINAL_ID, labels: { "pi.session-id": ctx.sessionManager.getSessionId(), "pi.session-cwd": ctx.cwd } });
}

async function app<T>(args: string[], signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const { stdout } = await execFileAsync("herdr-app", args, { encoding: "utf8", timeout: 10000, signal });
  const result = JSON.parse(stdout);
  if (result.error) throw new Error(`Herdr app: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error)}`);
  return result as T;
}

function selectSpace(spaces: AppSpace[], workspace: string) {
  const exact = spaces.find((space) => space.id === workspace);
  const matches = exact ? [exact] : spaces.filter((space) => space.name === workspace);
  if (matches.length !== 1) throw new Error(`Workspace ${matches.length ? "is ambiguous" : "not found"}: ${workspace}`);
  if (matches[0].machine) throw new Error("Only local Herdr workspaces are supported");
  return matches[0];
}

export async function resolvePromptFile(path: string | undefined, cwd: string) {
  if (path === undefined) return undefined;
  const file = resolve(cwd, path);
  if (!(await readFile(file, "utf8")).trim()) throw new Error(`Prompt file is empty: ${file}`);
  return file;
}

function requireLive(terminal: CoreTerminal) {
  if (terminal.state !== "live") throw new Error(`Terminal ${terminal.address} is finished`);
}

async function confirmPrompt(result: SessionResult, prompt: string, signal: AbortSignal) {
  while (true) {
    signal.throwIfAborted();
    requireLive(await getCoreTerminal(result.terminalId!, signal));
    const entries = (await readFile(result.sessionPath, "utf8")).split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const header = entries.find((entry) => entry.type === "session");
    if (header?.id !== result.sessionId) throw new Error("Agent switched sessions before handoff acceptance");
    if (entries.some((entry) => entry.type === "message" && entry.message?.role === "user" &&
      (typeof entry.message.content === "string" ? entry.message.content : entry.message.content?.filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n")) === prompt)) return;
    await delay(250, undefined, { signal });
  }
}

async function placeTab(result: SessionResult, signal?: AbortSignal) {
  const deadline = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
  while (true) {
    deadline.throwIfAborted();
    const listed = await app<{ spaces: AppSpace[] }>(["ls"], deadline);
    const tab = listed.spaces.find((space) => space.id === result.workspaceId)?.tabs.find((tab) => tab.id === result.tabId);
    const pane = tab?.terminals.find((terminal) => terminal.terminal === result.terminalId);
    if (pane) {
      result.paneId = pane.pane;
      await app(["do", "tab.rename", JSON.stringify({ id: result.tabId, name: result.label })], deadline);
      return;
    }
    await delay(250, undefined, { signal: deadline });
  }
}

export async function createSession(input: SessionInput, currentCwd: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<SessionResult> {
  signal?.throwIfAborted();
  if (ctx.mode !== "tui" || !process.env.HC_TERMINAL_ID) throw new Error("This operation requires an interactive Pi session inside herdr-core");
  if (input.model) requireLaunchModel(ctx, input.model);
  const appendSystemPrompt = await resolvePromptFile(input.appendSystemPrompt, currentCwd);
  const handoff = await resolvePromptFile(input.handoff, currentCwd);
  const cwd = resolve(currentCwd, input.cwd ?? ".");
  if (!(await stat(cwd)).isDirectory()) throw new Error(`Destination is not a directory: ${cwd}`);
  const caller = await getCoreTerminal(process.env.HC_TERMINAL_ID, signal);
  requireLive(caller);
  let contextSpace = caller.labels["herdr.space"];
  if (!contextSpace && caller.parent && (!input.research || input.workspace)) {
    contextSpace = (await getCoreTerminal(caller.parent, signal)).labels["herdr.space"];
  }
  let target: AppSpace | undefined;
  let previous: AppStatus | undefined;
  if (!input.research || input.workspace) {
    const listed = await app<{ spaces: AppSpace[] }>(["ls"], signal);
    if (!contextSpace && !input.workspace) throw new Error("Current Herdr workspace is unavailable");
    target = selectSpace(listed.spaces, input.workspace ?? contextSpace!);
    if (input.research && target.id !== contextSpace) throw new Error("Research workers must stay in the caller's workspace");
    if (!input.research) previous = await app<AppStatus>(["status"], signal);
  }
  const label = input.label ?? `Pi ${basename(cwd)}`;
  const session = SessionManager.create(cwd, undefined, { id: randomUUID() });
  const sessionPath = session.getSessionFile();
  const header = session.getHeader();
  if (!sessionPath || !header) throw new Error("Pi could not allocate a session file");
  if (input.research) {
    session.appendCustomEntry(WORKER_ENTRY, { ...input.research, sessionId: header.id } satisfies WorkerIdentity);
    // Reserve identity before startup, including when the terminal fails to launch.
    await writeFile(resolve(input.research.dir, `${input.research.worker}.session.json`), JSON.stringify({ session: header.id }), { flag: "wx", mode: 0o600 });
  }
  await writeFile(sessionPath, [header, ...session.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  const prompt = handoff ? `Read and follow the handoff brief at ${JSON.stringify(handoff)}. Treat it as the task instructions; ask if a material ambiguity blocks safe progress.` : undefined;
  const result: SessionResult = {
    backend: "hc", name: `pi-${randomUUID().replaceAll("-", "").slice(0, 24)}`, sessionId: header.id, sessionPath, label, cwd,
    model: input.model, appendSystemPrompt, handoff, launchState: "created", deliveryState: prompt ? "not_submitted" : "not_requested",
    ...(!input.research ? { workspace: target!.name, workspaceId: target!.id, tabId: `tb${randomUUID().replaceAll("-", "")}` } : {}),
  };
  try {
    const invocation = piInvocation(["--session", sessionPath]);
    const argv = [invocation.command, ...invocation.args];
    if (input.model) argv.push("--model", input.model);
    if (appendSystemPrompt) argv.push("--append-system-prompt", appendSystemPrompt);
    if (prompt) argv.push("--", prompt);
    result.launchState = "starting";
    result.deliveryState = prompt ? "unconfirmed" : "not_requested";
    let terminal: CoreTerminal;
    try {
      const created = await core("terminal.run", {
        argv, cwd, env: { PI_CODING_AGENT_DIR: getAgentDir(), PI_HERDR_MANAGED: "1", HERDR_RESEARCH_DIR: input.research?.dir ?? "", HERDR_RESEARCH_WORKER: input.research?.worker ?? "" },
        wait: false, name: result.name, no_notify: true, caller: caller.address, keep: !input.research,
        ...(input.research ? { parent: caller.address } : { no_parent: true, labels: { "herdr.space": result.workspaceId!, "herdr.tab": result.tabId! } }),
      }, signal);
      if (typeof (created as CoreTerminal)?.address === "string") result.terminalId = (created as CoreTerminal).address;
      terminal = terminalResult(created);
      requireLive(terminal);
      if (previous) await placeTab(result, signal);
    } finally {
      if (previous) {
        const current = await app<AppStatus>(["status"]);
        if (previous.tab && current.tab === result.tabId) {
          await app(["do", "tab.select", JSON.stringify({ id: previous.tab })]);
        }
      }
    }
    const startup = AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]);
    if (prompt) {
      await confirmPrompt(result, prompt, startup);
      result.deliveryState = "accepted";
    } else {
      const waited = await core("terminal.wait", { terminal: terminal.address, caller: caller.address, timeout: 60 }, startup) as { terminal?: string; reason?: string };
      if (waited?.terminal !== terminal.address || waited.reason === "exit") throw new Error("Pi startup did not complete");
      const live = await getCoreTerminal(terminal.address, startup);
      requireLive(live);
      if (live.status?.app !== "pi" || !["idle", "working", "done"].includes(live.status.state)) throw new Error("Pi startup is blocked, failed, or unconfirmed");
    }
    result.launchState = "started";
    return result;
  } catch (error) {
    throw Object.assign(new Error(`Pi launch/delivery failed in ${result.terminalId ?? result.name}; launch=${result.launchState}, delivery=${result.deliveryState}: ${error instanceof Error ? error.message : String(error)}. Inspect this existing session; do not blindly relaunch or resend.`), { session: result });
  }
}
