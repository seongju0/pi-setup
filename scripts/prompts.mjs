import { emitKeypressEvents } from 'node:readline';

// Each prompt owns stdin only while active; no readline question interface can
// consume checklist keys. Always restore the terminal, including cancellation.
function keys(render, handle) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY) throw new Error('Interactive setup requires a TTY.');
  return new Promise((resolve, reject) => {
    const wasRaw = !!input.isRaw;
    const done = (error, value) => {
      input.removeListener('keypress', onKey);
      input.removeListener('error', onError);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onError = error => done(error);
    const onKey = (text, key = {}) => {
      try {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return done(new Error('Cancelled; nothing changed.'));
        const result = handle(text, key);
        if (result !== undefined) done(null, result);
        else render();
      } catch (error) { done(error); }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKey);
    input.on('error', onError);
    try { render(); } catch (error) { done(error); }
  });
}

export function ask(_key, message, fallback) {
  let reply = '';
  return keys(() => process.stdout.write(`\r\x1b[2K${message} ${fallback ? '[Y/n]' : '[y/N]'} ${reply}`), (text, key) => {
    if (key.name === 'return') return reply ? ['y', 'yes'].includes(reply.toLowerCase()) : fallback;
    if (key.name === 'backspace') reply = reply.slice(0, -1);
    else if (text && !key.ctrl && !key.meta && /^[a-z]+$/i.test(text)) reply += text;
  });
}

export function selectTools(tools) {
  let cursor = 0;
  let drawn = false;
  const selected = new Set();
  return keys(() => {
    if (drawn) process.stdout.write(`\x1b[${tools.length + 1}A`);
    process.stdout.write('\r\x1b[2KOptional tools: ↑/↓ move, Space toggle, Enter finish; Esc/Ctrl-C cancel\n');
    for (const [index, tool] of tools.entries()) {
      const needsGh = tool.requires?.some(id => !selected.has(id));
      process.stdout.write(`\r\x1b[2K${index === cursor ? '>' : ' '} [${selected.has(tool.id) ? 'x' : ' '}] ${tool.name}${!tool.available ? ` — unavailable: ${tool.reason}` : needsGh ? ' — select GitHub CLI (gh) first' : ''}\n`);
    }
    drawn = true;
  }, (_text, key) => {
    if (key.name === 'return') return [...selected];
    if (key.name === 'up') cursor = (cursor + tools.length - 1) % tools.length;
    if (key.name === 'down') cursor = (cursor + 1) % tools.length;
    if (key.name === 'space' && tools[cursor].available) {
      const tool = tools[cursor];
      if (selected.has(tool.id)) {
        selected.delete(tool.id);
        for (const dependent of tools) if (dependent.requires?.includes(tool.id)) selected.delete(dependent.id);
      } else if (!tool.requires?.some(id => !selected.has(id))) selected.add(tool.id);
    }
  });
}
