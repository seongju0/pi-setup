import { existsSync } from "node:fs";
import { basename } from "node:path";

// Match upstream's launcher: installed Node/Bun CLI, compiled executable, then PATH.
export function piInvocation(args: string[]) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  if (!/^(node|bun)(\.exe)?$/i.test(basename(process.execPath))) return { command: process.execPath, args };
  return { command: "pi", args };
}
