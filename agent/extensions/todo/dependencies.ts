import type { Located } from "./storage.ts";

export function validateGraph(rows: Located[]) {
  const byId = new Map(rows.map(row => [row.todo.id, row]));
  const counts = new Map<string, number>(); const downstream = new Map<string, string[]>();
  for (const row of rows) {
    counts.set(row.todo.id, row.todo.depends_on.length);
    if (row.todo.type !== "simple" && row.todo.depends_on.length) throw new Error("Only simple todos can have dependencies");
    for (const id of row.todo.depends_on) {
      const target = byId.get(id);
      if (!target) throw new Error(`Dependency does not exist: ${id}`);
      if (id === row.todo.id) throw new Error("Todo cannot depend on itself");
      if (target.todo.type !== "simple" || target.parent_id !== row.parent_id) throw new Error("Dependencies must reference simple peers in the same scope");
      downstream.set(id, [...(downstream.get(id) ?? []), row.todo.id]);
    }
  }
  const ready = rows.filter(row => !row.todo.depends_on.length).map(row => row.todo.id);
  for (let index = 0; index < ready.length; index++) for (const id of downstream.get(ready[index]) ?? []) {
    const remaining = counts.get(id)! - 1; counts.set(id, remaining); if (!remaining) ready.push(id);
  }
  if (ready.length !== rows.length) throw new Error("Todo dependencies contain a cycle");
}

export function prerequisites(rows: Located[], item: Located): Located[] {
  const byId = new Map(rows.map(row => [row.todo.id, row]));
  const seen = new Set<string>(); const pending = [...item.todo.depends_on]; const result: Located[] = [];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue; seen.add(id);
    const row = byId.get(id); if (!row) throw new Error(`Dependency does not exist: ${id}`);
    result.push(row); pending.push(...row.todo.depends_on);
  }
  return result;
}
export function dependencyState(rows: Located[], item: Located) {
  const waiting = prerequisites(rows, item).filter(row => row.todo.status !== "done");
  return {
    dependencies_satisfied: !waiting.length,
    waiting_on: waiting.map(row => ({ id: row.todo.id, title: row.todo.title, status: row.todo.status })),
    review_required: waiting.some(row => row.todo.status === "canceled") || waiting.length > 0 && item.todo.status === "done",
  };
}
export function dependencyView(rows: Located[], item: Located) {
  // ponytail: scan the small scope on demand; cache ancestor sets if large projects make this measurable.
  return { ...dependencyState(rows, item), dependents: rows.filter(row => row.todo.type === "simple" && row.parent_id === item.parent_id && prerequisites(rows, row).some(parent => parent.todo.id === item.todo.id)).map(row => row.todo.id) };
}
export function validateTransition(before: Located, after: Located, rows: Located[], reassert = false) {
  validateGraph(rows);
  const entering = after.todo.status !== before.todo.status;
  const changedEdges = JSON.stringify(after.todo.depends_on) !== JSON.stringify(before.todo.depends_on);
  if ((entering || changedEdges || reassert) && after.todo.status === "done") {
    const state = dependencyState(rows, after);
    if (!state.dependencies_satisfied) throw new Error(`Cannot complete todo; waiting on: ${state.waiting_on.map(row => row.title).join(", ")}`);
  }
}
export function effects(rows: Located[], item: Located) {
  const dependency = dependencyView(rows, item);
  return {
    ...item, dependency,
    affected_dependents: rows.filter(row => dependency.dependents.includes(row.todo.id)).map(row => ({ id: row.todo.id, title: row.todo.title, status: row.todo.status, revision: row.todo.revision, ...dependencyState(rows, row) })),
  };
}
