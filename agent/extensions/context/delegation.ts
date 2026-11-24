import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { artifactBytes, decodeOwner, withExistingRead } from "./database.ts";
import { artifactPathPattern } from "./state.ts";
import { configuredRoot } from "./storage.ts";
import { PAGE_CHARS, textPage } from "./internal/retrieval.ts";

export const artifactDelegationProtocol = "context-artifact-read-v1";
export type ArtifactGrant = { id: string; artifact_id: string; expected_version: string };
export type ArtifactDelegation = { protocol: typeof artifactDelegationProtocol; root: string; artifacts: ArtifactGrant[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function record(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error("Invalid artifact delegation fields");
}
function grant(value: unknown): ArtifactGrant {
  record(value, ["id", "artifact_id", "expected_version"]);
  if (typeof value.id !== "string" || !uuid.test(value.id) || typeof value.artifact_id !== "string" || !uuid.test(value.artifact_id)) throw new Error("Artifact delegation requires complete owner and artifact UUIDs");
  if (typeof value.expected_version !== "string" || value.expected_version.length > 2000 || !artifactPathPattern.test(value.expected_version)) throw new Error("Invalid artifact expected_version");
  return { id: value.id, artifact_id: value.artifact_id, expected_version: value.expected_version };
}
function grants(value: unknown): ArtifactGrant[] {
  if (!Array.isArray(value) || !value.length) throw new Error("Artifact delegation requires nonempty artifacts");
  const result = value.map(grant);
  if (new Set(result.map(row => `${row.id}/${row.artifact_id}`)).size !== result.length) throw new Error("Duplicate artifact delegation target");
  return result;
}
/** Pure validation: restored children can load even when the store or source is unavailable. */
export function validateArtifactDelegation(value: unknown): ArtifactDelegation {
  record(value, ["protocol", "root", "artifacts"]);
  if (value.protocol !== artifactDelegationProtocol) throw new Error("Unsupported artifact delegation protocol");
  if (typeof value.root !== "string" || !value.root.trim() || value.root.includes("\0") || !isAbsolute(value.root)) throw new Error("Artifact delegation requires an absolute saved root");
  return { protocol: artifactDelegationProtocol, root: value.root, artifacts: grants(value.artifacts) };
}
function body(db: DatabaseSync, root: string, target: ArtifactGrant): string {
  const row = db.prepare("SELECT id,document FROM owners WHERE id=?").get(target.id);
  if (!row) throw new Error("Assigned artifact owner is unavailable; report to parent");
  const item = decodeOwner(root, row);
  const artifact = item.todo.artifacts.find(row => row.id === target.artifact_id);
  if (!artifact) throw new Error("Assigned artifact is unavailable; report to parent");
  if (artifact.path !== target.expected_version) throw new Error("Assigned artifact changed; report the version mismatch to parent for direction. Do not drop the pin.");
  return artifactBytes(db, target.id, artifact.path).toString("utf8");
}
/** Initial spawn preparation only: capture the parent's configured root and verify all pins. */
export function prepareArtifactDelegation(artifacts: unknown, signal?: AbortSignal): ArtifactDelegation {
  const targets = grants(artifacts);
  return withExistingRead(configuredRoot(), (db, root) => {
    for (const target of targets) body(db, root, target);
    return { protocol: artifactDelegationProtocol, root, artifacts: targets };
  }, signal);
}
export function readDelegatedArtifactPage(delegation: ArtifactDelegation, input: ArtifactGrant & { offset?: number; limit?: number }, signal?: AbortSignal) {
  const config = validateArtifactDelegation(delegation);
  record(input, ["id", "artifact_id", "expected_version", "offset", "limit"]);
  const target = grant({ id: input.id, artifact_id: input.artifact_id, expected_version: input.expected_version });
  if (!config.artifacts.some(row => row.id === target.id && row.artifact_id === target.artifact_id && row.expected_version === target.expected_version)) throw new Error("Artifact request is outside the assigned scope; report missing material to parent");
  const offset = input.offset === undefined ? 0 : input.offset, limit = input.limit === undefined ? PAGE_CHARS : input.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_CHARS) throw new Error("Invalid artifact page offset/limit");
  return withExistingRead(config.root, (db, root) => {
    const { text, ...page } = textPage(body(db, root, target), offset, limit);
    return { id: target.id, artifact_id: target.artifact_id, version: target.expected_version, body: text, ...page };
  }, signal);
}
