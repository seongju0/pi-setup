# pi-setup

My reusable [Pi](https://pi.dev) setup: instructions, extensions, skills, and
preferences, with an interactive installer and a separate managed checkout.

## Requirements

macOS, Node.js 26+, and existing `pi` and `git` commands on `PATH`.
Installation requires an interactive terminal. Pi, Node, Git, and Homebrew are
not installed or upgraded by setup.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/seongju0/pi-setup/main/install.sh | sh
```

Prefer to inspect first? Clone this repository, review `install.sh` and `scripts/`,
then run `./install.sh`. Both approaches create a separate managed checkout.

```sh
pi-setup install     # Revisit choices and reconcile resources
pi-setup update      # Pull upstream changes, then review setup
pi-setup check       # Read-only status
```

Use `~/.local/bin/pi-setup` directly if that directory is not on your `PATH`.
Setup does not change shell startup files.

## Included

- [Extensions](agent/extensions/README.md): subagents, Herdr sessions, web search,
  tasks, todos, session utilities, and skill updates.
- [Skills](agent/skills): build, design, review, research, checkout, handoff,
  walkthrough, and related workflows.
- [Global instructions](agent/AGENTS.md) and an optional
  [preference template](agent/settings.base.json).
- Optional [Pi packages](manifests/packages.json) and
  [tools/companion skills](manifests/tools.json), including gh-stack, Herdr, and
  agent-browser. These are installed from upstream, not bundled here.

[No-sleep](agent/extensions/no-sleep/README.md) keeps macOS from idle-system sleep
for each Pi session by default. Use `/no-sleep off` to disable it or
`/no-sleep agent` for active agent runs only. The display may still sleep.

## Local configuration

```text
~/.local/share/pi-setup/checkout/   Managed source; keep this directory
~/.local/bin/pi-setup              Command linked into that checkout
~/.pi/agent/                      Your settings and installed resource links
~/.local/state/pi-setup/           Choice history and replacement backups
```

Resources are linked individually using [an explicit list](manifests/resources.json).
Settings remain a regular local JSON file. Existing settings and unrelated files
are preserved unless you explicitly approve changes. Review custom extension
behavior and permission rules before replacing existing resources.

Optional packages, tools, and companion skills start unselected. Changes are
previewed; replacements and final approval default to **no**. Approved replacements
are backed up. Native installer failures may leave earlier approved changes.

Setup does not prune resources, uninstall tools, reload Pi, or restart Herdr.
Updates require a clean checkout and tracking upstream, and allow fast-forward
only. External packages and tools keep their own update mechanisms.

Use `PI_CODING_AGENT_DIR` for a custom Pi directory or `PI_SETUP_HOME` for another
managed installation location.

## Development

Keep development separate from the managed checkout:

```text
edit → npm test → commit → push → pi-setup update → review → /reload
```

```sh
npm test                   # Requires globally installed Pi and Python 3
./setup.sh --dry-run        # Preview this checkout
./setup.sh                 # Explicitly link resources from this checkout
```

Source lives in `agent/`; installation choices live in `manifests/`.
Running `./setup.sh` links directly to that checkout, so use the managed install
for ordinary use.

## License

[MIT](LICENSE). External packages and tools retain their own licenses.
