# pi-setup

My custom [Pi](https://pi.dev) extensions, skills, guidance, and preference defaults.

```text
Managed checkout                         ~/.pi/agent/
  agent/extensions/<feature> ── link ──> extensions/<feature>
  agent/skills/<skill>       ── link ──> skills/<skill>
  agent/AGENTS.md            ── link ──> AGENTS.md
  agent/settings.base.json  ── fill ──> settings.json (missing defaults only)
```

## Install

Requires **macOS, Node.js 26+, Pi, and Git** already installed. Run in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/seongju0/pi-setup/main/install.sh | sh
```

Or clone, inspect `install.sh` and `scripts/`, then run `./install.sh`.
Both paths create a managed checkout at `~/.local/share/pi-setup/checkout/`
and a command at `~/.local/bin/pi-setup`.

## Use

```sh
pi-setup install   # Preview → confirm → link resources and fill missing defaults
pi-setup update    # Fast-forward managed source, then reconcile
pi-setup check     # Read-only status
```

From a checkout, `./setup.sh --dry-run` previews without prompts or writes.
Use the full command path if `~/.local/bin` is not on `PATH`.

### Sync behavior

Links [declared resources](manifests/resources.json) and fills missing
[defaults](agent/settings.base.json). Existing settings and conflicting files are
preserved. Settings are backed up under `~/.local/state/pi-setup/backups/` before
modification. Nothing is deleted.

Updates require a clean checkout and tracking upstream. **Linked code changes
when Git pulls—even if you cancel reconciliation.** Reload idle Pi sessions
when ready; setup never reloads Pi or restarts apps.

`PI_CODING_AGENT_DIR` selects another Pi directory; `PI_SETUP_HOME` selects another
managed installation location.

## Workflow and task memory

The declared resources ship TODO, workflow skills and shared guidance together,
but integrate through a task-memory contract rather than runtime orchestration.
Skills own how work is performed; TODO owns durable understanding and retrieval.
Standalone sessions and parents resolve the owner, while delegated workers use
supplied context and return results for the parent to curate. Presentation and
preservation are separate decisions; native saved results normally suffice for
stage reports without duplicate files. If durable tracking is declined or
unavailable, skills disclose their fallback and its persistence limits. TODO does
not launch the workflows or require their stage sequence. See the
[memory contract](agent/extensions/todo/docs/memory.md).

## Features and dependencies

See [extensions](agent/extensions/README.md) and [custom skills](agent/skills) for
usage. Dependencies are installed and configured separately:

| Feature | Dependency |
| --- | --- |
| Herdr sessions, handoff, research | [Herdr App / `hc`](https://github.com/herdrdev/herdr-app); run Pi inside Herdr |
| `/view` | Your configured editor; defaults to [Zed](https://zed.dev) |
| `/move` directory discovery | [`fd`](https://github.com/sharkdp/fd) on PATH, or Pi’s existing managed `bin/fd`; setup does not install it |
| GitHub skill updates | [GitHub CLI](https://cli.github.com/) with `gh skill` support |
| Web search / delegation | Available models and provider authentication; see [search auth support](agent/extensions/web-search/README.md) |
| Optional Linear features | Your configured Linear MCP integration |
| Browser workflows | A browser CLI and skill, such as [agent-browser](https://agent-browser.dev) |
| `/no-sleep` | macOS `caffeinate` |
| `/usage` | Local session/subagent metadata |

## Development

Run `npm test`. See [development guidance](AGENTS.md).

[MIT license](LICENSE).
