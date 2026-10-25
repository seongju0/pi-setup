import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMcpExtension, getAgentDir, getPackageDir, type ExtensionAPI, type ExtensionContext, type LoadedMcpConfig } from "@earendil-works/pi-coding-agent";

/** Personal-only executable policy; never consult project settings. Read on each MCP launch. */
export async function mcpPolicyPath(): Promise<string | undefined> {
  let text: string;
  try { text = await readFile(join(getAgentDir(), "settings.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const settings = JSON.parse(text);
  const policy = settings.subagents?.mcpPolicy;
  if (policy === undefined) return undefined;
  if (typeof policy !== "string" || !policy.trim()) throw new Error("subagents.mcpPolicy must be a non-empty path string in personal settings");
  return policy === "~" ? homedir() : policy.startsWith("~/") ? join(homedir(), policy.slice(2)) : resolve(getAgentDir(), policy);
}

export async function selectedMcpConfig(names: string[], cwd: string, projectTrusted: boolean): Promise<LoadedMcpConfig> {
  // Pi exports the MCP factory but not its config loader; reuse its merge/auth semantics.
  const { loadMcpConfig } = await import(pathToFileURL(join(getPackageDir(), "dist/extensions/mcp/config.js")).href);
  const loaded: LoadedMcpConfig = loadMcpConfig({ agentDir: getAgentDir(), cwd, projectTrusted });
  if (loaded.errors.length) throw new Error(`MCP configuration: ${loaded.errors.join("; ")}`);
  const servers = names.map((name) => {
    const entry = loaded.servers.find((server) => server.name === name);
    if (!entry || entry.config.enabled === false) throw new Error(`MCP server ${name} is unknown or disabled; no servers were substituted`);
    return entry;
  });
  return { servers, autoEnableCodemode: true, errors: [] };
}

/** Child-only MCP integration: unselected servers never enter the connection/resource registry. */
export function selectedMcpExtension(names: string[], policy?: (pi: ExtensionAPI) => void | Promise<void>) {
  return async (pi: ExtensionAPI) => {
    // Await the policy before even initializing MCP. A failed factory cannot leave MCP enabled.
    if (policy !== undefined) await policy(pi);
    let selected: LoadedMcpConfig = { servers: [], errors: [] };
    const extension = createMcpExtension({
      loadConfig: () => selected,
      updateConfig: () => { throw new Error("Subagents cannot change MCP configuration; ask the parent"); },
    });
    // Reset first: a failed reload must not reconnect a previous configuration.
    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
      selected = { servers: [], errors: [] };
      selected = await selectedMcpConfig(names, ctx.cwd, ctx.isProjectTrusted());
    });
    await extension(pi);
  };
}
