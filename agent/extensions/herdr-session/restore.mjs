import { constants, accessSync, closeSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { currentBootId, hcJson, isKeptPane, isSafeId, parseRecord, readPrivateSync, recordPath, writeRecordSync } from "./restore-record.mjs";

function notice(reason, record) {
  const clean = (text) => text.replace(/[\x00-\x1f\x7f]/g, " ");
  const file = record?.sessionFile;
  const hint = file ? ` Resume manually: pi --session '${clean(file).replaceAll("'", "'\\''")}'` : "";
  process.stderr.write(`pi-setup: Pi session not restored (${clean(reason)}).${hint}\n`);
}
function readHeader(file) {
  const fd = openSync(file, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(4096);
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null))) {
      const newline = buffer.subarray(0, count).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, newline < 0 ? count : newline)));
      if (newline >= 0) break;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { closeSync(fd); }
}
function validateLaunch(record) {
  if (record.unsupported.length) throw new Error(record.unsupported.join(", "));
  try { if (!record.sessionFile || !statSync(record.sessionFile).isFile()) throw new Error(); }
  catch { throw new Error("session file missing or not a regular file"); }
  let header;
  try { header = readHeader(record.sessionFile); } catch { throw new Error("session file header invalid"); }
  if (header.type !== "session" || header.id !== record.sessionId || header.cwd !== record.cwd) throw new Error("session file header does not match saved session");
  try { if (!statSync(record.cwd).isDirectory()) throw new Error(); } catch { throw new Error("session cwd unavailable"); }
  if (!isAbsolute(record.agentDir)) throw new Error("agent directory is not absolute");
  try {
    if (!isAbsolute(record.invocation.command) || !statSync(record.invocation.command).isFile()) throw new Error();
    accessSync(record.invocation.command, constants.X_OK);
  } catch { throw new Error("Pi executable unavailable"); }
  for (const arg of record.invocation.args) {
    try { if (!isAbsolute(arg) || !statSync(arg).isFile()) throw new Error(); } catch { throw new Error("Pi entry file unavailable"); }
  }
  for (const file of record.promptFiles) {
    try { readPrivateSync(file); } catch { throw new Error("private prompt file unavailable or unsafe"); }
  }
}
async function main() {
  const terminal = process.env.HC_TERMINAL_ID;
  const status = process.argv[2] === "status";
  const pid = process.argv[2];
  if (process.platform !== "darwin" || !isSafeId(terminal) || (!status && (!/^[1-9][0-9]*$/.test(pid ?? "") || !Number.isSafeInteger(Number(pid))))) return;
  let record;
  try {
    const boot = status ? undefined : await currentBootId();
    // The shell's filename guard is cheap; the current core chooses one record.
    // No cross-core session selection or newest-file search is performed here.
    let core;
    try { core = (await hcJson(["server", "status"]))?.core?.id; } catch { throw new Error("Herdr core unavailable"); }
    if (!isSafeId(core)) throw new Error("Herdr core identity unavailable");
    try { record = parseRecord(readPrivateSync(recordPath(core, terminal))); }
    catch (error) { if (error.code === "ENOENT") return; throw new Error("private restore record unavailable or unsafe"); }
    if (!record || record.coreId !== core || record.terminal !== terminal) return;
    if (status) {
      process.stdout.write(JSON.stringify({ sessionFile: record.sessionFile, cwd: record.cwd, eligible: record.eligible, unsupported: record.unsupported }) + "\n");
      return;
    }
    if (!record.eligible || record.bootId === boot) return;
    let pane;
    try { pane = await hcJson(["get", terminal]); } catch { throw new Error("Herdr terminal unavailable"); }
    if (!isKeptPane(pane, terminal) || pane.pid !== Number(pid)) return;
    try { writeRecordSync({ ...record, eligible: false }); } catch { throw new Error("restore record could not be consumed"); }
    validateLaunch(record);
    process.stdout.write([record.cwd, record.agentDir, record.invocation.command, ...record.invocation.args, ...record.replay, "--session", record.sessionFile].join("\0"));
  } catch (error) { notice(error instanceof Error ? error.message : "restore unavailable", record); }
}
await main();
