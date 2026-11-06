import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask as terminalAsk } from './prompts.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const stat = async name => { try { return await fs.lstat(name); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
async function resolved(name) {
  try { return await fs.realpath(name); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const parent = path.dirname(name);
    if (parent === name) throw e;
    return path.join(await resolved(parent), path.basename(name));
  }
}
async function json(name) { return JSON.parse(await fs.readFile(name, 'utf8')); }
async function findPi(env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    const name = path.resolve(dir || '.', 'pi');
    try { await fs.access(name, 1); if ((await fs.stat(name)).isFile()) return name; } catch {}
  }
  return null;
}

function preferenceChanges(base, current, keys = []) {
  const changes = [];
  for (const [key, value] of Object.entries(base)) {
    const names = [...keys, key];
    if (object(value) && (current[key] === undefined || object(current[key]))) changes.push(...preferenceChanges(value, current[key] || {}, names));
    else if (JSON.stringify(value) !== JSON.stringify(current[key])) changes.push({ keys: names, old: current[key], value, conflict: Object.hasOwn(current, key) });
  }
  return changes;
}
function setPreference(settings, change) {
  let at = settings;
  for (const key of change.keys.slice(0, -1)) {
    if (!Object.hasOwn(at, key)) Object.defineProperty(at, key, { value: {}, enumerable: true, writable: true, configurable: true });
    at = at[key];
  }
  Object.defineProperty(at, change.keys.at(-1), { value: change.value, enumerable: true, writable: true, configurable: true });
}

// Read-only: only explicitly declared resources and preference defaults belong to setup.
export async function inspectSetup({ root = checkout, env = process.env } = {}) {
  root = await fs.realpath(root);
  if (!env.HOME) throw new Error('HOME must be set.');
  const home = path.resolve(env.HOME);
  const requested = env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
  const target = await resolved(path.resolve(requested === '~' ? home : requested.startsWith('~/') ? path.join(home, requested.slice(2)) : requested));
  if (inside(root, target) || inside(target, root)) throw new Error('Unsafe layout: checkout and agent destination must be separate, non-nested directories.');
  const settingsPath = path.join(target, 'settings.json');
  const settingsStat = await stat(settingsPath);
  if (settingsStat?.isSymbolicLink()) throw new Error('settings.json is a symlink. Setup does not replace or write through it; use a regular settings file in a separate agent directory.');
  if (settingsStat && !settingsStat.isFile()) throw new Error('settings.json must be a regular JSON file.');
  const settings = settingsStat ? await json(settingsPath) : {};
  if (!object(settings)) throw new Error('settings.json must contain a JSON object; repair it before setup.');
  const manifest = await json(path.join(root, 'manifests/resources.json'));
  const base = await json(path.join(root, 'agent/settings.base.json'));
  if (!object(base) || 'packages' in base) throw new Error('Base preferences must be an object without packages.');
  const links = [];
  for (const group of ['instructions', 'extensions', 'support', 'skills']) {
    if (!Array.isArray(manifest[group])) throw new Error(`Invalid resource group: ${group}`);
    for (const source of manifest[group]) {
      if (typeof source !== 'string' || !source.startsWith('agent/') || source.split('/').some(x => x === '..' || x === '.' || !x)) throw new Error(`Invalid resource path: ${source}`);
      const relative = source.slice(6);
      if (['extensions', 'skills', 'settings.json'].includes(relative)) throw new Error(`Cannot link resource root: ${source}`);
      const from = path.join(root, source);
      if (!inside(root, await fs.realpath(from))) throw new Error(`Resource escapes checkout: ${source}`);
      const to = path.join(target, relative);
      const parent = await resolved(path.dirname(to));
      if (inside(root, parent)) throw new Error(`Resource destination resolves into checkout: ${to}`);
      const current = await stat(to);
      const correct = current?.isSymbolicLink() && path.resolve(path.dirname(to), await fs.readlink(to)) === from;
      links.push({ group, relative, from, to, status: correct ? 'linked' : current ? 'conflict' : 'missing' });
    }
  }
  return { root, home, target, settingsPath, settingsExists: !!settingsStat, settings, base, links,
    preferences: preferenceChanges(base, settings), pi: await findPi(env) };
}

export async function runSetup({ root = checkout, env = process.env, ask, log = console.log, dryRun = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('This setup currently supports macOS only.');
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Node.js >=26.0.0 is required. Use your existing installation owner to select it.');
  const info = await inspectSetup({ root, env });
  if (!info.pi) throw new Error('Pi is required on PATH. Install Pi yourself, then rerun setup.');
  if (!dryRun && typeof ask !== 'function') throw new Error('Interactive setup requires a terminal prompt.');
  const links = info.links.filter(link => link.status === 'missing');
  const preferences = info.preferences.filter(change => !change.conflict);
  log(`\nSetup preview\n  Agent: ${info.target}\n  Checkout: ${info.root}\n  Links: ${links.length} new; ${info.links.filter(link => link.status === 'linked').length} current; ${info.links.filter(link => link.status === 'conflict').length} conflicts skipped\n  Defaults: ${preferences.length} missing; ${info.preferences.filter(change => change.conflict).length} local values preserved`);
  for (const link of links) log(`LINK ${link.to} -> ${link.from}`);
  for (const link of info.links.filter(link => link.status === 'conflict')) log(`SKIP ${link.to} (existing resource; resolve manually)`);
  for (const change of preferences) log(`SET settings.${change.keys.join('.')}: ${JSON.stringify(change.value)}`);
  for (const change of info.preferences.filter(change => change.conflict)) log(`KEEP settings.${change.keys.join('.')} (existing local value)`);
  if (dryRun) { log('Dry run: no prompts or writes.'); return { ...info, applied: false }; }
  if (!links.length && !preferences.length) { log('No changes needed. Local conflicts and settings were preserved.'); return { ...info, applied: false }; }
  const backupBase = await resolved(path.join(info.home, '.local/state/pi-setup/backups'));
  if (inside(info.root, backupBase) || inside(info.target, backupBase)) throw new Error('Backup directory must be outside the checkout and agent destination.');
  if (!await ask('apply', 'Apply safe changes?', false)) { log('Cancelled; no setup changes applied. Any source update remains in place.'); return { ...info, applied: false }; }
  let backup;
  try {
    if (info.settingsExists && preferences.length) {
      await fs.mkdir(backupBase, { recursive: true, mode: 0o700 });
      backup = await fs.mkdtemp(path.join(backupBase, 'run-'));
      await fs.chmod(backup, 0o700);
      await fs.copyFile(info.settingsPath, path.join(backup, 'settings.json'));
      await fs.chmod(path.join(backup, 'settings.json'), 0o600);
      log(`Original settings saved: ${backup}/settings.json`);
    }
    for (const link of links) {
      await fs.mkdir(path.dirname(link.to), { recursive: true });
      await fs.symlink(link.from, link.to);
    }
    if (preferences.length) {
      const settings = structuredClone(info.settings);
      for (const change of preferences) setPreference(settings, change);
      await fs.mkdir(info.target, { recursive: true });
      await fs.writeFile(info.settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    }
  } catch (error) {
    throw new Error(`Setup stopped: ${error.message} Earlier approved changes may remain. ${backup ? `Original settings are in ${backup}.` : 'Existing resources were not replaced.'} No rollback was attempted.`, { cause: error });
  }
  log(`Applied: ${links.length} resource links, ${preferences.length} missing defaults. Reload idle Pi sessions yourself when ready.`);
  return { ...await inspectSetup({ root, env }), applied: true, backup };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(x => !['--help', '--dry-run'].includes(x))) throw new Error('Unknown argument. Use --help.');
  if (args.includes('--help')) { console.log('Usage: ./setup.sh [--dry-run] [--help]\nLink Pi resources and add missing preference defaults. Existing files and settings are preserved.\nRequires macOS, existing Pi on PATH, and Node >=26.0.0. Dry run makes no changes.'); return; }
  const dryRun = args.includes('--dry-run');
  if (!dryRun && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Interactive setup requires a TTY. Run ./setup.sh in a terminal, or use --dry-run.');
  await runSetup({ dryRun, ask: terminalAsk });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
