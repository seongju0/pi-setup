// Files review wire protocol. Formatting belongs exclusively to the sender.
export const MAX_BYTES = 64 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = () => { throw new Error('Invalid Files review data; shorten or split the batch if needed'); };
const check = (ok) => { if (!ok) fail(); };
const string = (s, max, empty = false) => typeof s === 'string' && s.length <= max && !s.includes('\0') && (empty || s.trim().length > 0);
const object = (x, required, optional = []) => {
  check(x && typeof x === 'object' && !Array.isArray(x));
  check(required.every(k => Object.hasOwn(x, k)) && Object.keys(x).every(k => [...required, ...optional].includes(k)));
};
const absolute = s => string(s, 4096) && s.startsWith('/') && !s.split('/').includes('..');
// Source roots are quoted data, not recipient filesystem destinations. Files may
// be on Windows even when the receiver and its inbox are on supported Unix hosts.
const sourceRoot = s => string(s, 4096) && (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s));
const relative = s => string(s, 4096) && !s.startsWith('/') && !s.includes('\\') && s.split('/').every(p => p && p !== '.' && p !== '..');
export function validateId(id) { check(typeof id === 'string' && UUID.test(id)); return id; }
export function validateEndpoint(e) {
  object(e, ['v', 'sessionId', 'terminal', 'instance', 'inbox', 'node', 'cli']);
  check(e.v === 1 && string(e.sessionId, 256) && string(e.terminal, 256) && !e.terminal.includes(':'));
  validateId(e.instance);
  check(absolute(e.inbox) && absolute(e.node) && absolute(e.cli));
  return e;
}
export function validateRequest(r) {
  object(r, ['v', 'id', 'instance', 'target', 'origin', 'instruction', 'comments', 'text']);
  check(Buffer.byteLength(JSON.stringify(r)) <= MAX_BYTES && r.v === 1);
  validateId(r.id); validateId(r.instance);
  object(r.target, ['sessionId', 'terminal']); object(r.origin, ['space', 'tab']);
  check(string(r.target.sessionId, 256) && string(r.target.terminal, 256) && !r.target.terminal.includes(':') && string(r.origin.space, 256) && string(r.origin.tab, 256));
  check(string(r.instruction, 4000, true) && string(r.text, MAX_BYTES) && Buffer.byteLength(r.text) <= MAX_BYTES);
  check(Array.isArray(r.comments) && r.comments.length > 0 && r.comments.length <= 20);
  const ids = new Set();
  for (const c of r.comments) {
    object(c, ['id', 'anchor', 'body']); validateId(c.id); check(!ids.has(c.id)); ids.add(c.id);
    check(string(c.body, 4000));
    const a = c.anchor;
    object(a, ['kind', 'source', 'capturedAt', 'excerpt', 'excerptTruncated', 'viewLimited'], ['path', 'side', 'startLine', 'endLine', 'baseCommit']);
    object(a.source, ['machine', 'root']);
    check((a.source.machine === null || string(a.source.machine, 256)) && sourceRoot(a.source.root));
    check(['file', 'lines', 'changeset'].includes(a.kind) && string(a.excerpt, 2000, true) && typeof a.excerptTruncated === 'boolean' && typeof a.viewLimited === 'boolean');
    check(string(a.capturedAt, 40) && /^\d{4}-\d\d-\d\dT/.test(a.capturedAt) && Number.isFinite(Date.parse(a.capturedAt)));
    if (a.path !== undefined) check(relative(a.path));
    if (a.side !== undefined) check(['worktree', 'old', 'new'].includes(a.side));
    if (a.baseCommit !== undefined) check(a.baseCommit === null || (typeof a.baseCommit === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(a.baseCommit)));
    if (a.kind === 'lines') check(relative(a.path) && ['worktree', 'old', 'new'].includes(a.side) && Number.isSafeInteger(a.startLine) && a.startLine > 0 && Number.isSafeInteger(a.endLine) && a.endLine >= a.startLine);
    else check(a.startLine === undefined && a.endLine === undefined);
    if (a.kind === 'file') check(relative(a.path));
    if (a.kind === 'changeset') check(a.path === undefined && a.side === undefined);
  }
  return r;
}
export function validateResult(r, e, id) {
  object(r, ['v', 'id', 'instance', 'sessionId', 'status'], ['reason']);
  check(r.v === 1 && r.id === validateId(id) && r.instance === e.instance && r.sessionId === e.sessionId && ['handed_to_pi', 'rejected', 'unconfirmed'].includes(r.status));
  if (r.reason !== undefined) check(string(r.reason, 256));
  return r;
}
export function receipt(e, id, status, reason) {
  return { v: 1, id: validateId(id), instance: e.instance, sessionId: e.sessionId, status, ...(reason ? { reason } : {}) };
}
export function matches(r, e) { return r.instance === e.instance && r.target.sessionId === e.sessionId && r.target.terminal === e.terminal; }
