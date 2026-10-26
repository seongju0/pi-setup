import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = async name => { try { await fs.lstat(name); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
// A real controlling terminal, including when the bootstrap's script arrives on
// a pipe. Reply only after each prompt, so separate readline owners do not race.
const terminalDriver = `import os,pty,select,sys,time,json
command=json.loads(sys.argv[1]); answers=json.loads(sys.argv[2]); pid,fd=pty.fork()
if pid==0: os.execvpe(command[0],command,os.environ)
output=b''; pending=b''; deadline=time.monotonic()+30
structured=any(isinstance(answer,dict) for answer in answers)
while True:
 if time.monotonic()>deadline:
  os.kill(pid,9); raise RuntimeError('terminal timeout: '+output.decode(errors='replace'))
 ready,_,_=select.select([fd],[],[],0.1)
 if ready:
  try: data=os.read(fd,65536)
  except OSError: break
  if not data: break
  output+=data; pending+=data
  while answers:
   answer=answers[0]
   marker=answer['prompt'].encode() if isinstance(answer,dict) else b'[y/N] '
   if marker not in pending: break
   pending=pending.split(marker,1)[1]; answers.pop(0)
   reply=answer['input'] if isinstance(answer,dict) else answer+'\\n'
   os.write(fd,reply.encode())
  if not structured and not answers and b'[y/N] ' in pending:
   os.kill(pid,9); raise RuntimeError('unexpected prompt: '+output.decode(errors='replace'))
_,status=os.waitpid(pid,0)
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
`;
function terminal(command, answers, env) {
  const result = spawnSync('python3', ['-c', terminalDriver, JSON.stringify(command), JSON.stringify(answers)], { env, encoding: 'utf8', timeout: 40000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-consumer-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const publisher = path.join(temp, 'publisher');
  const upstream = path.join(temp, 'upstream.git');
  const bin = path.join(temp, 'bin');
  const target = path.join(home, 'custom-agent');
  await fs.mkdir(path.join(publisher, 'scripts'), { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'pi'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const name of ['client.mjs', 'update.mjs']) await fs.copyFile(path.join(source, 'scripts', name), path.join(publisher, 'scripts', name));
  await fs.chmod(path.join(publisher, 'scripts/client.mjs'), 0o755);
  // External revision handoff boundary: the tiny upstream installer makes its
  // revision, flags and checkout visible without mocking consumer decisions.
  const setup = revision => `import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.env.PI_CODING_AGENT_DIR;
const link=path.join(target,'resource');
try { await fs.lstat(link); } catch(e) { if(e.code!=='ENOENT') throw e; await fs.symlink(path.join(root,'resource'),link); }
await fs.appendFile(process.env.HANDOFF,JSON.stringify({revision:${JSON.stringify(revision)},args:process.argv.slice(2),root})+'\\n');
`;
  await fs.writeFile(path.join(publisher, 'scripts/setup.mjs'), setup('first'));
  await fs.writeFile(path.join(publisher, 'scripts/check.mjs'), 'console.log("read-only fixture check");\n');
  await fs.writeFile(path.join(publisher, 'resource'), 'first');
  await fs.writeFile(path.join(target, 'settings.json'), '{"local":true}\n');
  await fs.writeFile(path.join(target, 'local-sentinel'), 'keep');
  const env = { ...process.env, HOME: home, PI_SETUP_HOME: path.join(home, 'managed'), PI_SETUP_REPOSITORY: upstream,
    PI_CODING_AGENT_DIR: target, PATH: bin + path.delimiter + process.env.PATH, HANDOFF: path.join(temp, 'handoff'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(temp, 'init', '--bare', upstream);
  git(publisher, 'init');
  git(publisher, 'add', '.');
  git(publisher, 'commit', '-m', 'First fixture revision');
  git(publisher, 'remote', 'add', 'origin', upstream);
  git(publisher, 'push', '-u', 'origin', 'HEAD');
  return { temp, home, publisher, upstream, target, env, git, setup, root: path.join(env.PI_SETUP_HOME, 'checkout'),
    command: path.join(home, '.local/bin/pi-setup'), backups: path.join(home, '.local/state/pi-setup/backups') };
}
const mac = { skip: process.platform !== 'darwin' ? 'Consumer installation supports macOS only' : false };

test('bootstrap and managed launcher isolate source, preserve local state, and hand updated setup to a fresh process', mac, async t => {
  const f = await fixture(t);
  // Read source into a pipe exactly as curl | sh would, without network access.
  terminal(['/bin/sh', '-c', '"$1" -e \'process.stdout.write(require("fs").readFileSync(process.argv[1]))\' "$2" | /bin/sh', 'sh', process.execPath, path.join(source, 'install.sh')], ['yes'], f.env);
  assert.equal(await fs.readlink(f.command), path.join(f.root, 'scripts/client.mjs'));
  const launcher = await fs.lstat(f.command);
  assert.equal(await fs.readlink(path.join(f.target, 'resource')), path.join(f.root, 'resource'));
  await fs.writeFile(path.join(f.publisher, 'resource'), 'second');
  await fs.writeFile(path.join(f.publisher, 'scripts/setup.mjs'), f.setup('second'));
  assert.equal(await fs.readFile(path.join(f.target, 'resource'), 'utf8'), 'first');
  terminal([f.command, 'install'], [], f.env);
  assert.equal(await fs.readFile(path.join(f.target, 'resource'), 'utf8'), 'first');
  f.git(f.publisher, 'add', '.');
  f.git(f.publisher, 'commit', '-m', 'New upstream installer and resource');
  f.git(f.publisher, 'push');
  // Bootstrap existing checkout declines update by default and revisits install.
  terminal(['/bin/sh', path.join(source, 'install.sh')], [''], f.env);
  assert.equal(await fs.readFile(path.join(f.target, 'resource'), 'utf8'), 'first');
  terminal([f.command, 'update'], [], f.env);
  assert.equal(await fs.readFile(path.join(f.target, 'resource'), 'utf8'), 'second');
  const handoffs = (await fs.readFile(f.env.HANDOFF, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(handoffs.map(x => [x.revision, x.args]), [['first', []], ['first', []], ['first', []], ['second', ['--new-tools']]]);
  assert.ok(handoffs.every(x => x.root === f.root));
  assert.equal((await fs.lstat(f.command)).ino, launcher.ino);
  assert.equal(await fs.readFile(path.join(f.target, 'settings.json'), 'utf8'), '{"local":true}\n');
  assert.equal(await fs.readFile(path.join(f.target, 'local-sentinel'), 'utf8'), 'keep');
  assert.equal(await exists(f.backups), false);
  assert.equal(f.git(f.root, 'status', '--porcelain'), '');

  // Publish the actual installer into the same local upstream and consume it.
  // This exercises the real raw-key checklist after the client yields stdin,
  // not just the earlier revision-handoff fixture or a selection callback.
  for (const directory of ['scripts', 'agent', 'manifests']) await fs.cp(path.join(source, directory), path.join(f.publisher, directory), { recursive: true });
  f.git(f.publisher, 'add', '.');
  f.git(f.publisher, 'commit', '-m', 'Actual foundation installer');
  f.git(f.publisher, 'push');
  const bin = path.join(f.temp, 'bin');
  await fs.symlink(process.execPath, path.join(bin, 'node'));
  const calls = path.join(f.temp, 'unexpected-installs');
  for (const tool of ['brew', 'npm']) await fs.writeFile(path.join(bin, tool), `#!/bin/sh\nprintf '%s\\n' unexpected >> '${calls}'\nexit 1\n`, { mode: 0o755 });
  const rawEnv = { ...f.env, PATH: [bin, '/usr/bin', '/bin', '/usr/sbin'].join(path.delimiter) };
  const prompt = (message, input = '\r') => ({ prompt: message, input });
  const output = terminal([f.command, 'update'], [
    prompt('Manage global Pi guidance (AGENTS.md)? [Y/n]'), prompt('Include extensions? [Y/n]'),
    prompt('Include skills? [Y/n]'), prompt('Review suggested Pi settings from this repository? [y/N]'),
    ...['npm:pi-updater', 'npm:@ff-labs/pi-fff', 'npm:glimpseui', 'npm:pi-zentui'].map(name => prompt(`Install optional ${name}? Third-party packages can execute code. [y/N]`)),
    prompt('Optional tools: ↑/↓ move, Space toggle, Enter finish; Esc/Ctrl-C cancel', ' \x1b[B \x1b[A \x1b[B \x1b[A  \r'),
    prompt('Apply the approved changes? Existing replacements will be backed up. [y/N]', 'yes\r'),
  ], rawEnv);
  assert.match(output, /\[x\] GitHub CLI/);
  assert.match(output, /\[x\] gh-stack extension/);
  assert.equal(await exists(calls), false);
  assert.equal(await fs.readlink(path.join(f.target, 'skills/build')), path.join(f.root, 'agent/skills/build'));
  const historyPath = path.join(f.home, '.local/state/pi-setup/tools.json');
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
  assert.deepEqual(history.seen, JSON.parse(await fs.readFile(path.join(source, 'manifests/tools.json'), 'utf8')).map(tool => tool.id));
  assert.equal(await fs.readFile(path.join(f.target, 'settings.json'), 'utf8'), '{"local":true}\n');
  assert.equal(await fs.readFile(path.join(f.target, 'local-sentinel'), 'utf8'), 'keep');
  assert.equal(await exists(f.backups), false);
  assert.equal(f.git(f.root, 'status', '--porcelain'), '');
});

test('no-terminal entry points make no changes; command conflict defaults to preserve and approval makes private backup', mac, async t => {
  const f = await fixture(t);
  const detached = command => spawnSync('python3', ['-c', 'import subprocess,sys,json\np=subprocess.run(json.loads(sys.argv[1]),start_new_session=True,capture_output=True)\nsys.stdout.buffer.write(p.stdout);sys.stderr.buffer.write(p.stderr);sys.exit(p.returncode)', JSON.stringify(command)], { env: f.env, encoding: 'utf8' });
  assert.notEqual(detached(['/bin/sh', path.join(source, 'install.sh')]).status, 0);
  assert.notEqual(detached([process.execPath, path.join(source, 'scripts/client.mjs'), 'install']).status, 0);
  assert.equal(await exists(f.env.PI_SETUP_HOME), false);
  assert.equal(await exists(path.dirname(f.command)), false);
  assert.notEqual(detached([process.execPath, path.join(source, 'scripts/client.mjs'), 'check']).status, 0);
  assert.equal(await exists(f.env.PI_SETUP_HOME), false);
  terminal([process.execPath, path.join(source, 'scripts/client.mjs'), 'install'], [''], f.env);
  assert.equal(await exists(f.env.PI_SETUP_HOME), false);
  await fs.mkdir(path.dirname(f.command), { recursive: true });
  await fs.writeFile(f.command, 'original command');
  terminal([process.execPath, path.join(source, 'scripts/client.mjs'), 'install'], ['yes', ''], f.env);
  assert.equal(await fs.readFile(f.command, 'utf8'), 'original command');
  assert.equal(await exists(f.backups), false);
  terminal([process.execPath, path.join(source, 'scripts/client.mjs'), 'install'], ['yes'], f.env);
  assert.equal(await fs.readlink(f.command), path.join(f.root, 'scripts/client.mjs'));
  const backups = await fs.readdir(f.backups);
  assert.equal(backups.length, 1);
  const backup = path.join(f.backups, backups[0]);
  assert.equal(await fs.readFile(path.join(backup, 'pi-setup'), 'utf8'), 'original command');
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o700);
  const launcher = await fs.lstat(f.command);
  terminal([f.command, 'install'], [], f.env);
  assert.equal((await fs.lstat(f.command)).ino, launcher.ino);
  assert.deepEqual(await fs.readdir(f.backups), backups);
  // A check neither repairs a missing launcher nor adds new backup state.
  await fs.unlink(f.command);
  assert.equal(detached([process.execPath, path.join(source, 'scripts/client.mjs'), 'check']).status, 0);
  assert.equal(await exists(f.command), false);
});
