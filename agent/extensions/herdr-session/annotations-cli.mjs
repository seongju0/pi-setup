import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, realpathSync, writeFileSync, linkSync, unlinkSync, renameSync, readdirSync, mkdirSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MAX_BYTES, validateEndpoint, validateRequest, validateId, validateResult, receipt, matches } from './annotations-protocol.mjs';

const safeError = () => new Error('Files review endpoint unavailable or unsafe');
function privateStat(s, directory = false) {
  if (s.uid !== process.getuid?.() || (s.mode & 0o077) || (directory ? !s.isDirectory() : !s.isFile())) throw safeError();
}
export function checkInbox(e) {
  validateEndpoint(e);
  if (realpathSync(e.inbox) !== e.inbox) throw safeError();
  privateStat(lstatSync(e.inbox), true);
}
export function readPrivate(file, max = MAX_BYTES) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd); privateStat(s);
    if (s.size > max) throw safeError();
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size <= max) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > max) throw safeError();
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally { closeSync(fd); }
}
export function atomicRecord(e, name, data, replace = false) {
  checkInbox(e);
  const temporary = join(e.inbox, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    if (replace) renameSync(temporary, join(e.inbox, name));
    else linkSync(temporary, join(e.inbox, name));
  } finally { try { unlinkSync(temporary); } catch {} }
}
export function manifest(e) {
  checkInbox(e);
  const m = readPrivate(join(e.inbox, 'manifest.json'));
  if (!m || typeof m.open !== 'boolean' || !Object.keys(e).every(k => validateEndpoint(m.endpoint)[k] === e[k])) throw safeError();
  return m;
}
function exists(e, name) {
  try { lstatSync(join(e.inbox, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function status(e, id) {
  validateEndpoint(e); validateId(id);
  try {
    checkInbox(e);
    // A recorded handoff remains true after the receiver closes.
    if (exists(e, `${id}.result.json`)) return validateResult(readPrivate(join(e.inbox, `${id}.result.json`)), e, id);
  } catch { /* Unavailable or ambiguous records are not evidence of rejection. */ }
  return receipt(e, id, 'unconfirmed', 'No confirmed handoff result; do not automatically resend');
}
export async function send(e, r) {
  validateEndpoint(e); validateRequest(r);
  if (!matches(r, e)) return receipt(e, r.id, 'rejected', 'Recipient identity mismatch');
  let published = false;
  let locked = false;
  try {
    checkInbox(e);
    if (['result', 'request', 'claimed'].some(s => exists(e, `${r.id}.${s}.json`))) return status(e, r.id);
    if (!manifest(e).open) return receipt(e, r.id, 'rejected', 'Receiver stopped before publication');
    // Serialize admission, not delivery. A crash-held lock fails closed, never replays work.
    mkdirSync(join(e.inbox, '.admission'), { mode: 0o700 }); locked = true;
    if (['result', 'request', 'claimed'].some(s => exists(e, `${r.id}.${s}.json`))) return status(e, r.id);
    const count = readdirSync(e.inbox).filter(n => /\.(request|claimed)\.json$/.test(n)).length;
    if (count >= 20) return receipt(e, r.id, 'rejected', 'Receiver has too many outstanding requests');
    if (!manifest(e).open) return receipt(e, r.id, 'rejected', 'Receiver stopped before publication');
    atomicRecord(e, `${r.id}.request.json`, r); published = true;
  } catch (error) {
    // Another helper may already be publishing this same ID. Admission contention
    // is not proof that the batch was rejected, and must never suggest a resend.
    if (error.code === 'EEXIST') return status(e, r.id);
    return receipt(e, r.id, published ? 'unconfirmed' : 'rejected', published ? 'Delivery unconfirmed' : 'Request was not published');
  } finally { if (locked) try { rmdirSync(join(e.inbox, '.admission')); } catch {} }
  const deadline = Date.now() + 5000;
  do {
    const result = status(e, r.id);
    if (result.status !== 'unconfirmed') return result;
    await delay(50);
  } while (Date.now() < deadline);
  return status(e, r.id);
}
async function main(args) {
  if (args.length !== 3 || !['send', 'status'].includes(args[0])) throw new Error('Usage: annotations-cli.mjs send <endpoint-json> <submission-json> | status <endpoint-json> <id>');
  if (Buffer.byteLength(args[1]) > 16384 || Buffer.byteLength(args[2]) > MAX_BYTES) throw new Error('Files review data exceeds bounds; shorten or split the batch');
  const e = validateEndpoint(JSON.parse(args[1]));
  return args[0] === 'send' ? send(e, validateRequest(JSON.parse(args[2]))) : status(e, validateId(args[2]));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch { console.error('Invalid or unavailable Files review request; shorten or split the batch if needed'); process.exitCode = 1; }
}
