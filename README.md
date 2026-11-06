# pi-setup

My custom [Pi](https://pi.dev) extensions, skills, guidance, and preference defaults.
**Pi configuration—not a workstation installer.**

```text
Managed checkout                         ~/.pi/agent/
  agent/extensions/<feature> ── link ──> extensions/<feature>
  agent/skills/<skill>       ── link ──> skills/<skill>
  agent/AGENTS.md            ── link ──> AGENTS.md
  agent/settings.base.json  ── fill ──> settings.json (missing defaults only)

Your local additions, existing settings, packages, auth, and sessions stay yours.
```

## Install

Requires **macOS, Node.js 26+, Pi, and Git** already installed. Run in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/seongju0/pi-setup/main/install.sh | sh
```

Or clone, inspect `install.sh` and `scripts/`, then run `./install.sh`.
Both paths create a managed checkout at `~/.local/share/pi-setup/checkout/`
and a command at `~/.local/bin/pi-setup`. Shell startup files are not changed.

## Use

```sh
pi-setup install   # Preview → confirm → link resources and fill missing defaults
pi-setup update    # Fast-forward managed source, then reconcile
pi-setup check     # Read-only status
```

From a checkout, `./setup.sh --dry-run` previews without prompts or writes.
Use the full command path if `~/.local/bin` is not on `PATH`.

### What changes—and what doesn't

- Only [declared resources](manifests/resources.json) are linked individually.
- [Defaults](agent/settings.base.json) fill missing settings, including nested keys;
  existing values and unrelated keys are preserved. Settings remain a local file.
- Conflicting files or links are **skipped**, never replaced. Resolve them manually.
- Existing settings are privately backed up before adding defaults, under
  `~/.local/state/pi-setup/backups/`. Nothing is automatically pruned or uninstalled.

Updates require a clean checkout and tracking upstream. **Linked code changes
when Git pulls—even if you cancel reconciliation.** Reload idle Pi sessions
when ready; setup never reloads Pi or restarts apps.

`PI_CODING_AGENT_DIR` selects another Pi directory; `PI_SETUP_HOME` selects another
managed installation location.

## Features and dependencies

See [extensions](agent/extensions/README.md) and [custom skills](agent/skills) for
usage. Dependencies are installed and configured separately:

| Feature | Dependency |
| --- | --- |
| Herdr sessions, handoff, research | [Herdr App / `hc`](https://github.com/herdrdev/herdr-app); run Pi inside Herdr |
| `/view` | Your configured editor; defaults to [Zed](https://zed.dev) |
| GitHub skill updates | [GitHub CLI](https://cli.github.com/) with `gh skill` support |
| Web search / delegation | Available models and provider authentication; see [search auth support](agent/extensions/web-search/README.md) |
| Optional Linear features | Your configured Linear MCP integration |
| Browser workflows | A browser CLI and skill, such as [agent-browser](https://agent-browser.dev) |
| `/no-sleep` | macOS `caffeinate` (built in) |
| `/usage` | Local session/subagent metadata; no network or extra credentials |

No external apps, packages, or upstream skills are offered or installed by setup.

## Development

Edit repository source, not live Pi files. Run `npm test` (temporary state, no real
service calls). See [AGENTS.md](AGENTS.md) for boundaries.

[MIT license](LICENSE).
