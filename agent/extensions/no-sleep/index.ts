/** Local macOS idle-sleep inhibition. MIT; see the repository root LICENSE. */

import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Scope = "session" | "agent";
type Level = "info" | "warning" | "error";

export default function (pi: ExtensionAPI): void {
  let started = false;
  let configValid = true;
  let enabled = false;
  let scope: Scope = "session";
  let display = false;
  let busy = false;
  let child: ChildProcess | undefined;
  let failure: string | undefined;

  const usage = "/no-sleep [status|on|off|session|agent|help]";
  const correction = "Invalid no-sleep configuration. Correct PI_NO_SLEEP (0/1), PI_NO_SLEEP_SCOPE (session/agent), or PI_NO_SLEEP_DISPLAY (0/1), then reload.";

  function report(ctx: ExtensionContext, message: string, level: Level = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
    else process.stderr.write(`[no-sleep] ${message}\n`);
  }

  function release(): void {
    const owned = child;
    child = undefined;
    owned?.kill("SIGTERM");
  }

  function fail(ctx: ExtensionContext, message: string): void {
    failure = message;
    report(ctx, `Idle-sleep inhibition unavailable: ${message}. Use /no-sleep on to retry.`, "error");
  }

  function reconcile(ctx: ExtensionContext): void {
    const wanted = started && configValid && process.platform === "darwin" &&
      enabled && !failure && (scope === "session" || busy);
    if (!wanted) {
      release();
      return;
    }
    if (child) return;

    const preference = process.env.PI_NO_SLEEP_DISPLAY ?? "";
    if (!["", "0", "1"].includes(preference)) {
      configValid = false;
      report(ctx, correction, "warning");
      return;
    }
    display = preference === "1";
    let acquired: ChildProcess;
    try {
      acquired = spawn("/usr/bin/caffeinate",
        ["-i", "-s", ...(display ? ["-d"] : []), "-w", String(process.pid)],
        { stdio: "ignore" });
    } catch (error) {
      fail(ctx, error instanceof Error ? error.message : String(error));
      return;
    }
    child = acquired;
    acquired.on("error", (error) => {
      if (child !== acquired) return;
      child = undefined;
      fail(ctx, error.message);
    });
    acquired.on("exit", (code, signal) => {
      if (child !== acquired) return;
      child = undefined;
      fail(ctx, `helper exited (${signal ?? code})`);
    });
    acquired.unref();
  }

  function status(): string {
    let state: string;
    if (!configValid) state = "off (invalid configuration; correct environment and reload)";
    else if (process.platform !== "darwin") state = "unsupported platform";
    else if (failure) state = "failed";
    else if (child) state = `running (OS assertion not independently verified), PID ${child.pid}`;
    else if (enabled && scope === "agent") state = "waiting for agent";
    else state = "off";
    return `No-sleep: ${enabled ? "enabled" : "disabled"}; scope: ${scope}; display inhibition: ${display ? "on" : "off"}; helper: ${state}.`;
  }

  pi.on("session_start", (_event, ctx) => {
    const policy = process.env.PI_NO_SLEEP ?? "";
    const lifetime = process.env.PI_NO_SLEEP_SCOPE ?? "";
    const preference = process.env.PI_NO_SLEEP_DISPLAY ?? "";
    configValid = ["", "0", "1"].includes(policy) &&
      ["", "session", "agent"].includes(lifetime) &&
      ["", "0", "1"].includes(preference);
    enabled = configValid && policy !== "0";
    scope = configValid && lifetime === "agent" ? "agent" : "session";
    display = configValid && preference === "1";
    started = true;
    busy = !ctx.isIdle();
    if (!configValid) report(ctx, correction, "warning");
    reconcile(ctx);
  });
  pi.on("agent_start", (_event, ctx) => {
    busy = true;
    reconcile(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    busy = false;
    reconcile(ctx);
  });
  pi.on("session_shutdown", () => {
    started = false;
    release();
  });

  pi.registerCommand("no-sleep", {
    description: "Control local macOS idle-sleep inhibition",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (!["", "status", "on", "off", "session", "agent", "help"].includes(action)) {
        report(ctx, usage, "warning");
        return;
      }
      if (action === "help") {
        report(ctx, `${usage}\nBare/status: show policy and helper state. on/off: enable/disable. session/agent: select scope without enabling. Local execution host only; idle-sleep inhibition is not a guarantee against lid-close or explicit sleep.`);
        return;
      }
      if (action === "" || action === "status") {
        report(ctx, status());
        return;
      }
      busy = !ctx.isIdle();
      if (action === "off") {
        enabled = false;
        failure = undefined;
      } else if (!configValid) {
        report(ctx, correction, "warning");
        return;
      } else if (action === "on") {
        enabled = true;
        failure = undefined;
      } else {
        scope = action as Scope;
      }
      reconcile(ctx);
      report(ctx, status(), action === "on" && process.platform !== "darwin" ? "warning" : "info");
    },
  });
}
