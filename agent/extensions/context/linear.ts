import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { locate, mutate, type Located } from "./storage.ts";
import { linearUrl } from "./state.ts";

function toolName(ctx: ExtensionToolContext, suffix: string): string {
  const matches = ctx.tools.filter(tool => tool.name.endsWith(`linear__${suffix}`) || tool.name === `linear_${suffix}`);
  if (matches.length !== 1) throw new Error(`Linear ${suffix} tool unavailable or ambiguous. Connect the Linear MCP server first.`);
  return matches[0].name;
}
async function call(ctx: ExtensionToolContext, suffix: string, args: unknown, signal?: AbortSignal): Promise<any> {
  const result = await ctx.executeTool(toolName(ctx, suffix), args, { signal });
  if (result.isError) throw new Error(`Linear ${suffix} failed: ${JSON.stringify(result.result.content)}`);
  const data = result.result.structuredContent;
  if (data !== undefined) return data;
  const text = result.result.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
  try { return JSON.parse(text); } catch { throw new Error(`Linear ${suffix} did not return JSON`); }
}
export async function syncLinear(root: string, id: string, revision: number, ctx: ExtensionToolContext, target?: string, signal?: AbortSignal): Promise<Located> {
  const item = await locate(root, id);
  if (item.todo.revision !== revision) throw new Error("Stale revision; read the todo before syncing");
  if (!item.todo.linear) throw new Error("Todo has no linked Linear issue");
  const url = linearUrl(item.todo.linear.url);
  const identifier = new URL(url).pathname.split("/")[3];
  let issue = await call(ctx, "get_issue", { id: identifier }, signal);
  if (issue.url !== url) throw new Error("Linear returned a different issue URL");
  if (target) {
    if (!ctx.hasUI) throw new Error("Linear writes require interactive confirmation; read-only refresh works in all modes");
    if (item.todo.linear.coverage === "partial") throw new Error("Partial-issue todos cannot change the parent issue status. Update Linear explicitly after reviewing the whole issue.");
    const statuses = await call(ctx, "list_issue_statuses", { team: issue.teamId ?? issue.team }, signal);
    const selected = statuses.find((status: any) => status.name === target);
    if (!selected) throw new Error("Unknown team status; use an exact status returned by Linear");
    if (!await ctx.ui.confirm("Update Linear issue?", `${url}\n${issue.status} → ${target}\nLocal todo progress remains separate. Confirm you reviewed the whole issue's scope.`)) throw new Error("Linear update not approved");
    const fresh = await call(ctx, "get_issue", { id: identifier }, signal);
    if (fresh.updatedAt !== issue.updatedAt || fresh.status !== issue.status) throw new Error("Linear changed during confirmation; refresh and review again");
    // Ensure the local link/revision did not change during the remote confirmation either.
    if ((await locate(root, id)).todo.revision !== revision) throw new Error("Local todo changed during confirmation; review again");
    await call(ctx, "save_issue", { id: issue.uuid ?? identifier, state: selected.id }, signal);
    issue = await call(ctx, "get_issue", { id: identifier }, signal);
    if (issue.status !== target) throw new Error("Linear did not confirm the requested status; inspect the issue before retrying");
  }
  try {
    return await mutate(root, id, revision, todo => {
      todo.linear = { ...todo.linear!, status: issue.status, status_type: issue.statusType, refreshed_at: new Date().toISOString() }; return todo;
    }, signal);
  } catch (error) {
    throw new Error(`${target ? "Linear was updated but the local snapshot was not saved." : "Linear was read but the local snapshot was not saved."} ${(error as Error).message} Refresh again; do not repeat the external write blindly.`);
  }
}
