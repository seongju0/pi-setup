import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const statuses = ["pending", "in_progress", "completed", "failed", "cancelled"] as const;
export type Status = (typeof statuses)[number];
export type Task = {
  id: string;
  subject: string;
  description: string;
  status: Status;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
};
export type State = { version: 1; nextId: number; tasks: Task[] };
export type Input = {
  action: "create" | "list" | "get" | "update";
  id?: string;
  subject?: string;
  description?: string;
  status?: Status;
  dependsOn?: string[];
};

export const emptyState = (): State => ({ version: 1, nextId: 1, tasks: [] });

export function sessionPath(agentDir: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Invalid task session ID");
  return join(agentDir, "tasks", "sessions", `${sessionId}.json`);
}

function validateTasks(tasks: Task[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Duplicate task IDs");
  for (const task of tasks) {
    if (typeof task.id !== "string" || !/^[1-9]\d*$/.test(task.id) || !Number.isSafeInteger(Number(task.id))) throw new Error("Invalid task ID");
    if (typeof task.subject !== "string" || !task.subject.trim() || task.subject.length > 300 || /[\r\n]/.test(task.subject)) {
      throw new Error("Task subject must be a single line of 1–300 characters");
    }
    if (typeof task.description !== "string" || task.description.length > 20000) throw new Error("Invalid task description");
    if (!statuses.includes(task.status)) throw new Error("Invalid task status");
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some(id => typeof id !== "string")) throw new Error("Invalid dependencies");
    if (new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error("Duplicate dependencies");
    if (![task.createdAt, task.updatedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date)))) {
      throw new Error("Invalid task timestamps");
    }
    for (const id of task.dependsOn) {
      if (id === task.id) throw new Error(`Task #${id} cannot depend on itself`);
      if (!byId.has(id)) throw new Error(`Dependency #${id} does not exist`);
    }
  }
  // Kahn's algorithm checks the entire graph without a recursive call-stack limit.
  const remaining = new Map(tasks.map(task => [task.id, task.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const id of task.dependsOn) {
      const children = dependents.get(id) ?? [];
      children.push(task.id);
      dependents.set(id, children);
    }
  }
  const ready = tasks.filter(task => !task.dependsOn.length).map(task => task.id);
  for (let index = 0; index < ready.length; index++) {
    for (const id of dependents.get(ready[index]) ?? []) {
      const count = remaining.get(id)! - 1;
      remaining.set(id, count);
      if (!count) ready.push(id);
    }
  }
  if (ready.length !== tasks.length) throw new Error("Task dependencies contain a cycle");
}

export function parseState(value: unknown): State {
  if (!value || typeof value !== "object") throw new Error("Invalid task file");
  const state = value as State;
  if (state.version !== 1) throw new Error(`Unsupported task format version: ${state.version}`);
  if (!Array.isArray(state.tasks) || state.tasks.some(task => !task || typeof task !== "object")) throw new Error("Invalid task list");
  validateTasks(state.tasks);
  if (!Number.isSafeInteger(state.nextId) || state.nextId < 1 || state.tasks.some(task => Number(task.id) >= state.nextId)) {
    throw new Error("Invalid task ID counter");
  }
  return state;
}

export function blockers(state: State, task: Task): string[] {
  return task.dependsOn.filter(id => state.tasks.find(candidate => candidate.id === id)?.status !== "completed");
}

export function apply(state: State, input: Input): { state: State; tasks: Task[]; changed: boolean } {
  if (input.action === "list") return { state, tasks: state.tasks, changed: false };
  if (input.action === "get") {
    const task = state.tasks.find(task => task.id === input.id);
    if (!task) throw new Error(`Task #${input.id ?? "?"} does not exist`);
    return { state, tasks: [task], changed: false };
  }
  if (input.action !== "create" && input.action !== "update") throw new Error("Unknown task action");
  const next = structuredClone(state);
  const now = new Date().toISOString();
  let task: Task;
  if (input.action === "create") {
    if (input.subject === undefined || input.description === undefined) throw new Error("Create requires subject and description");
    task = {
      id: String(next.nextId++), subject: input.subject.trim(), description: input.description,
      status: "pending", dependsOn: [...(input.dependsOn ?? [])], createdAt: now, updatedAt: now,
    };
    next.tasks.push(task);
  } else {
    const existing = next.tasks.find(task => task.id === input.id);
    if (!existing) throw new Error(`Task #${input.id ?? "?"} does not exist`);
    task = existing;
    if (input.subject !== undefined) task.subject = input.subject.trim();
    if (input.description !== undefined) task.description = input.description;
    if (input.status !== undefined) task.status = input.status;
    if (input.dependsOn !== undefined) task.dependsOn = [...input.dependsOn];
    task.updatedAt = now;
  }
  parseState(next);
  const blockedBy = blockers(next, task);
  if ((task.status === "in_progress" || task.status === "completed") && blockedBy.length) {
    throw new Error(`Task #${task.id} is blocked by ${blockedBy.map(id => `#${id}`).join(", ")}`);
  }
  return { state: next, tasks: [task], changed: true };
}

export async function loadState(file: string): Promise<State> {
  try {
    return parseState(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`);
  }
}

export async function saveState(file: string, state: State): Promise<void> {
  parseState(state);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
