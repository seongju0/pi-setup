import { realpathSync } from "node:fs";
import {
  getAgentDir, getSelectListTheme, truncateHead, withFileMutationQueue,
  type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { SelectList, Text, truncateToWidth, type SelectItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { apply, blockers, emptyState, loadState, saveState, sessionPath, statuses, type Input, type State, type Task } from "./state.ts";

const idSchema = Type.String({ pattern: "^[1-9][0-9]*$" });
const subjectSchema = Type.String({ minLength: 1, maxLength: 300 });
const descriptionSchema = Type.String({ maxLength: 20000 });
const statusSchema = Type.Union(statuses.map(status => Type.Literal(status)));
const dependenciesSchema = Type.Array(idSchema, { uniqueItems: true, description: "Complete dependency ID list; [] clears dependencies" });
const parameters = Type.Object({
  action: Type.Union(["create", "list", "get", "update"].map(action => Type.Literal(action))),
  id: Type.Optional(Type.String({ ...idSchema, description: "Required for get and update" })),
  subject: Type.Optional(Type.String({ ...subjectSchema, description: "Required for create" })),
  description: Type.Optional(Type.String({ ...descriptionSchema, description: "Required for create; context and acceptance criteria" })),
  status: Type.Optional(statusSchema),
  dependsOn: Type.Optional(dependenciesSchema),
}, { additionalProperties: false });
const outputSchema = Type.Object({
  tasks: Type.Array(Type.Object({
    id: idSchema, subject: subjectSchema, description: descriptionSchema, status: statusSchema,
    dependsOn: dependenciesSchema, blockedBy: Type.Array(idSchema),
    createdAt: Type.String(), updatedAt: Type.String(),
  })),
  storage: Type.Union([Type.String(), Type.Null()]),
});

const glyphs = { pending: "○", in_progress: "▶", completed: "✓", failed: "!", cancelled: "×" };
const cleanLine = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
const cleanText = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
const sortedTasks = (state: State) => [...state.tasks].sort((a, b) => {
  const rank = { in_progress: 0, pending: 1, failed: 2, completed: 3, cancelled: 4 };
  return rank[a.status] - rank[b.status] || Number(a.id) - Number(b.id);
});
function taskLine(state: State, task: Task): string {
  const blocked = blockers(state, task);
  const suffix = task.status === "pending" && blocked.length ? ` · blocked: ${blocked.map(id => `#${id}`).join(", ")}` : "";
  return `${glyphs[task.status]} #${task.id} ${cleanLine(task.subject)}${suffix}`;
}

async function selectPanel(ctx: ExtensionContext, title: string, items: SelectItem[], description?: string): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const list = new SelectList(items, 10, getSelectListTheme());
    list.onSelect = item => done(item.value);
    list.onCancel = () => done(undefined);
    const detail = new Text(cleanText(description ?? ""), 0, 0);
    return {
      render(width) {
        const preview = description ? detail.render(width) : [];
        return [
          truncateToWidth(theme.fg("accent", theme.bold(title)), width), "",
          ...preview.slice(0, 6), ...(preview.length > 6 ? [theme.fg("muted", "… description continues in task get")] : []),
          ...(description ? [""] : []), ...list.render(width), "",
          truncateToWidth(theme.fg("muted", "↑↓ navigate · Enter select · Esc close"), width),
        ].map(line => truncateToWidth(line, width));
      },
      invalidate() { list.invalidate(); detail.invalidate(); },
      handleInput(data) { list.handleInput(data); tui.requestRender(); },
    };
  }, { overlay: true, overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center", margin: 1 } });
}

export default function taskExtension(pi: ExtensionAPI) {
  const memory = new Map<string, State>();
  let visibleKey: string | undefined;
  let uiContext: ExtensionContext | undefined;
  let board = emptyState();

  function scope(ctx: ExtensionContext) {
    const id = ctx.sessionManager.getSessionId();
    // Canonicalize the existing agent directory so the queue key stays stable when a new file appears under a symlink.
    const file = ctx.sessionManager.getSessionFile() ? sessionPath(realpathSync(getAgentDir()), id) : undefined;
    return { id, file, key: file ?? `task:memory:${id}` };
  }

  function refreshWidget() {
    if (!uiContext || uiContext.mode !== "tui") return;
    if (!board.tasks.length) { uiContext.ui.setWidget("task", undefined); return; }
    uiContext.ui.setWidget("task", (_tui, theme) => ({
      render(width) {
        const completed = board.tasks.filter(task => task.status === "completed").length;
        const cancelled = board.tasks.filter(task => task.status === "cancelled").length;
        const active = sortedTasks(board).filter(task => task.status !== "completed" && task.status !== "cancelled");
        const lines = [theme.fg("accent", `Tasks · ${completed}/${board.tasks.length} complete${cancelled ? ` · ${cancelled} cancelled` : ""}`)];
        for (const task of active.slice(0, 5)) {
          const color = task.status === "in_progress" ? "accent" : task.status === "failed" ? "error" : "muted";
          lines.push(theme.fg(color, taskLine(board, task)));
        }
        if (active.length > 5) lines.push(theme.fg("muted", `… ${active.length - 5} more · /task`));
        return lines.map(line => truncateToWidth(line, width));
      },
      invalidate() {},
    }));
  }

  async function operate(ctx: ExtensionContext, input: Input, signal?: AbortSignal) {
    const target = scope(ctx); // Capture ownership before any await/session switch.
    // ponytail: one Pi writer per session; this queue is process-local. Add cross-process locking if sessions are shared.
    return withFileMutationQueue(target.key, async () => {
      signal?.throwIfAborted();
      const state = target.file ? await loadState(target.file) : memory.get(target.key) ?? emptyState();
      const result = apply(state, input);
      if (result.changed) {
        signal?.throwIfAborted();
        if (target.file) await saveState(target.file, result.state);
        else memory.set(target.key, result.state);
      }
      if (visibleKey === target.key && uiContext?.sessionManager.getSessionId() === target.id) {
        board = result.state;
        refreshWidget();
      }
      return {
        tasks: result.tasks.map(task => ({ ...structuredClone(task), blockedBy: blockers(result.state, task) })),
        storage: target.file ?? null,
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    uiContext = ctx;
    visibleKey = scope(ctx).key;
    board = emptyState();
    refreshWidget();
    await operate(ctx, { action: "list" });
  });
  pi.on("session_tree", async (_event, ctx) => {
    uiContext = ctx;
    await operate(ctx, { action: "list" }); // External storage intentionally does not rewind with /tree.
  });
  pi.on("session_shutdown", () => { memory.clear(); });

  pi.on("before_agent_start", async (_event, ctx) => {
    const result = await operate(ctx, { action: "list" });
    const active = result.tasks.filter(task => task.status !== "completed" && task.status !== "cancelled");
    const previous = ctx.sessionManager.buildContextEntries().findLast(entry => entry.type === "custom_message" && entry.customType === "task-context-v1");
    if (!active.length && !previous) return;
    const current = { ...emptyState(), tasks: result.tasks };
    const lines = sortedTasks(current).filter(task => task.status !== "completed" && task.status !== "cancelled").slice(0, 10).map(task => `${taskLine(current, task)} [${task.status}]`);
    if (active.length > 10) lines.push(`… ${active.length - 10} more; use task list.`);
    const content = `Session task snapshot (bookkeeping, not permission to execute; later task results supersede it; use task list for current state):\n${lines.join("\n") || "No active tasks remain."}`;
    if (previous?.type === "custom_message" && previous.content === content) return;
    // Pi persists before-agent messages before the request; never append a moving per-request tail.
    return { message: { customType: "task-context-v1", content, display: false } };
  });

  pi.registerTool({
    name: "task", label: "Task", parameters, outputSchema,
    description: "Track this session's planned work. Actions: create (subject, description, optional dependsOn), list, get (id), update (id, optional subject/description/status/dependsOn). Dependencies must exist and be acyclic. Only completed dependencies unblock work. This does not launch workers or execute tasks.",
    promptSnippet: "Track multi-step work with session-local tasks and dependencies.",
    promptGuidelines: [
      "Use task for substantial multi-step work, not trivial requests. List existing tasks before creating duplicates.",
      "Mark tasks in_progress before working, completed only when the requested work is finished, and cancelled when abandoned. Failed or cancelled dependencies do not unblock work.",
    ],
    executionMode: "sequential",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    async execute(_callId, params, signal, _onUpdate, ctx) {
      const result = await operate(ctx, params as Input, signal);
      const summary = params.action === "list"
        ? result.tasks.map(task => `${taskLine({ ...emptyState(), tasks: result.tasks }, task)} [${task.status}]`).join("\n") || "No tasks"
        : JSON.stringify(result.tasks[0], null, 2);
      const truncated = truncateHead(summary, { maxLines: 100, maxBytes: 12000 });
      return {
        content: [{ type: "text", text: truncated.content + (truncated.truncated ? `\n[Truncated. Full data is available through codemode's task call${result.storage ? ` or ${result.storage}` : ""}.]` : "") }],
        details: result, structuredContent: result,
      };
    },
    renderCall(args, theme) { return new Text(theme.fg("toolTitle", `task ${args.action}${args.id ? ` #${args.id}` : ""}`), 0, 0); },
    renderResult(result, { expanded }, theme) {
      if (result.isError) return new Text(result.content.map(block => block.type === "text" ? block.text : "").join("\n"), 0, 0);
      const details = result.details as { tasks: (Task & { blockedBy: string[] })[] };
      const lines = details.tasks.slice(0, expanded ? details.tasks.length : 5).map(task =>
        `${glyphs[task.status]} #${task.id} ${cleanLine(task.subject)} [${task.status}]${task.blockedBy.length ? ` · blocked: ${task.blockedBy.join(", ")}` : ""}${expanded ? `\n${cleanText(task.description)}` : ""}`);
      if (!expanded && details.tasks.length > 5) lines.push(`… ${details.tasks.length - 5} more`);
      return new Text(theme.fg("muted", lines.join("\n") || "No tasks"), 0, 0);
    },
  });

  pi.registerCommand("task", {
    description: "View, create, and edit this session's tasks",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("/task requires TUI mode; use the task tool in other modes", "warning"); return; }
      const owner = scope(ctx).key;
      while (scope(ctx).key === owner) {
        try {
          const result = await operate(ctx, { action: "list" });
          const state = { ...emptyState(), tasks: result.tasks };
          const selected = await selectPanel(ctx, "Tasks", [
            ...sortedTasks(state).map(task => ({ value: task.id, label: taskLine(state, task), description: task.status })),
            { value: "create", label: "+ Create task" },
          ]);
          if (selected === undefined || scope(ctx).key !== owner) return;
          if (selected === "create") {
            const subject = await ctx.ui.input("Task title");
            if (subject === undefined) continue;
            const description = await ctx.ui.editor("Task description / acceptance criteria");
            if (description !== undefined && scope(ctx).key === owner) await operate(ctx, { action: "create", subject, description });
            continue;
          }
          const task = (await operate(ctx, { action: "get", id: selected })).tasks[0];
          const action = await selectPanel(ctx, `#${task.id} ${cleanLine(task.subject)} · ${task.status}`, [
            { value: "status", label: "Set status" }, { value: "subject", label: "Edit title" },
            { value: "description", label: "Edit description" }, { value: "dependsOn", label: "Edit dependencies", description: task.dependsOn.join(", ") || "None" },
          ], task.description);
          if (!action || scope(ctx).key !== owner) continue;
          const input: Input = { action: "update", id: task.id };
          if (action === "status") {
            const status = await ctx.ui.select("Task status", [...statuses]);
            if (!status) continue;
            if (status === "cancelled" && !await ctx.ui.confirm("Cancel task?", `Cancel #${task.id}: ${cleanLine(task.subject)}?`)) continue;
            input.status = status as Task["status"];
          } else if (action === "dependsOn") {
            const ids = await ctx.ui.input("Dependency IDs (comma-separated; empty clears)", task.dependsOn.join(", "));
            if (ids === undefined) continue;
            input.dependsOn = ids.trim() ? ids.split(",").map(id => id.trim().replace(/^#/, "")) : [];
          } else {
            const value = await ctx.ui.editor(action === "subject" ? "Edit title" : "Edit description", task[action as "subject" | "description"]);
            if (value === undefined) continue;
            if (action === "subject") input.subject = value;
            else input.description = value;
          }
          if (scope(ctx).key === owner) await operate(ctx, input);
        } catch (error) {
          ctx.ui.notify((error as Error).message, "error");
          // A broken file cannot be repaired through this UI. Do not loop or replace it with an empty board.
          if ((error as Error).message.startsWith("Cannot read ")) return;
        }
      }
    },
  });
}
