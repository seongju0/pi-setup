import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { JsonAgentSessionEvent, RpcCommand, RpcResponse, RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";

const COMMAND_TIMEOUT = 30_000;
const MAX_RECORD = 16 * 1024 * 1024;

type Record = JsonAgentSessionEvent | RpcResponse | RpcExtensionUIRequest | { type: "extension_error"; error: string };

// Match upstream's launcher: installed Node/Bun CLI, compiled executable, then PATH.
function invocation(args: string[]) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  if (!/^(node|bun)(\.exe)?$/i.test(basename(process.execPath))) return { command: process.execPath, args };
  return { command: "pi", args };
}

/** Small RPC transport: unlike RpcClient, exposes process death and cancels unsupported approval dialogs. */
export class ChildRpc {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private failure?: Error;
  private closing?: Promise<void>;
  private exited: Promise<void>;
  private ended = false;
  private stderr = "";

  constructor(args: string[], cwd: string, onEvent: (event: Record) => void, onFailure: (error: Error) => void) {
    const launch = invocation(["--mode", "rpc", ...args]);
    this.child = spawn(launch.command, launch.args, {
      cwd, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PI_SUBAGENT: "1", HERDR_RESEARCH_DIR: "", HERDR_RESEARCH_WORKER: "" },
    });
    this.exited = new Promise((resolve) => this.child.once("close", () => { this.ended = true; resolve(); }));
    const fail = (error: Error) => {
      if (this.failure) return;
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      if (!this.closing) onFailure(error);
    };
    this.child.once("error", fail);
    this.child.once("exit", (code, signal) => fail(new Error(`Child exited (code=${code}, signal=${signal}). ${this.stderr}`)));
    this.child.stdin.on("error", fail);
    this.child.stdout.on("error", fail);
    this.child.stderr.on("error", fail);
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8192); });
    this.child.stdout.setEncoding("utf8");
    let buffer = "";
    this.child.stdout.on("data", (chunk: string) => {
      if (this.failure) return;
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        try {
          if (line.length > MAX_RECORD) throw new Error("RPC record exceeds 16 Mi characters");
          const record = JSON.parse(line) as Record;
          if (!record || typeof record.type !== "string") throw new Error("Missing RPC record type");
          if (record.type === "response") {
            const request = record.id && this.pending.get(record.id);
            if (!request) continue;
            if (typeof record.success !== "boolean") throw new Error("Invalid RPC response");
            this.pending.delete(record.id!);
            if (record.success) request.resolve("data" in record ? record.data : undefined);
            else request.reject(new Error(record.error));
          } else if (record.type === "extension_ui_request") {
            if (["confirm", "select", "input", "editor"].includes(record.method)) {
              this.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: record.id, cancelled: true, confirmed: false }) + "\n");
            }
            onEvent(record);
          } else {
            onEvent(record);
          }
        } catch (error) {
          fail(new Error(`Invalid child RPC stream: ${error instanceof Error ? error.message : String(error)}`));
          return;
        }
      }
      if (buffer.length > MAX_RECORD) fail(new Error("Unterminated child RPC record exceeds 16 Mi characters"));
    });
    this.child.stdout.on("end", () => {
      if (buffer.trim() && !this.closing) fail(new Error("Incomplete child RPC record at EOF"));
    });
  }

  request<T>(command: RpcCommand, signal?: AbortSignal): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing) return Promise.reject(new Error("Child is closing"));
    signal?.throwIfAborted();
    const id = `subagent-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.pending.delete(id); };
      const rejectRequest = (error: Error) => { clean(); reject(error); };
      const abort = () => rejectRequest(new Error("Child request cancelled before acceptance"));
      const timer = setTimeout(() => rejectRequest(new Error(`Child RPC ${command.type} timed out after 30 seconds`)), COMMAND_TIMEOUT);
      this.pending.set(id, { resolve: (data) => { clean(); resolve(data as T); }, reject: rejectRequest });
      signal?.addEventListener("abort", abort, { once: true });
      this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n", (error) => { if (error) rejectRequest(error); });
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      for (const request of this.pending.values()) request.reject(new Error("Child closed"));
      this.pending.clear();
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal);
          else this.child.kill(signal);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      };
      if (this.ended) { if (process.platform !== "win32") kill("SIGKILL"); return; }
      // EOF lets Pi dispose tools normally; signals bound cleanup when a tool hangs.
      const terminate = setTimeout(() => kill("SIGTERM"), 1000);
      const force = setTimeout(() => kill("SIGKILL"), 2000);
      this.child.stdin.end();
      try { await this.exited; }
      finally {
        clearTimeout(terminate); clearTimeout(force);
        // The leader can exit while a background tool still occupies its process group.
        if (process.platform !== "win32") kill("SIGKILL");
      }
    })();
    return this.closing;
  }
}
