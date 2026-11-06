import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSetup } from './setup.mjs';

export async function checkSetup(options = {}) {
  const info = await inspectSetup(options);
  return [
    `Pi: ${info.pi || 'not found on PATH (required for setup)'}`,
    `Agent: ${info.target}`,
    ...info.links.map(link => `${link.status}: ${link.to} -> ${link.from}`),
    ...info.preferences.map(change => `${change.conflict ? 'preserved local value' : 'missing default'}: settings.${change.keys.join('.')}`),
    'Conflicts and local setting values are preserved. Nothing was changed.',
  ];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) { console.error('Usage: node scripts/check.mjs'); process.exitCode = 1; }
  else checkSetup().then(lines => console.log(lines.join('\n'))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
