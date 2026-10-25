import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export async function findExecutable(name, env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    const file = path.resolve(dir || '.', name);
    try { await fs.access(file, 1); if ((await fs.stat(file)).isFile()) return file; } catch {}
  }
  return null;
}

export async function inspectTools({ root, env, target }) {
  const statePath = path.join(env.HOME, '.local/state/pi-setup/tools.json');
  let history = { seen: [] };
  try {
    history = JSON.parse(await fs.readFile(statePath, 'utf8'));
    if (!history || !Array.isArray(history.seen) || history.seen.some(id => typeof id !== 'string' || !id.trim())) throw new Error('expected {"seen": [tool IDs]}');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Repair optional-tool history at ${statePath} before setup: ${error.message}`);
  }
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'manifests/tools.json'), 'utf8'));
  const skillsDir = path.join(target, 'skills');
  const gh = await findExecutable('gh', env);
  let extensions = [], skillSupport = false;
  if (gh) {
    // Inspection must not trigger gh's daily network checks/telemetry, and the
    // extension list must retain its non-TTY tab-separated format.
    const inspectEnv = { ...env, GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', GH_TELEMETRY: 'false', GH_FORCE_TTY: '', NO_COLOR: '1' };
    const listing = spawnSync(gh, ['extension', 'list'], { env: inspectEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (listing.error || listing.status !== 0) throw new Error(`Cannot inspect GitHub CLI extensions: ${listing.error?.message || listing.stderr}`);
    extensions = listing.stdout.split('\n').map(line => line.split('\t')[0]);
    const help = spawnSync(gh, ['skill', 'install', '--help'], { env: inspectEnv, stdio: 'ignore' });
    skillSupport = !help.error && help.status === 0;
  }
  const canInstallGh = !gh && catalog.some(tool => tool.id === 'gh') && !!await findExecutable('brew', env);
  const tools = await Promise.all(catalog.map(async tool => {
    let installed;
    if (tool.skill) {
      const destination = path.join(skillsDir, tool.skill);
      try { await fs.lstat(destination); installed = destination; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else if (tool.extension) installed = extensions.includes(`gh ${tool.extension}`) ? `gh ${tool.extension}` : null;
    else installed = await findExecutable(tool.executable, env);
    const prerequisite = await findExecutable(tool.prerequisite, env);
    const requires = tool.prerequisite === 'gh' && !gh && canInstallGh ? ['gh'] : [];
    const available = !installed && (!!prerequisite || requires.length > 0) && (!tool.skill || !gh || skillSupport);
    const reason = installed ? `installed or occupied: ${installed}; preserved, no upgrades or browser downloads`
      : tool.skill && gh && !skillSupport ? `Installed gh has no gh skill support. ${tool.instructions}`
      : !prerequisite && !requires.length ? `Missing ${tool.prerequisite}. ${tool.instructions}` : null;
    const commands = tool.commands.map(command => ({ ...command, args: command.args.map(arg => arg === '{skillsDir}' ? skillsDir : arg) }));
    return { ...tool, commands, installed, available, requires, seen: history.seen.includes(tool.id), selected: false, reason };
  }));
  return { statePath, history, tools };
}

export async function planTools({ root, env, target, mode, dryRun, selectTools, log }) {
  if (!['all', 'new'].includes(mode)) throw new Error('toolsMode must be all, new, or null.');
  const info = await inspectTools({ root, env, target });
  const offers = info.tools.filter(tool => !tool.installed && (mode === 'all' || !tool.seen));
  for (const tool of offers) {
    if (tool.requires.some(id => !offers.some(offer => offer.id === id))) {
      tool.available = false;
      tool.reason = 'GitHub CLI was previously declined. Use pi-setup install to revisit it, or install it yourself.';
    }
  }
  for (const tool of info.tools.filter(tool => tool.installed)) log(`Optional tool ${tool.name}: ${tool.reason}`);
  for (const tool of offers) {
    log(`Optional tool [ ] ${tool.name}${tool.reason ? ` — unavailable: ${tool.reason}` : ''}`);
    if (dryRun && tool.available) for (const command of tool.commands) log(`OPTIONAL COMMAND ${command.executable} ${command.args.join(' ')}`);
  }
  if (dryRun || !offers.length) return { ...info, offers: [], commands: [] };
  if (typeof selectTools !== 'function') throw new Error('Optional-tool selection requires a terminal checklist.');
  const selected = await selectTools(offers);
  if (selected === null) throw new Error('Cancelled; nothing changed.');
  if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string' || !offers.some(tool => tool.id === id && tool.available)) || new Set(selected).size !== selected.length) throw new Error('Invalid optional-tool selection; choose only available offered IDs.');
  for (const tool of offers.filter(tool => selected.includes(tool.id))) {
    if (tool.requires.some(id => !selected.includes(id))) throw new Error(`${tool.name} requires selecting GitHub CLI (gh) too; nothing changed.`);
  }
  const commands = [];
  for (const tool of offers.filter(tool => selected.includes(tool.id))) {
    for (const command of tool.commands) commands.push({ ...command, tool: tool.id });
  }
  return { ...info, offers, commands };
}

export async function applyTools(plan, env, log) {
  for (const command of plan.commands) {
    const executable = await findExecutable(command.executable, env);
    if (!executable) throw new Error(`${command.executable} is not on PATH after the approved installation. Follow the owner's PATH instructions and retry.`);
    await new Promise((resolve, reject) => {
      const child = spawn(executable, command.args, { env, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command.executable} ${command.args.join(' ')} failed (${code}).`)));
    });
  }
  if (plan.offers.length) {
    await fs.mkdir(path.dirname(plan.statePath), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(plan.statePath), 0o700);
    await fs.writeFile(plan.statePath, JSON.stringify({ seen: [...new Set([...plan.history.seen, ...plan.offers.map(tool => tool.id)])] }, null, 2) + '\n', { mode: 0o600 });
    await fs.chmod(plan.statePath, 0o600);
    log(`Optional-tool choices remembered in ${plan.statePath}. Unchecked tools were not removed.`);
  }
}
