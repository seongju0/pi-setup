import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSetup } from './setup.mjs';
import { inspectTools } from './tools.mjs';

export async function checkSetup(options = {}) {
  const info = await inspectSetup(options);
  const tools = await inspectTools({ root: info.root, env: options.env || process.env, target: info.target });
  return [
    `Pi: ${info.pi || 'not found on PATH (required for setup)'}`,
    `Agent: ${info.target}`,
    ...info.links.map(link => `${link.status}: ${link.to} -> ${link.from}`),
    ...info.packages.map(item => `optional package ${item.configured ? 'configured' : 'not configured'}: ${item.source}`),
    ...tools.tools.map(tool => `optional tool ${tool.installed ? 'installed' : tool.available ? 'missing' : 'unavailable'}: ${tool.name}${tool.reason ? ` — ${tool.reason}` : ''}; ${tool.seen ? 'previously offered' : 'unseen'}`),
    `Optional-tool choice history: ${tools.statePath} (read-only)`,
    'Missing or locally overridden optional resources are informational. Nothing was changed.',
  ];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) { console.error('Usage: node scripts/check.mjs'); process.exitCode = 1; }
  else checkSetup().then(lines => console.log(lines.join('\n'))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
