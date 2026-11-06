import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { SessionManager, parseSessionEntries, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

export function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 200 || /[\\/\x00-\x20\x7f]/.test(value) || value === "." || value === "..") throw new Error("Invalid history identifier");
  return value;
}

export function historyRef(session: string, entry: string) {
  return `pi-history:v1/${encodeURIComponent(identifier(session))}/${encodeURIComponent(identifier(entry))}`;
}

export function parseRef(ref: string) {
  const match = /^pi-history:v1\/([^/]+)\/([^/]+)$/.exec(ref);
  if (!match) throw new Error("Invalid history reference (expected pi-history:v1/session/entry)");
  try { return { session: identifier(decodeURIComponent(match[1])), entry: identifier(decodeURIComponent(match[2])) }; }
  catch { throw new Error("Invalid history reference identifiers"); }
}

export async function readEntry(ctx: ExtensionContext, ref: string, signal?: AbortSignal): Promise<SessionEntry> {
  signal?.throwIfAborted();
  const { session, entry } = parseRef(ref);
  if (session === ctx.sessionManager.getSessionId()) {
    const found = ctx.sessionManager.getEntry(entry);
    if (!found) throw new Error("History entry missing or deleted");
    return found;
  }
  const dir = ctx.sessionManager.getSessionDir();
  const file = SessionManager.findById(ctx.cwd, session, dir);
  if (!file) throw new Error("History session missing, deleted, or outside this working directory");
  const [root, canonical] = await Promise.all([realpath(dir), realpath(file)]);
  const inside = relative(root, canonical);
  if (!inside || inside === ".." || inside.startsWith("../") || isAbsolute(inside)) throw new Error("History source outside session directory");
  const bytes = await readFile(canonical, { encoding: "utf8", signal });
  const entries = parseSessionEntries(bytes);
  const header = entries[0];
  if (!header || header.type !== "session" || header.version !== 3 || header.id !== session || typeof header.cwd !== "string" || resolve(header.cwd) !== resolve(ctx.cwd)) throw new Error("History source header is invalid or outside this working directory");
  const found = entries.find((candidate): candidate is SessionEntry => candidate.type !== "session" && candidate.id === entry);
  if (!found) throw new Error("History entry missing or deleted");
  signal?.throwIfAborted();
  return found;
}
