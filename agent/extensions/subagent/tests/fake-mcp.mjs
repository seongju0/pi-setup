// Local MCP fixture: tools and resources, with a connection log to detect unwanted servers.
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const [name, logPath] = process.argv.slice(2);
appendFileSync(logPath, `${name}\n`);
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case 'initialize': result = { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name, version: '1' } }; break;
    case 'tools/list': result = { tools: [{ name: 'lookup', description: 'Read a synthetic value', inputSchema: { type: 'object', properties: {} } }] }; break;
    case 'tools/call': result = { content: [{ type: 'text', text: `${name}: synthetic answer` }] }; break;
    case 'resources/list': result = { resources: [{ uri: `test://${name}/report`, name: `${name} report`, mimeType: 'text/plain' }] }; break;
    case 'resources/templates/list': result = { resourceTemplates: [] }; break;
    case 'resources/read': result = { contents: [{ uri: request.params.uri, text: `${name}: synthetic resource` }] }; break;
    case 'ping': result = {}; break;
    default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported method' } }) + '\n'); return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
