#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const usage = 'Usage: pi-setup install | update | check | help\ninstall: install or revisit choices (no pull)\nupdate: fast-forward the managed checkout, then review new tools\ncheck: read-only inspection of the managed installation';
const stat = async name => { try { return await fs.lstat(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
export function locations(env = process.env) {
  if (!env.HOME) throw new Error('HOME must be set.');
  const home = path.resolve(env.HOME);
  const managed = path.resolve(env.PI_SETUP_HOME || path.join(home, '.local/share/pi-setup'));
  return { home, managed, root: path.join(managed, 'checkout'), command: path.join(home, '.local/bin/pi-setup') };
}
function execute(file, args, { env, cwd }) {
  const result = spawnSync(file, args, { env, cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} stopped (${result.status ?? result.signal}).`);
}
async function checkoutExists(root, env) {
  const current = await stat(root);
  if (!current) return false;
  if (current.isSymbolicLink()) throw new Error('Managed checkout must be a separate Git checkout, not a symlink to another source tree.');
  const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (await fs.realpath(top) !== await fs.realpath(root)) throw new Error('Managed checkout must be its own Git checkout; existing paths are never replaced.');
  return true;
}

// Prompts and terminal subprocesses are external boundaries; all checkout and
// launcher decisions stay here, including when called by integration tests.
export async function runClient(command, { env = process.env, ask, run = execute, log = console.log } = {}) {
  const info = locations(env);
  if (!['install', 'update', 'check'].includes(command)) throw new Error(usage);
  const present = await checkoutExists(info.root, env);
  if (!present) {
    if (command !== 'install') throw new Error(`No managed checkout at ${info.root}. Run pi-setup install first.`);
    const repository = env.PI_SETUP_REPOSITORY || 'https://github.com/seongju0/pi-setup.git';
    log(`Persistent checkout: ${info.root}\nRepository: ${repository}`);
    if (!await ask(`Obtain this checkout? Repository code will run.`, false)) { log('Cancelled; nothing changed.'); return; }
    await fs.mkdir(info.managed, { recursive: true });
    await run('git', ['clone', '--', repository, info.root], { env });
  }
  if (command === 'check') {
    await run(process.execPath, [path.join(info.root, 'scripts/check.mjs')], { env, cwd: info.root });
    return;
  }
  if (command === 'update') {
    const { updateCheckout } = await import(pathToFileURL(path.join(info.root, 'scripts/update.mjs')).href);
    updateCheckout({ root: info.root, env, log });
  }
  const launcher = path.join(info.root, 'scripts/client.mjs');
  const current = await stat(info.command);
  const correct = current?.isSymbolicLink() && path.resolve(path.dirname(info.command), await fs.readlink(info.command)) === launcher;
  if (!correct) {
    if (current?.isDirectory()) throw new Error(`Command path is a directory; move it yourself: ${info.command}`);
    if (current) {
      if (!await ask(`Back up and replace command ${info.command}?`, false)) {
        log(`Command preserved. Run: ${process.execPath} ${launcher} install`);
      } else {
        const base = path.join(info.home, '.local/state/pi-setup/backups');
        await fs.mkdir(base, { recursive: true, mode: 0o700 });
        const backup = await fs.mkdtemp(path.join(base, 'command-'));
        await fs.chmod(backup, 0o700);
        // Backups must not become tracked source or consumer resources.
        const resolved = await fs.realpath(backup);
        for (const root of [info.root, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')]) {
          const actual = await fs.realpath(root);
          if (resolved === actual || resolved.startsWith(actual + path.sep)) throw new Error('Command backup must be outside the repository.');
        }
        await fs.rename(info.command, path.join(backup, 'pi-setup'));
        log(`Original command saved: ${backup}/pi-setup`);
        await fs.symlink(launcher, info.command);
      }
    } else {
      await fs.mkdir(path.dirname(info.command), { recursive: true });
      await fs.symlink(launcher, info.command);
    }
  }
  log(`Command: ${info.command}`);
  if (!(env.PATH || '').split(path.delimiter).includes(path.dirname(info.command))) log(`Add ${path.dirname(info.command)} to PATH yourself, or use the full command above. No shell files were changed.`);
  await run(process.execPath, [path.join(info.root, 'scripts/setup.mjs'), ...(command === 'update' ? ['--new-tools'] : [])], { env, cwd: info.root });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) { console.log(usage); return; }
  if (args.length !== 1 || !['install', 'update', 'check'].includes(args[0])) throw new Error(usage);
  if (args[0] !== 'check') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('pi-setup requires a TTY before making changes. Run it in a terminal.');
    if (process.platform !== 'darwin') throw new Error('pi-setup currently supports macOS only.');
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 26) throw new Error('Node.js >=26.0.0 is required.');
    for (const tool of ['git', 'pi']) execFileSync('/bin/sh', ['-c', 'command -v "$1" >/dev/null', 'sh', tool], { env: process.env });
  }
  // Open only while prompting: setup receives the terminal without a competing reader.
  await runClient(args[0], { ask: async (message, fallback) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { const answer = (await terminal.question(`${message} [y/N] `)).trim().toLowerCase(); return answer ? ['y', 'yes'].includes(answer) : fallback; }
    finally { terminal.close(); }
  } });
}
if (process.argv[1] && await fs.realpath(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
