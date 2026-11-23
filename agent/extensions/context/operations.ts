import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Authority = { session_id: string; approval_evidence?: string; confirmed?: boolean };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function operationDigest(action: string, args: Record<string, unknown>): string {
  const { key: _key, ...payload } = args;
  return createHash("sha256").update(JSON.stringify(canonical({ action, ...payload }))).digest("hex");
}
export function replay(db: DatabaseSync, session: string, key: string, digest: string): Record<string, unknown> | undefined {
  if (!session?.trim() || session.length > 200 || !key?.trim() || key.length > 200) throw new Error("Real session_id and key (1–200) are required");
  const row = db.prepare("SELECT digest,result FROM context_operations WHERE session_id=? AND key=?").get(session, key);
  if (!row) return;
  if (row.digest !== digest) throw new Error("Operation key reused with different action/payload");
  return JSON.parse(String(row.result));
}
/** Must run inside the caller's write transaction; accepted replay precedes authority/revision checks. */
export function acceptOperation(db: DatabaseSync, authority: Authority, key: string, digest: string, operation: () => Record<string, unknown>) {
  const accepted = replay(db, authority.session_id, key, digest);
  if (accepted) return accepted;
  if (authority.approval_evidence !== undefined && (typeof authority.approval_evidence !== "string" || !authority.approval_evidence.trim() || authority.approval_evidence.length > 2000)) throw new Error("Invalid approval_evidence");
  if (!authority.approval_evidence?.trim() && authority.confirmed !== true) throw new Error("Explicit approval evidence or native confirmation required");
  const result = operation();
  db.prepare("INSERT INTO context_operations(session_id,key,digest,result,created_at) VALUES(?,?,?,?,?)").run(authority.session_id, key, digest, JSON.stringify(result), new Date().toISOString());
  return result;
}
