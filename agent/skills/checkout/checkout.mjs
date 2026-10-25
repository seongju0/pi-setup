import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const help = `Usage: checkout <repository> [--path-only] [--force-update] [--update-interval <seconds>]
Cache a repository for source inspection using Node.js and Git.
Configuration: CHECKOUT_CACHE_ROOT, CHECKOUT_DEFAULT_HOST, CHECKOUT_UPDATE_INTERVAL.
`;
const invalidCharacters = /[\s\x00-\x1f\x7f\\%]/;

function hostName(value) {
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/i.test(value)) {
    throw new Error(`Invalid host: ${value}`);
  }
  return value.toLowerCase();
}

function parseOptions(argv, env) {
  let reference, interval;
  let pathOnly = false, force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--path-only') pathOnly = true;
    else if (arg === '--force-update') force = true;
    else if (arg === '--update-interval') {
      if (interval !== undefined || argv[i + 1] === undefined) throw new Error('Provide --update-interval once, with seconds.');
      interval = argv[++i];
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (reference !== undefined) throw new Error('Expected exactly one repository.');
    else reference = arg;
  }
  if (!reference) throw new Error('Provide a repository; use --help for usage.');
  interval ??= env.CHECKOUT_UPDATE_INTERVAL ?? '300';
  if (!/^\d+$/.test(interval) || !Number.isSafeInteger(Number(interval))) throw new Error('Update interval must be a non-negative safe integer in seconds.');
  const defaultHost = hostName(env.CHECKOUT_DEFAULT_HOST ?? 'github.com');
  let root = env.CHECKOUT_CACHE_ROOT;
  if (root === undefined || root.startsWith('~/')) {
    if (!env.HOME) throw new Error('HOME is required for the cache root.');
    root = root === undefined ? path.join(env.HOME, '.cache/checkouts') : path.join(env.HOME, root.slice(2));
  }
  if (!root || /[\x00-\x1f\x7f]/.test(root)) throw new Error('Cache root must be nonempty and contain no control characters.');
  return { reference, pathOnly, force, interval: Number(interval), cacheRoot: path.resolve(root), defaultHost };
}

function normalizeReference(reference, defaultHost) {
  const input = reference.split(/[?#]/, 1)[0];
  if (invalidCharacters.test(input)) throw new Error('Repository reference contains unsupported characters.');
  let host = defaultHost, repository = input;
  const url = input.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]+)\/(.*)$/i);
  const scp = input.match(/^([a-z0-9._-]+)@([^/:]+):(.*)$/i);
  if (url) {
    const [, scheme, authority, rest] = url;
    if (!['http', 'https', 'ssh'].includes(scheme.toLowerCase())) throw new Error('Use an HTTP(S) or SSH repository reference.');
    let server = authority;
    if (scheme.toLowerCase() === 'ssh') {
      const ssh = authority.match(/^(?:[a-z0-9._-]+@)?([^@]+)$/i);
      if (!ssh) throw new Error('Invalid SSH authority.');
      server = ssh[1];
    }
    host = hostName(server);
    repository = rest.endsWith('/') ? rest.slice(0, -1) : rest;
  } else if (scp) {
    host = hostName(scp[2]);
    repository = scp[3];
  } else {
    if (input.includes(':') || input.includes('@')) throw new Error('Unsupported repository reference.');
    const parts = input.split('/');
    if (parts[0].includes('.') && !['.', '..'].includes(parts[0])) {
      host = hostName(parts.shift());
      repository = parts.join('/');
    }
  }
  let segments = repository.split('/');
  if (segments.length < 2 || segments.some(segment => !/^[a-z0-9_.-]+$/i.test(segment) || segment === '.' || segment === '..')) {
    throw new Error('Use namespace/repository without empty or dot path components.');
  }
  if (host === 'github.com' && segments.length > 2) {
    if (!['tree', 'blob', 'pull', 'issues', 'commit', 'actions', 'releases', 'compare', 'wiki'].includes(segments[2])) throw new Error('Unsupported GitHub repository suffix.');
    segments = segments.slice(0, 2);
  } else if (host !== 'github.com' && repository.includes('/-/')) {
    throw new Error('Use the repository URL, not a /-/ resource URL.');
  }
  segments[segments.length - 1] = segments.at(-1).replace(/\.git$/, '');
  if (!segments.at(-1) || ['.', '..'].includes(segments.at(-1))) throw new Error('Repository name is empty or a dot component.');
  return { host, segments, remoteUrl: `https://${host}/${segments.join('/')}.git` };
}

const gitEnv = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) delete gitEnv[key];
function runGit(cwd, args, { allowFailure = false, display = false } = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
  if (result.stderr) process.stderr.write(result.stderr);
  if (display && result.stdout) process.stderr.write(result.stdout);
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Git ${args[0]} terminated by ${result.signal}.`);
  if (result.status !== 0 && !allowFailure) throw new Error(`Git ${args[0]} failed in ${cwd}.`);
  return { status: result.status, stdout: result.stdout.trim() };
}

function nearestRealPath(location) {
  try { return fs.realpathSync(location); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A dangling symlink is occupied, not an absent directory to create through.
    try { fs.lstatSync(location); } catch (statError) { if (statError.code !== 'ENOENT') throw statError; return path.join(nearestRealPath(path.dirname(location)), path.basename(location)); }
    throw new Error(`Broken symlink at ${location}; remediate it explicitly.`);
  }
}

function markerPath(destination) {
  return runGit(destination, ['rev-parse', '--path-format=absolute', '--git-path', 'pi-checkout-last-fetch']).stdout;
}
function stamp(marker) { fs.writeFileSync(marker, `${Math.floor(Date.now() / 1000)}\n`); }
function isFresh(marker, interval) {
  let value;
  try { value = fs.readFileSync(marker, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!/^\d+\n?$/.test(value) || !Number.isSafeInteger(Number(value))) return false;
  const age = Math.floor(Date.now() / 1000) - Number(value);
  return age >= 0 && age < interval;
}
function warn(message) { process.stderr.write(`Warning: ${message}\n`); }

function resolveCheckout(options, normalized) {
  const root = nearestRealPath(options.cacheRoot);
  const destination = path.join(root, normalized.host, ...normalized.segments);
  const resolved = nearestRealPath(destination);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Cache destination escapes root: ${destination}`);
  let exists = true;
  try { fs.lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  if (!exists) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    runGit(root, ['clone', '--filter=blob:none', '--no-recurse-submodules', '--', normalized.remoteUrl, destination], { display: true });
    stamp(markerPath(destination));
    return { path: destination, created: true, fetched: true, ffOutcome: 'not-needed' };
  }
  const inspection = runGit(destination, ['rev-parse', '--is-bare-repository', '--show-toplevel']);
  const [bare, top] = inspection.stdout.split('\n');
  if (bare !== 'false' || !top || fs.realpathSync(top) !== fs.realpathSync(destination)) throw new Error(`Occupied cache path is not its own non-bare working tree: ${destination}`);
  runGit(destination, ['remote', 'set-url', 'origin', normalized.remoteUrl]);
  const marker = markerPath(destination);
  if (!options.force && isFresh(marker, options.interval)) return { path: destination, created: false, fetched: false, ffOutcome: 'not-attempted' };
  runGit(destination, ['fetch', '--prune', '--tags', '--recurse-submodules=no', 'origin'], { display: true });
  stamp(marker);
  let ffOutcome = 'skipped';
  if (runGit(destination, ['status', '--porcelain=v1', '--untracked-files=no']).stdout) warn('Tracked changes present; fast-forward skipped.');
  else {
    const branch = runGit(destination, ['symbolic-ref', '--quiet', 'HEAD'], { allowFailure: true });
    if (branch.status === 1) warn('Detached HEAD; fast-forward skipped.');
    else if (branch.status !== 0) throw new Error('Unable to inspect current branch.');
    else {
      const configured = runGit(destination, ['for-each-ref', '--format=%(upstream)', branch.stdout]).stdout;
      const upstream = configured ? runGit(destination, ['rev-parse', '--verify', '--quiet', configured], { allowFailure: true }) : { status: 1 };
      if (upstream.status === 1) warn('No resolvable upstream; fast-forward skipped.');
      else if (upstream.status !== 0) throw new Error('Unable to inspect branch upstream.');
      else {
        const merge = runGit(destination, ['merge', '--ff-only', '--no-autostash', '--no-edit', '--no-overwrite-ignore', '@{upstream}'], { allowFailure: true, display: true });
        ffOutcome = merge.status === 0 ? 'applied' : 'not-applied';
        if (merge.status !== 0) warn('Fetch succeeded, but fast-forward was not applied; local work was retained.');
      }
    }
  }
  return { path: destination, created: false, fetched: true, ffOutcome };
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--help') process.stdout.write(help);
  else {
    const options = parseOptions(process.argv.slice(2), process.env);
    const normalized = normalizeReference(options.reference, options.defaultHost);
    const result = resolveCheckout(options, normalized);
    process.stdout.write(options.pathOnly ? `${result.path}\n` : `${normalized.remoteUrl}\n${result.path}\n${result.created ? 'cloned' : 'reused'}; fetch ${result.fetched ? 'fresh' : 'throttled'}; fast-forward ${result.ffOutcome}\n`);
  }
} catch (error) {
  process.stderr.write(`Checkout failed: ${error.message}\n`);
  process.exitCode = 1;
}
