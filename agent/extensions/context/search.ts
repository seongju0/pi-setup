import type { Todo } from "./state.ts";
import type { Located } from "./storage.ts";
import { summary } from "./session.ts";

export function discoverySummary(item: Located, titles: ReadonlyMap<string, string>) {
  return { ...summary(item), outcome: item.todo.outcome, parent_id: item.parent_id ?? null, parent_title: item.parent_id ? titles.get(item.parent_id)! : null };
}

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function search(rows: Located[], query: string, status?: Todo["status"], type?: Todo["type"]) {
  const phrase = normalize(query);
  if (!phrase) throw new Error("query must contain letters or numbers");
  const terms = phrase.split(" ");
  const titles = new Map(rows.map(row => [row.todo.id, row.todo.title]));
  const matches = [];
  for (const row of rows) {
    if (status && row.todo.status !== status || type && row.todo.type !== type) continue;
    const title = normalize(row.todo.title), goal = normalize(row.todo.outcome);
    if (!terms.every(term => title.includes(term) || goal.includes(term))) continue;
    const inTitle = terms.some(term => title.includes(term));
    const inGoal = terms.some(term => goal.includes(term));
    let rank: number;
    if (title === phrase) rank = 1;
    else if (title.includes(phrase)) rank = 2;
    else if (terms.every(term => title.includes(term))) rank = 3;
    else if (inTitle) rank = 4;
    else rank = 5;
    const matched_in = inTitle && inGoal ? "both" : inTitle ? "title" : "goal";
    matches.push({ row, title, rank, matched_in });
  }
  matches.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title) || a.row.todo.id.localeCompare(b.row.todo.id));
  return matches.map(({ row, matched_in }) => ({ ...discoverySummary(row, titles), matched_in }));
}
