import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { atomicWrite, list, mutate, rootPath, safePath, type Located } from "./storage.ts";
import { validate, type Artifact } from "./state.ts";

export type ArtifactInput = Omit<Artifact, "id" | "path"> & { id?: string; body?: string };
export async function saveArtifact(root: string, id: string, revision: number, input: ArtifactInput, signal?: AbortSignal): Promise<Located> {
  root = await rootPath(root);
  return mutate(root, id, revision, async (todo, item) => {
    const existing = todo.artifacts.find(row => row.id === input.id);
    if (input.id && !existing) throw new Error("Artifact ID not found; omit id to create");
    if (!existing && input.body === undefined) throw new Error("New artifacts require a Markdown body");
    if (input.body !== undefined && (!input.body.trim() || input.body.length > 100000)) throw new Error("Artifact body must contain 1–100000 characters");
    const children = (await list(root)).filter(row => row.parent_id === todo.id).map(row => row.todo.id);
    if (input.applies_to.some(child => !children.includes(child))) throw new Error("Artifact relevance must reference direct children of its owner");
    const artifactId = existing?.id ?? randomUUID();
    const path = input.body === undefined ? existing!.path : `artifacts/${artifactId}-${todo.revision + 1}.md`;
    const { body, ...metadata } = input;
    const artifact: Artifact = { ...metadata, id: artifactId, path };
    const index = todo.artifacts.findIndex(row => row.id === artifactId);
    if (index < 0) todo.artifacts.push(artifact); else todo.artifacts[index] = artifact;
    if (todo.context_policy && (body !== undefined || artifact.required)) todo.context_policy.consult_on_demand_artifacts = todo.context_policy.consult_on_demand_artifacts.filter(hidden => hidden !== artifactId);
    validate(todo);
    // Immutable content revisions are written first; an interrupted commit leaves an unreferenced file, never a torn document.
    if (body !== undefined) {
      const base = relative(root, item.directory);
      const directory = await safePath(root, `${base}/artifacts`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicWrite(await safePath(root, `${base}/${path}`), `${body.trim()}\n`);
    }
    return todo;
  }, signal, true);
}
export async function readArtifact(root: string, item: Located, artifactId: string): Promise<string> {
  root = await rootPath(root);
  const artifact = item.todo.artifacts.find(row => row.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  return readFile(await safePath(root, `${relative(root, item.directory)}/${artifact.path}`), "utf8");
}
