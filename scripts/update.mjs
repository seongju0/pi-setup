import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Git owns checkout updates. Never stash, reset, rebase or discard local changes.
export function updateCheckout({ root = checkout, env = process.env, log = console.log } = {}) {
  root = fs.realpathSync(root);
  const git = args => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let top;
  try { top = git(['rev-parse', '--show-toplevel']); }
  catch { throw new Error('Update requires Git on PATH and a persistent Git checkout. Clone the repository first.'); }
  if (fs.realpathSync(top) !== root) throw new Error('Update must run from the pi-setup repository root, not a containing repository.');
  if (git(['status', '--porcelain'])) throw new Error('Checkout has local changes or untracked files. Commit or move them yourself before updating; nothing was stashed or reset.');
  let upstream;
  try { upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); }
  catch { throw new Error('No tracking upstream is configured. Set the intended remote/branch before updating; setup will not choose one for you.'); }
  log(`Updating ${root} from ${upstream} (fast-forward only).`);
  const result = spawnSync('git', ['-C', root, 'pull', '--ff-only', '--no-rebase'], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Git update stopped. Resolve the reported remote or history issue yourself; no stash, reset or rebase was attempted.');
  return { root, upstream };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: ./update.sh\nPull the tracking upstream with a clean checkout and fast-forward only, then run interactive setup.\nExisting settings and local additions remain unchanged unless explicitly selected for replacement.\nExternal Pi packages are not automatically upgraded.');
    return;
  }
  if (args.length) throw new Error('Unknown argument. Use ./update.sh --help.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Update requires a TTY for the subsequent setup review. Run ./update.sh in a terminal.');
  const { root } = updateCheckout();
  // Start fresh: the pulled revision may have changed the installer itself.
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup.mjs'), '--new-tools'], { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
