import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { planTools, applyTools } from './tools.mjs';
import { ask as terminalAsk, selectTools as terminalSelectTools } from './prompts.mjs';

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
function validateSettings(settings) {
  if (!object(settings)) throw new Error('settings.json must contain a JSON object; repair it before setup.');
  if (settings.packages !== undefined && (!Array.isArray(settings.packages) || settings.packages.some(entry => {
    if (typeof entry === 'string') return !entry.trim();
    if (!object(entry) || typeof entry.source !== 'string' || !entry.source.trim()) return true;
    return ['extensions', 'skills', 'prompts', 'themes'].some(key => entry[key] !== undefined && (!Array.isArray(entry[key]) || entry[key].some(x => typeof x !== 'string')))
      || (entry.autoload !== undefined && typeof entry.autoload !== 'boolean');
  }))) throw new Error('Invalid settings.json packages; repair the package declarations before setup.');
}
function identity(source) {
  if (!source.startsWith('npm:')) return source;
  const name = source.slice(4);
  const version = name.indexOf('@', name.startsWith('@') ? 1 : 0);
  return 'npm:' + (version < 0 ? name : name.slice(0, version));
}
async function findPi(env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    const name = path.resolve(dir || '.', 'pi');
    try { await fs.access(name, 1); if ((await fs.stat(name)).isFile()) return name; } catch {}
  }
  return null;
}

// Read-only: optional missing or overridden resources are information, not repairs.
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
  validateSettings(settings);
  const manifest = await json(path.join(root, 'manifests/resources.json'));
  const base = await json(path.join(root, 'agent/settings.base.json'));
  if (!object(base) || 'packages' in base) throw new Error('Base preferences must be an object without packages.');
  const sources = await json(path.join(root, 'manifests/packages.json'));
  if (!Array.isArray(sources) || sources.some(x => typeof x !== 'string' || !/^npm:(@[^/\s]+\/)?[^@\s/]+$/.test(x))) throw new Error('Package manifest must list unversioned npm sources.');
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
  const configured = new Set((settings.packages || []).map(x => identity(typeof x === 'string' ? x : x.source)));
  return { root, home, target, settingsPath, settingsExists: !!settingsStat, settings, base, links,
    pi: await findPi(env), packages: sources.map(source => ({ source, configured: configured.has(identity(source)) })) };
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
function nativeInstall(pi, source, target, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(pi, ['install', source], { cwd: target, env: { ...env, PI_CODING_AGENT_DIR: target }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`pi install ${source} failed (${code}).`)));
  });
}

export async function runSetup({ root = checkout, env = process.env, ask, log = console.log, dryRun = false, toolsMode = null, selectTools } = {}) {
  if (process.platform !== 'darwin') throw new Error('This setup currently supports macOS only.');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 26) throw new Error('Node.js >=26.0.0 is required. Use your existing installation owner to select it.');
  const info = await inspectSetup({ root, env });
  if (!info.pi) throw new Error('Pi is required on PATH. Install Pi using its official instructions and your existing Node/version-manager owner, then rerun setup. Setup never installs or upgrades Pi or Node.');
  const choose = async (key, message, fallback) => dryRun ? fallback : ask(key, message, fallback);
  if (!dryRun && typeof ask !== 'function') throw new Error('Interactive setup requires a terminal prompt.');
  log(`Pi: ${info.pi}\nAgent: ${info.target}\nCheckout: ${info.root}`);
  const groups = new Set();
  if (info.settingsExists) log('Existing settings are preserved byte-for-byte by default. Opt into preferences to preview and approve a merge; selected new native packages may also change settings.');
  for (const group of ['instructions', 'extensions', 'skills', 'preferences']) {
    const fallback = group !== 'preferences' || !info.settingsExists;
    if (await choose(`group:${group}`, `Include ${group}?`, fallback)) groups.add(group);
  }
  const packages = [];
  for (const item of info.packages) {
    if (item.configured) log(`Package already configured (preserved): ${item.source}`);
    else if (await choose(`package:${item.source}`, `Install optional ${item.source}? Third-party packages can execute code.`, false)) packages.push(item.source);
    else if (dryRun) log(`Optional, not selected: ${info.pi} install ${item.source}`);
  }
  const tools = toolsMode === null ? null : await planTools({ root: info.root, env, target: info.target, mode: toolsMode, dryRun, selectTools, log });
  const links = info.links.filter(x => groups.has(x.group === 'support' ? 'extensions' : x.group) && x.status !== 'linked');
  const preferences = groups.has('preferences') ? preferenceChanges(info.base, info.settings) : [];
  for (const link of links) log(`${link.status === 'conflict' ? 'CONFLICT' : 'LINK'} ${link.to} -> ${link.from}`);
  for (const change of preferences) log(`${change.conflict ? 'CONFLICT' : 'SET'} settings.${change.keys.join('.')}: ${JSON.stringify(change.old) ?? '(missing)'} -> ${JSON.stringify(change.value)}`);
  for (const source of packages) log(`COMMAND ${info.pi} install ${source} (personal agent: ${info.target})`);
  for (const command of tools?.commands || []) log(`COMMAND ${command.executable} ${command.args.join(' ')}`);
  if (tools?.offers.length) log(`REMEMBER optional-tool offers: ${tools.offers.map(tool => tool.id).join(', ')} (unchecked tools stay untouched).`);
  if (dryRun) { log('Dry run: no prompts, writes, replacements, or installations.'); return { ...info, applied: false }; }
  const approvedLinks = [];
  for (const link of links) if (link.status !== 'conflict' || await choose(`replace:${link.relative}`, `Back up and replace ${link.to}?`, false)) approvedLinks.push(link);
  const approvedPreferences = [];
  for (const change of preferences) if (!change.conflict || await choose(`preference:${change.keys.join('.')}`, `Replace settings.${change.keys.join('.')} with ${JSON.stringify(change.value)}?`, false)) approvedPreferences.push(change);
  if (!approvedLinks.length && !approvedPreferences.length && !packages.length && !tools?.offers.length) { log('No changes selected.'); return { ...info, applied: false }; }
  const backupBase = await resolved(path.join(info.home, '.local/state/pi-setup/backups'));
  if (inside(info.root, backupBase) || inside(info.target, backupBase)) throw new Error('Backup directory must be outside the checkout and agent destination.');
  if (!await choose('apply', 'Apply the approved changes? Existing replacements will be backed up.', false)) { log('Cancelled; nothing changed.'); return { ...info, applied: false }; }
  let backup;
  try {
    if (approvedLinks.some(x => x.status === 'conflict') || (info.settingsExists && (approvedPreferences.length || packages.length))) {
      await fs.mkdir(backupBase, { recursive: true, mode: 0o700 });
      backup = await fs.mkdtemp(path.join(backupBase, 'run-'));
      await fs.chmod(backup, 0o700);
      log(`Backup: ${backup}. Recovery: move backed-up resources to their original relative paths; copy settings.json back after stopping Pi. No automatic rollback.`);
      if (info.settingsExists && (approvedPreferences.length || packages.length)) {
        await fs.copyFile(info.settingsPath, path.join(backup, 'settings.json'));
        await fs.chmod(path.join(backup, 'settings.json'), 0o600);
      }
    }
    for (const link of approvedLinks) {
      if (link.status === 'conflict') {
        const saved = path.join(backup, link.relative);
        await fs.mkdir(path.dirname(saved), { recursive: true, mode: 0o700 });
        await fs.rename(link.to, saved);
      }
      await fs.mkdir(path.dirname(link.to), { recursive: true });
      await fs.symlink(link.from, link.to);
    }
    if (approvedPreferences.length) {
      const settings = structuredClone(info.settings);
      for (const change of approvedPreferences) setPreference(settings, change);
      await fs.mkdir(info.target, { recursive: true });
      await fs.writeFile(info.settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    }
    if (packages.length) await fs.mkdir(info.target, { recursive: true });
    for (const source of packages) await nativeInstall(info.pi, source, info.target, env);
    if (tools) await applyTools(tools, env, log);
  } catch (error) {
    throw new Error(`Setup stopped: ${error.message} Approved earlier changes may remain. ${backup ? `Originals are in ${backup}.` : 'No existing originals were replaced without backup.'} No rollback was attempted.`, { cause: error });
  }
  log('Setup complete. Reload idle Pi sessions yourself when ready.');
  return { ...await inspectSetup({ root, env }), applied: true, backup };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(x => !['--help', '--dry-run', '--new-tools'].includes(x))) throw new Error('Unknown argument. Use --help.');
  if (args.includes('--help')) { console.log('Usage: ./setup.sh [--dry-run] [--new-tools] [--help]\nInteractive macOS setup; requires existing Pi on PATH and Node >=26.0.0.\nDry run previews without prompts or writes. Optional tools/packages default to no.\n--new-tools offers only unseen missing tools; default install revisits declined tools.'); return; }
  const dryRun = args.includes('--dry-run');
  if (!dryRun && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Interactive setup requires a TTY. Run ./setup.sh in a terminal, or use --dry-run.');
  await runSetup({ dryRun, toolsMode: args.includes('--new-tools') ? 'new' : 'all', ask: terminalAsk, selectTools: terminalSelectTools });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
