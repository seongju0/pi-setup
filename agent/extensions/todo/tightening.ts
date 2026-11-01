import { mutate, rootPath } from "./storage.ts";
import { applyChanges, validate, type Changes, type ContextPolicy } from "./state.ts";

export type TighteningInput = { reason: string; consult_on_demand_decisions?: string[]; consult_on_demand_artifacts?: string[]; restore_decisions?: string[]; restore_artifacts?: string[]; retire_artifacts?: string[] } & Pick<Changes, "current_state" | "references">;
export async function tighten(root: string, id: string, revision: number, input: TighteningInput, signal?: AbortSignal) {
  root = await rootPath(root);
  return mutate(root, id, revision, todo => {
    const { current_state, references, retire_artifacts = [], restore_decisions = [], restore_artifacts = [], consult_on_demand_decisions = [], consult_on_demand_artifacts = [], reason } = input;
    const changes = Object.fromEntries(Object.entries({ current_state, references }).filter(([, value]) => value !== undefined));
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
    return next;
  }, signal);
}
