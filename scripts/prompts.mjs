import { emitKeypressEvents } from 'node:readline';

// Restore the terminal after confirmation, including cancellation.
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
  let drawn = false;
  return keys(() => {
    if (!drawn) {
      process.stdout.write(`${message} ${fallback ? '[Y/n]' : '[y/N]'}\n`);
      drawn = true;
    }
    // Only redraw the ASCII answer, leaving a column free to avoid terminal wrapping.
    const width = Math.max(1, (process.stdout.columns || 80) - 1);
    const answer = `> ${reply}`;
    process.stdout.write(`\r\x1b[2K${answer.slice(-width)}`);
  }, (text, key) => {
    if (key.name === 'return') return reply ? ['y', 'yes'].includes(reply.toLowerCase()) : fallback;
    if (key.name === 'backspace') reply = reply.slice(0, -1);
    else if (text && !key.ctrl && !key.meta && /^[a-z]+$/i.test(text)) reply += text;
  });
}
