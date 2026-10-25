import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { relative } from "node:path";
import { atomicWrite, mutate, rootPath, safePath } from "./storage.ts";
import { applyChanges, validate, type Changes, type ContextPolicy } from "./state.ts";

export type TighteningInput = { reason: string; consult_on_demand_decisions?: string[]; consult_on_demand_artifacts?: string[]; restore_decisions?: string[]; restore_artifacts?: string[]; retire_artifacts?: string[] } & Pick<Changes, "current_state" | "next_actions" | "references">;
export async function tighten(root: string, id: string, revision: number, input: TighteningInput, signal?: AbortSignal) {
  root = await rootPath(root);
  return mutate(root, id, revision, async (todo, item) => {
    const { current_state, next_actions, references, retire_artifacts = [], restore_decisions = [], restore_artifacts = [], consult_on_demand_decisions = [], consult_on_demand_artifacts = [], reason } = input;
    const changes = Object.fromEntries(Object.entries({ current_state, next_actions, references }).filter(([, value]) => value !== undefined));
    const next = applyChanges(todo, changes);
    for (const artifactId of retire_artifacts) {
      const artifact = next.artifacts.find(a => a.id === artifactId);
      if (!artifact) throw new Error("Retired artifacts must be existing artifact IDs");
      artifact.required = false; artifact.lifecycle = "reference"; // Still readable on demand; never deleted.
    }
    // Additive: hide lists extend the saved policy and restore lists remove from it, so partial calls never unhide earlier items.
    const prior = todo.context_policy;
    const merge = (saved: string[] = [], add: string[], remove: string[], records: { id: string }[]) => {
      if (remove.some(id => !records.some(row => row.id === id))) throw new Error("Context policy must contain unique existing record IDs");
      return [...new Set([...saved, ...add])].filter(id => !remove.includes(id));
    };
    const policy: ContextPolicy = { reason, consult_on_demand_decisions: merge(prior?.consult_on_demand_decisions, consult_on_demand_decisions, restore_decisions, next.decisions), consult_on_demand_artifacts: merge(prior?.consult_on_demand_artifacts, consult_on_demand_artifacts, restore_artifacts, next.artifacts) };
    next.context_policy = policy;
    validate(next); // Validate IDs and required material before writing any file.
    const before = { current_state: todo.current_state, next_actions: todo.next_actions, references: todo.references };
    const after = { current_state: next.current_state, next_actions: next.next_actions, references: next.references };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      // Preserve replaced receipts and detail off the normal load path, using the existing immutable artifact pattern.
      const artifactId = randomUUID();
      const path = `artifacts/${artifactId}-${todo.revision + 1}.md`;
      next.artifacts.push({ id: artifactId, path, title: "Context before tightening", kind: "context-history", description: "Previous state, actions and references; historical snapshot, not current authorization.", lifecycle: "reference", required: false, applies_to: [] });
      validate(next);
      const base = relative(root, item.directory);
      await mkdir(await safePath(root, `${base}/artifacts`), { recursive: true, mode: 0o700 });
      await atomicWrite(await safePath(root, `${base}/${path}`), `# Context before tightening\n\nReason: ${policy.reason}\n\nSaved revision: ${todo.revision}\n\n\`\`\`json\n${JSON.stringify(before, null, 2)}\n\`\`\`\n`);
    }
    return next;
  }, signal);
}
