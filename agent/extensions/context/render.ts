import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { cleanLabel, statusCard, statusText, todoStyles } from "./internal/status-style.ts";

type Row = { id: string; title: string; status: keyof typeof todoStyles; type: string; revision: number; depends_on?: string[]; outcome?: string; parent_id?: string; parent_title?: string; dependency?: Dependency };
type Dependency = { dependencies_satisfied: boolean; waiting_on: { title: string }[]; review_required?: boolean };
const record = (value: any): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
function isRow(value: any): value is Row {
  return record(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.type === "string"
    && typeof value.revision === "number" && Object.hasOwn(todoStyles, value.status)
    && [value.outcome, value.parent_id, value.parent_title].every(field => field === undefined || field === null || typeof field === "string");
}
function waiting(dependency: any, hasPrerequisites = false): string | undefined {
  if (!record(dependency) || !Array.isArray(dependency.waiting_on)) return;
  const names = dependency.waiting_on.flatMap((item: any) => record(item) && typeof item.title === "string" ? [cleanLabel(item.title)] : []);
  return names.length ? `Waiting on: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` (+${names.length - 3})` : ""}`
    : hasPrerequisites && dependency.dependencies_satisfied === true ? "Prerequisites satisfied" : undefined;
}

/** Pure display adapter: never reads the store or changes execute/model/structured results. */
export const renderTodoResult: NonNullable<ToolDefinition["renderResult"]> = (result, { expanded, isPartial }, theme, context) => {
  const fallback = () => {
    const lines = result.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").split("\n");
    const preview = !expanded && lines.length > 10
      ? [...lines.slice(0, 10), theme.fg("muted", `… ${lines.length - 10} more lines · expand for full text`)] : lines;
    return new Text(preview.join("\n"), 0, 0);
  };
  if (result.isError || isPartial) return fallback();
  const data = result.details;
  const args = context?.args ?? {};
  const lines: string[] = [];
  const addRow = (row: Row, dependency?: any) => {
    const style = todoStyles[row.status];
    lines.push(`${statusText(theme, style.tone, style.label, style.glyph)}  ${cleanLabel(row.title)}`);
    lines.push(theme.fg("muted", `${cleanLabel(row.type)} · r${row.revision}${row.parent_title ? ` · under ${cleanLabel(row.parent_title)}` : row.parent_id ? ` · parent ${cleanLabel(row.parent_id)}` : ""}`));
    const readiness = waiting(dependency ?? row.dependency, Array.isArray(row.depends_on) && row.depends_on.length > 0);
    if (readiness) lines.push(statusText(theme, readiness.startsWith("Waiting") ? "warning" : "muted", readiness));
    if (dependency?.review_required || row.dependency?.review_required) lines.push(statusText(theme, "warning", "Dependency review required"));
    if (expanded) {
      lines.push(theme.fg("dim", cleanLabel(row.id)));
      if (row.outcome) lines.push(cleanLabel(row.outcome).slice(0, 800));
    }
  };
  if (Array.isArray(data)) {
    if (!data.every(isRow)) return fallback();
    const rows: Row[] = data;
    const fullList = args.action === "list" && args.include_done === true;
    // Search/filtered lists are subsets, never a progress denominator for the whole project.
    const summary = fullList ? `${rows.filter(row => row.status === "done").length}/${rows.length} done · ${rows.filter(row => row.status === "canceled").length} canceled`
      : `${rows.length} ${args.action === "search" ? (rows.length === 1 ? "match" : "matches") : args.action === "list" ? "open" : "items"} · ${rows.filter(row => row.status === "in_progress").length} in progress`;
    const limit = expanded ? 20 : 5;
    for (const row of rows.slice(0, limit)) addRow(row);
    if (rows.length > limit) lines.push(theme.fg("muted", `… ${rows.length - limit} more · use a narrower search/get`));
    return statusCard(theme, `Project (durable) · ${summary}`, lines);
  }
  if (!record(data)) return fallback();
  if (isRow(data.todo)) {
    addRow(data.todo, data.dependency);
    return statusCard(theme, args.action ? `Project (durable) · ${cleanLabel(args.action)}` : "Project (durable) · Saved", lines);
  }
  if (isRow(data.selected)) {
    addRow(data.selected);
    return statusCard(theme, "Project (durable) · Attached", lines);
  }
  if (data.selected === null || data.detached === true) return statusCard(theme, "Project (durable)", [theme.fg("muted", "No project attached")]);
  if (typeof data.selected === "string" && typeof data.title === "string" && typeof data.revision === "number" && data.context_loaded === true) {
    const readiness = waiting(data.dependency);
    return statusCard(theme, "Project (durable) · Attached", [cleanLabel(data.title), theme.fg("muted", `r${data.revision} · Context loaded`), ...(readiness ? [statusText(theme, data.dependency?.dependencies_satisfied ? "muted" : "warning", readiness)] : [])]);
  }
  if (typeof data.selected === "string" && data.context_loaded === true) return statusCard(theme, "Project (durable)", [theme.fg("muted", "Context refreshed")]);
  return fallback();
};

export const renderCheckpointResult: NonNullable<ToolDefinition["renderResult"]> = (result, options, theme, context) => {
  if (record(result.details) && isRow(result.details.todo) && !result.isError && !options.isPartial) {
    const row = result.details.todo;
    return statusCard(theme, "Project (durable) · Saved", [statusText(theme, "success", `r${row.revision} · ${row.title}`, "✓")]);
  }
  return renderTodoResult(result, options, theme, context);
};
