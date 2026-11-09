import { execFile } from "node:child_process";
import { opendir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { DynamicBorder, getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const SNAPSHOT_LIMIT = 20_000;
const expandHome = (path: string) => path === "~" ? homedir()
  : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
const displayPath = (path: string) => path === homedir() ? "~"
  : path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readScopes(cwd: string): Promise<string[]> {
  const configPath = resolve(getAgentDir(), "extensions/move/config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Expected a configuration object in ${configPath}`);
  }
  if (!Object.hasOwn(config, "scope") && Object.hasOwn(config, "root") && typeof config.root !== "string") {
    throw new Error(`Expected a nonempty legacy root path in ${configPath}`);
  }
  const value = Object.hasOwn(config, "scope") ? config.scope
    : Object.hasOwn(config, "root") ? config.root : [];
  const paths = Array.isArray(value) ? value : [value];
  const scopes = paths.map((path) => {
    if (typeof path !== "string" || !path.trim() || path.includes("\0") || !isAbsolute(expandHome(path))) {
      throw new Error(`Scope must contain nonempty absolute paths or ~/ paths in ${configPath}`);
    }
    return resolve(expandHome(path));
  });
  return [...new Set(scopes.length ? scopes : [resolve(cwd)])];
}

function runFd(command: string, scope: string, cwd: string) {
  return new Promise<{ error: NodeJS.ErrnoException | null; stdout: string; stderr: string }>((done) => {
    execFile(command, ["--type", "d", "--relative-path", "--show-errors", "--color", "never", "--print0",
      "--hidden", "--no-ignore", "--exclude", ".git", "--exclude", "node_modules", "--max-results", "20001", "", scope],
    { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
    (error, stdout, stderr) => done({ error, stdout, stderr }));
  });
}

async function discoverScope(scope: string, cwd: string): Promise<{ items: SelectItem[]; warning?: string }> {
  try {
    if (!(await stat(scope)).isDirectory()) throw new Error("Not a directory");
    let result = await runFd("fd", scope, cwd);
    if (result.error?.code === "ENOENT") result = await runFd(resolve(getAgentDir(), "bin/fd"), scope, cwd);
    // Only consume complete NUL-delimited records, including after a bounded-process failure.
    const records = result.stdout.slice(0, result.stdout.lastIndexOf("\0") + 1).split("\0").filter(Boolean);
    const items = records.slice(0, SNAPSHOT_LIMIT).map((name) => {
      const value = resolve(scope, name);
      return { value, label: relative(scope, value), description: displayPath(scope) };
    });
    const warnings = [result.error && message(result.error), result.stderr.trim(),
      records.length > SNAPSHOT_LIMIT && `Limited to ${SNAPSHOT_LIMIT} directories`].filter(Boolean);
    return { items, warning: warnings.length ? `Scope ${displayPath(scope)}: discovery may be incomplete — ${warnings.join("; ")}` : undefined };
  } catch (error) {
    return { items: [], warning: `Scope ${displayPath(scope)}: ${message(error)}` };
  }
}

async function listParent(parent: string): Promise<{ items: SelectItem[]; warning?: string }> {
  const items: SelectItem[] = [];
  try {
    const directory = await opendir(parent);
    let count = 0;
    for await (const entry of directory) {
      if (++count > SNAPSHOT_LIMIT) return { items, warning: `Parent listing limited to ${SNAPSHOT_LIMIT} entries: ${displayPath(parent)}` };
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        const value = resolve(parent, entry.name);
        items.push({ value, label: displayPath(value) });
      }
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    return { items };
  } catch (error) {
    return { items, warning: `Cannot list ${displayPath(parent)}: ${message(error)}` };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("move", {
    description: "Continue this session in another working directory (usage: /move [path]; opens a scoped directory picker)",
    handler: async (args, ctx) => {
      const source = ctx.sessionManager.getSessionFile();
      if (!source) {
        ctx.ui.notify("Cannot move an unsaved or in-memory session", "error");
        return;
      }

      try {
        let path = args.trim();
        if (!path) {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("The directory picker requires interactive mode. Use /move <path> instead.", "warning");
            return;
          }

          const cwd = ctx.cwd;
          const scopes = await readScopes(cwd);
          const snapshots = await Promise.all(scopes.map((scope) => discoverScope(scope, cwd)));
          const scopeItems = scopes.map((scope) => ({ value: scope, label: `Scope — ${displayPath(scope)}` }));
          const directories = [...new Map(snapshots.flatMap((snapshot) => snapshot.items)
            .sort((a, b) => a.label.localeCompare(b.label)).map((item) => [item.value, item])).values()];
          const warnings = snapshots.flatMap((snapshot) => snapshot.warning ? [snapshot.warning] : []);

          const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
            const container = new Container();
            const input = new Input({ prompt: "Search: ", placeholder: "Directory name or ~/path…" });
            const listContainer = new Container();
            const status = new Text("", 0, 0);
            const parents = new Map<string, Awaited<ReturnType<typeof listParent>>>();
            const pending = new Set<string>();
            let closed = false;
            let list: SelectList;
            const finish = (value: string | undefined) => {
              if (closed) return;
              closed = true;
              done(value);
            };
            const explicitQuery = () => {
              const query = input.getValue();
              const expanded = expandHome(query);
              if (!isAbsolute(expanded) || query.includes("\0")) return undefined;
              return { path: expanded, parent: query.endsWith("/") || query === "~" ? expanded : dirname(expanded),
                prefix: query.endsWith("/") || query === "~" ? "" : basename(expanded) };
            };
            const updateList = (preserve = false) => {
              if (closed) return;
              const previous = preserve ? list?.getSelectedItem()?.value : undefined;
              const query = input.getValue();
              const explicit = explicitQuery();
              let items: SelectItem[];
              let parentWarning: string | undefined;
              if (explicit) {
                const cached = parents.get(explicit.parent);
                parentWarning = cached?.warning;
                const matches = fuzzyFilter(cached?.items ?? [], explicit.prefix, (item) => basename(item.value)).slice(0, 50);
                items = [{ value: resolve(explicit.path), label: `Use path — ${displayPath(resolve(explicit.path))}` }, ...matches];
                if (!cached && !pending.has(explicit.parent)) {
                  const parent = explicit.parent;
                  pending.add(parent);
                  void listParent(parent).then((result) => {
                    if (closed) return;
                    parents.set(parent, result);
                    pending.delete(parent);
                    if (explicitQuery()?.parent === parent) {
                      updateList(true);
                      container.invalidate();
                      tui.requestRender();
                    }
                  });
                }
              } else {
                items = fuzzyFilter([...scopeItems, ...directories], query, (item) => item.label).slice(0, 50);
              }
              list = new SelectList(items, 10, {
                selectedPrefix: (text) => theme.fg("accent", text),
                selectedText: (text) => theme.fg("accent", text),
                description: (text) => theme.fg("muted", text),
                scrollInfo: (text) => theme.fg("dim", text),
                noMatch: () => theme.fg("warning", "  No matching directories"),
              });
              list.onSelect = (item) => finish(item.value);
              list.onCancel = () => finish(undefined);
              const index = previous === undefined ? -1 : items.findIndex((item) => item.value === previous);
              list.setSelectedIndex(index < 0 ? 0 : index);
              listContainer.clear();
              listContainer.addChild(list);
              status.setText([...warnings, parentWarning].filter(Boolean).join("\n"));
            };
            updateList();

            container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
            container.addChild(new Text("Move session — Scope", 0, 0));
            container.addChild(input);
            container.addChild(listContainer);
            container.addChild(status);
            container.addChild(new Text("Type to filter • ↑↓ navigate • enter select • esc cancel", 0, 0));
            container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

            return {
              get focused() { return input.focused; },
              set focused(value: boolean) { input.focused = value; },
              dispose() { closed = true; },
              render: (width: number) => container.render(width),
              invalidate: () => container.invalidate(),
              handleInput(data: string) {
                if (closed) return;
                if ((["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const)
                  .some((action) => keybindings.matches(data, action))) {
                  list.handleInput(data);
                } else {
                  const previous = input.getValue();
                  input.handleInput(data);
                  if (input.getValue() !== previous) updateList();
                }
                if (!closed) {
                  container.invalidate();
                  tui.requestRender();
                }
              },
            };
          });
          if (selected === undefined) return;
          path = selected;
        }

        const target = resolve(ctx.cwd, path);
        if (!(await stat(target)).isDirectory()) {
          ctx.ui.notify(`Not a directory: ${target}`, "error");
          return;
        }
        if (target === resolve(ctx.cwd)) {
          ctx.ui.notify(`Session is already in ${target}`, "info");
          return;
        }

        await ctx.waitForIdle();
        const fork = SessionManager.forkFrom(source, target);
        const sessionFile = fork.getSessionFile();
        if (!sessionFile) throw new Error("Failed to create the moved session");

        const result = await ctx.switchSession(sessionFile, {
          withSession: async (ctx) => {
            ctx.ui.notify(`Moved session to ${target}`, "info");
          },
        });

        if (result.cancelled) {
          await unlink(sessionFile);
          ctx.ui.notify("Move cancelled", "info");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
