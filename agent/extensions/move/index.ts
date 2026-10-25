import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { DynamicBorder, getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, SelectList, Text } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("move", {
    description: "Continue this session in another working directory (usage: /move [path]; opens a configurable root picker, default ~/Work)",
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

          const configPath = resolve(getAgentDir(), "extensions/move/config.json");
          let configText: string | undefined;
          try {
            configText = await readFile(configPath, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }

          let configuredRoot = "~/Work";
          if (configText !== undefined) {
            const config = JSON.parse(configText);
            if (!config || typeof config !== "object" || Array.isArray(config)) {
              throw new Error(`Expected a configuration object in ${configPath}`);
            }
            if (Object.hasOwn(config, "root")) {
              if (typeof config.root !== "string" || !config.root.trim()) {
                throw new Error(`Expected a nonempty root path in ${configPath}`);
              }
              configuredRoot = config.root;
            }
          }

          const home = homedir();
          const expandedRoot = configuredRoot === "~" ? home
            : configuredRoot.startsWith("~/") ? resolve(home, configuredRoot.slice(2))
            : configuredRoot;
          if (!isAbsolute(expandedRoot)) {
            throw new Error(`Root must be an absolute path or start with ~/: ${configuredRoot}`);
          }
          const root = resolve(expandedRoot);
          const displayRoot = root === home ? "~" : root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root;
          const rootLabel = `Root — ${displayRoot.endsWith("/") ? displayRoot : `${displayRoot}/`}`;
          await mkdir(root, { recursive: true });
          const directories = (await readdir(root, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));

          const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
            const container = new Container();
            const input = new Input({ prompt: "Search: ", placeholder: "Type a directory name…" });
            const listContainer = new Container();
            let list: SelectList;
            const updateList = () => {
              const query = input.getValue();
              const matches = fuzzyFilter(directories, query, (name) => name);
              list = new SelectList(
                [
                  { value: root, label: rootLabel },
                  ...matches.map((name) => ({ value: resolve(root, name), label: name })),
                ],
                10,
                {
                  selectedPrefix: (text) => theme.fg("accent", text),
                  selectedText: (text) => theme.fg("accent", text),
                  description: (text) => theme.fg("muted", text),
                  scrollInfo: (text) => theme.fg("dim", text),
                  noMatch: () => theme.fg("warning", "  No matching directories"),
                },
              );
              list.onSelect = (item) => done(item.value);
              list.onCancel = () => done(undefined);
              list.setSelectedIndex(query.trim() && matches.length > 0 ? 1 : 0);
              listContainer.clear();
              listContainer.addChild(list);
            };
            updateList();

            container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
            container.addChild(new Text(theme.fg("accent", `Move session — ${displayRoot}`)));
            container.addChild(input);
            container.addChild(listContainer);
            container.addChild(new Text(theme.fg("dim", "Type to filter • ↑↓ navigate • enter select • esc cancel")));
            container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

            return {
              get focused() { return input.focused; },
              set focused(value: boolean) { input.focused = value; },
              render: (width: number) => container.render(width),
              invalidate: () => container.invalidate(),
              handleInput(data: string) {
                if ((["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const)
                  .some((action) => keybindings.matches(data, action))) {
                  list.handleInput(data);
                } else {
                  const previous = input.getValue();
                  input.handleInput(data);
                  if (input.getValue() !== previous) updateList();
                }
                tui.requestRender();
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
