import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const isSafeId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const restoreRoot = () => join(homedir(), ".local/state/pi-setup/herdr-sessions");
function ids(coreId, terminal) {
  if (!isSafeId(coreId) || !isSafeId(terminal)) throw new Error("invalid Herdr identity");
}
export function recordPath(coreId, terminal) {
  ids(coreId, terminal);
  return join(restoreRoot(), coreId, `${terminal}.json`);
}
export function promptPath(coreId, terminal, kind) {
  ids(coreId, terminal);
  if (!["system", "append"].includes(kind)) throw new Error("invalid prompt kind");
  return join(restoreRoot(), coreId, `${terminal}.${kind === "system" ? "system" : "append-system"}-prompt.md`);
}

// Only our state directories must be private; existing ~/.local/state may be shared-readable.
// Reject symlink ancestors as well, rather than writing through a redirected state root.
function stateDirectory(directory, create = false) {
  const root = restoreRoot();
  if (directory !== root && dirname(directory) !== root) throw new Error("unsafe restore state path");
  const home = homedir();
  let current = home;
  for (const part of directory.slice(home.length + 1).split("/")) {
    current = join(current, part);
    if (create) {
      try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      ((current === root || dirname(current) === root) && (stat.mode & 0o077))) {
      throw new Error("restore state directory is not private and user-owned");
    }
  }
}
export function readPrivateSync(file) {
  stateDirectory(dirname(file));
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error("restore state file is not private and user-owned");
  }
  return readFileSync(file, "utf8");
}
export function writePrivateSync(file, text) {
  stateDirectory(dirname(file), true);
  try { readPrivateSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
export function removePrivateSync(file) {
  try { readPrivateSync(file); unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export function writeRecordSync(record) {
  if (!parseRecord(JSON.stringify(record))) throw new Error("invalid restore record");
  writePrivateSync(recordPath(record.coreId, record.terminal), JSON.stringify(record) + "\n");
}
const text = (value) => typeof value === "string" && !value.includes("\0");
const absolute = (value) => text(value) && isAbsolute(value) && resolve(value) === value;
const strings = (value) => Array.isArray(value) && value.every(text);
export function parseRecord(source) {
  try {
    const r = JSON.parse(source);
    if (!r || r.version !== 1 || !isSafeId(r.coreId) || !isSafeId(r.terminal) ||
      !text(r.bootId) || !r.bootId || typeof r.eligible !== "boolean" ||
      !(r.sessionFile === "" || absolute(r.sessionFile)) || !text(r.sessionId) || !r.sessionId ||
      !absolute(r.cwd) || !absolute(r.agentDir) || !text(r.invocation?.command) ||
      !strings(r.invocation.args) || !strings(r.replay) || !strings(r.promptFiles) || !strings(r.unsupported)) return;
    // Replay is data crossing a shell-startup boundary, not an arbitrary argv extension.
    const prompts = [];
    let previous = -1;
    const flags = ["--offline", "--models", "--tui-mode", "--system-prompt", "--append-system-prompt"];
    for (let i = 0; i < r.replay.length; i++) {
      const flag = r.replay[i];
      const order = flags.indexOf(flag);
      if (order <= previous) return;
      previous = order;
      if (flag === "--offline") continue;
      const value = r.replay[++i];
      if (!text(value)) return;
      if (order >= 3) {
        if (value !== promptPath(r.coreId, r.terminal, order === 3 ? "system" : "append")) return;
        prompts.push(value);
      }
    }
    if (JSON.stringify(prompts) !== JSON.stringify(r.promptFiles)) return;
    return r;
  } catch { return undefined; }
}
export async function currentBootId() {
  const { stdout } = await execute("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 5000 });
  const id = stdout.trim();
  if (!id) throw new Error("boot identity unavailable");
  return id;
}
export async function hcJson(args) {
  const { stdout } = await execute("hc", args, { encoding: "utf8", timeout: 5000 });
  return JSON.parse(stdout);
}
export function isKeptPane(terminal, address) {
  return terminal?.address === address && terminal.keep === true && !terminal.machine &&
    isSafeId(terminal.labels?.["herdr.space"]) && isSafeId(terminal.labels?.["herdr.tab"]);
}
