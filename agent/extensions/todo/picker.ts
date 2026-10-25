import { getSelectListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, SelectList, Text, truncateToWidth, type SelectItem } from "@earendil-works/pi-tui";
import { dependencyState } from "./dependencies.ts";
import type { Located } from "./storage.ts";

const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
const progress = {
  todo: { mark: "[ ]", label: "Not started", rank: 2 },
  in_progress: { mark: "[~]", label: "In progress", rank: 0 },
  done: { mark: "[✓]", label: "Done", rank: 3 },
  canceled: { mark: "[-]", label: "Canceled", rank: 4 },
};
const ongoing = (row: Located) => !["done", "canceled"].includes(row.todo.status);
const sorted = (rows: Located[]) => [...rows].sort((a, b) => progress[a.todo.status].rank - progress[b.todo.status].rank || a.todo.title.localeCompare(b.todo.title));

export async function pickTodo(ctx: ExtensionContext, rows: Located[]): Promise<string | undefined> {
  let project: Located | undefined;
  let completed = false;
  const completedRoots = rows.filter(row => !row.parent_id && row.todo.status === "done");
  for (;;) {
    const visible = sorted(rows.filter(row => project ? row.parent_id === project.todo.id : !row.parent_id && (completed ? row.todo.status === "done" : ongoing(row))));
    const items: SelectItem[] = visible.map(row => {
      const dependency = dependencyState(rows, row);
      const state = { ...progress[row.todo.status] };
      if (row.todo.status === "todo" && !dependency.dependencies_satisfied) {
        state.label = dependency.review_required ? "Review required" : "Waiting";
        if (row.todo.status === "todo") state.mark = "[!]";
      }
      const children = rows.filter(child => child.parent_id === row.todo.id);
      return {
        value: row.todo.id,
        label: `${row.todo.type === "project" ? "▸" : state.mark} ${clean(row.todo.title)}`,
        description: row.todo.type === "project" ? `${children.filter(child => child.todo.status === "done").length}/${children.length} done · ${state.label}` : state.label,
      };
    });
    if (project) items.unshift({ value: "resume-project", label: "◎ Resume project overview", description: "Attach project context" });
    else if (!completed && completedRoots.length) items.push({ value: "completed", label: "▸ Completed", description: `${completedRoots.length} projects / standalone todos` });
    const completedIndex = items.findIndex(item => item.value === "completed");
    if (!items.length) { ctx.ui.notify("No ongoing work. Create it with /todo new simple|project.", "info"); return; }
    const title = project ? `${completed ? "Completed" : "Todos"} › ${clean(project.todo.title)}` : completed ? "Completed" : "Your todos";
    const backLabel = project && completed ? "← Back to completed" : "← Back to all todos";
    const preview = (value?: string) => {
      if (value === "completed") return { status: "Browse completed projects and standalone todos. Loading their preserved context does not reopen them.", goal: "" };
      const row = value === "resume-project" ? project : rows.find(row => row.todo.id === value);
      if (!row) return { status: "No status summary saved yet.", goal: "" };
      const dependency = dependencyState(rows, row);
      const waiting = dependency.waiting_on.map(item => `${clean(item.title)} (${item.status})`).join(", ");
      return {
        status: `${waiting ? `Waiting on: ${waiting}. ` : ""}${row.todo.current_state.summary.trim() || "No status summary saved yet."}`,
        goal: row.todo.outcome,
      };
    };
    let choice: string | undefined;
    if (ctx.mode !== "tui") {
      // RPC clients support ordinary dialogs, not custom terminal components.
      const labels = items.map((item, index) => `${index + 1}. ${item.label} · ${item.description}`);
      if (project || completed) labels.push(backLabel);
      const answer = await ctx.ui.select(title, labels);
      choice = answer === backLabel ? "back" : items[labels.indexOf(answer ?? "")]?.value;
    } else {
      choice = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
        const pageSize = () => Math.min(10, Math.max(1, Math.floor(tui.terminal.rows * 0.85) - (completedIndex >= 0 ? 20 : 19)));
        const makeList = (size: number) => {
          const list = new SelectList(items, size, getSelectListTheme(), {
            minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 80,
            truncatePrimary: ({ text, maxWidth, item }) => {
              const label = truncateToWidth(text, maxWidth, "");
              return item.value === "completed" ? theme.fg("error", label) : label;
            },
          });
          list.onSelect = item => done(item.value);
          list.onCancel = () => done(project || completed ? "back" : undefined);
          return list;
        };
        let size = pageSize(); let list = makeList(size);
        const content = new Box(2, 1);
        content.addChild({
          render(width) {
            const detail = preview(list.getSelectedItem()?.value);
            const lines = (text: string, limit: number) => {
              const wrapped = new Text(clean(text), 0, 0).render(width);
              return wrapped.slice(0, limit).map((line, index) => wrapped.length > limit && index === limit - 1 ? truncateToWidth(line, Math.max(0, width - 1), "") + "…" : line);
            };
            const listLines = list.render(width);
            if (completedIndex >= 0) {
              // Match SelectList's centered viewport; the gap is visual, never a selectable dummy row.
              const selected = items.findIndex(item => item.value === list.getSelectedItem()?.value);
              const start = Math.max(0, Math.min(selected - Math.floor(size / 2), items.length - size));
              if (completedIndex >= start && completedIndex < start + size) listLines.splice(completedIndex - start, 0, "");
            }
            return [
              theme.fg("accent", theme.bold(title)), "", ...listLines, "",
              theme.fg("border", "─".repeat(width)), theme.fg("accent", "Latest status"),
              ...lines(detail.status, 3), "", theme.fg("accent", "Goal"),
              ...lines(detail.goal, 2),
              "", theme.fg("muted", "↑↓ move · Enter open/resume · Esc back/close"),
            ].map(line => truncateToWidth(line, width));
          },
          invalidate() { list.invalidate(); },
        });
        return {
          render(width) {
            if (size !== pageSize()) {
              const index = items.findIndex(item => item.value === list.getSelectedItem()?.value);
              size = pageSize(); list = makeList(size); list.setSelectedIndex(index);
            }
            const inner = Math.max(1, width - 2);
            const edge = (left: string, right: string) => theme.fg("border", left + "─".repeat(inner) + right);
            return [
              edge("╭", "╮"),
              ...content.render(inner).map(line => theme.fg("border", "│") + line + theme.fg("border", "│")),
              edge("╰", "╯"),
            ].map(line => truncateToWidth(line, width));
          },
          invalidate() { content.invalidate(); },
          handleInput(data) { list.handleInput(data); tui.requestRender(); },
        };
      }, { overlay: true, overlayOptions: { width: 110, maxHeight: "85%", anchor: "center", margin: 1 } });
    }
    if (!choice) return;
    if (choice === "back") { if (project) project = undefined; else completed = false; continue; }
    if (choice === "completed") { completed = true; continue; }
    if (choice === "resume-project") return project!.todo.id;
    const row = visible.find(row => row.todo.id === choice);
    if (!row) return;
    if (row.todo.type === "project") { project = row; continue; }
    return row.todo.id;
  }
}
