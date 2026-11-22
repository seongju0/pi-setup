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

## Browser workflows

- **Existing signed-in account or current Ardia tab:** the repository-owned
  [authed-browser skill](agent/skills/authed-browser/SKILL.md) uses `ardia browse`
  directly. Requires Ardia and its CLI installed through their owner, Ardia
  running with **Let the ardia command control Ardia** enabled, and the intended
  account signed in. No Ghostty, Chrome-profile copying, or standalone
  agent-browser is needed for this path.
- **Public/headless browsing and isolated QA:** use the upstream `agent-browser`
  skill and CLI, installed through their owner. Test logins in an isolated QA
  browser stay on this path.
- **Public research:** use `web_search`; inspect public sources with
  agent-browser. Never send private signed-in page content to public search.

Ardia sessions share the browser's account cookies; a named session is not an
isolated login. Missing Ardia access or the wrong account requires user action,
not an automatic fallback. Some Ardia commands are policy-restricted; consult
`ardia browse --help` rather than assume full agent-browser parity.

### Replacing the local Ghostty workflow

The new skill keeps the name `authed-browser`. An existing local copy is not
changed merely by updating this source. When deliberately migrating, discard the
obsolete Ghostty guide at the installed `skills/authed-browser` path, then use
`pi-setup install` to link the repository-owned replacement. No backup of that
obsolete guide is needed. Setup preserves existing resource conflicts; it does
not remove or replace the old guide for you.

Check for duplicate skills in custom resource roots, then reload idle Pi sessions
when ready. Do not edit installed upstream skills, delete saved browser state or
profile aliases, or uninstall Ghostty as part of this migration. Setup never
performs those cleanup operations or reloads Pi for you.

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

## Author skills

Use `/skill:writing-skills` to create or refine a skill with concise prose,
clear activation and a focused workflow. See the [authoring guide](agent/skills/writing-skills/SKILL.md).

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
| Authenticated browsing | Running Ardia with CLI control enabled; use [authed-browser](agent/skills/authed-browser/SKILL.md) |
| Public/headless browsing and isolated QA | Upstream [agent-browser CLI and skill](https://agent-browser.dev) |
| `/no-sleep` | macOS `caffeinate` |
| `/usage` | Local session/subagent metadata |

## Development

Run `npm test`. See [development guidance](AGENTS.md).

[MIT license](LICENSE).
