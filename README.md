# pi-setup

My reusable [Pi](https://pi.dev) foundation: personal instructions, extensions,
skills, selected preferences, and declarations for external packages and tools.

Planned public repository: [seongju0/pi-setup](https://github.com/seongju0/pi-setup).

## Status

Managed consumer installation, checkout-based development setup, and isolated
checks are available. The hosted bootstrap needs this repository to be published
before its GitHub URL works. Setup never reloads Pi or restarts Herdr.
Remote companion skills are separate, optional choices alongside their tools.

## Development

Prerequisites: an existing Pi installation and Node.js >=26.0.0. Tests
currently resolve the globally installed Pi package through npm; baseline
verification uses Pi 1.4.0. Pi is a prerequisite, not a dependency this repo installs.
Consumer PTY tests also use `python3` with its standard library; the installer
itself does not require Python.

```sh
npm test
```

There are no project npm dependencies or npm lifecycle install scripts. The test runner
loads the declared extension entry points with Pi's real loader, then runs
their retained suites in child processes with temporary home, agent, and todo
directories. It passes the host path as `PI_TEST_PACKAGE_ROOT`, so sandboxing
HOME does not break version-manager shims.

External boundaries use synthetic providers, stand-in native installers, a fake
Herdr CLI, and local MCP test servers. Consumer/update flows use temporary local
Git repositories, not GitHub or your development checkout. Checkout-cache flows exercise the real Node/Git helper and bash launcher with temporary bare remotes and narrowly scoped HTTPS-to-local URL rewrites. No real credentials, provider usage, tracker writes, power-setting
changes, or user data are needed. The no-sleep suite loads the replacement through
Pi's real extension loader and patches only Node's native spawn boundary; it never
runs caffeinate or verifies native OS assertions.

- Edit maintained source under `agent/`.
- Keep inclusion explicit in `manifests/resources.json`.
- Declare external package sources in `manifests/packages.json`; don't vendor installations.
- Keep local workplace instructions, policy, and credentials outside the repository.

## Layout

```text
AGENTS.md                  Repository development guidance; not installed
agent/
  AGENTS.md                Global instructions
  settings.base.json       Curated preferences, not a live settings dump
  extensions/              Source, supporting modules, and tests
  skills/                  Personal skills and supporting files
manifests/
  resources.json           First-party inclusion list
  packages.json            Optional external Pi package sources
  tools.json               Optional native tools and companion skills
scripts/
  test.mjs                 Isolated loader check and suite runner
```

## Foundation and local additions

The [Herdr extension](agent/extensions/herdr-session/README.md) starts sessions
and transports reports without assuming a particular workflow, provider policy,
or installed analysis skill. Local workflows supply guidance/model choices and
call those generic tools.

[Subagents](agent/extensions/subagent/README.md) provide parent-owned background
work with native search enabled by default and explicitly selected MCP servers.
A personal-only MCP policy setting can load local protections inside children
without putting organization policy in this repository.

The research and handoff skills use those reusable mechanisms. Analysis
guidance, on-call workflows, GWS skills, MCP configuration, and organization
policies remain local additions. They are not prerequisites for loading the
foundation.

[No-sleep](agent/extensions/no-sleep/README.md) requests local macOS idle-system
sleep inhibition, enabled session-wide by default, with opt-in agent-only scope.
Its helper status is not an independently verified OS assertion; see its command,
environment, runtime-reset, and host-placement limitations before use.

## Consumer installation

Your live Pi environment is a consumer, not a link to your development checkout.
The bootstrap obtains a separate persistent checkout, then runs its installer.
Once the repository is published:

```sh
curl -fsSL https://raw.githubusercontent.com/seongju0/pi-setup/main/install.sh | sh

# After installation (or use ~/.local/bin/pi-setup directly):
pi-setup install           # Reconcile; revisit all optional tools
pi-setup update            # Pull latest pushed upstream; offer newly added tools
pi-setup check             # Read-only status
```

Prefer to inspect first? Clone the repository, review `install.sh` and its scripts,
then run `./install.sh`. This still creates the separate managed client checkout.
The bootstrap requires `/dev/tty` for interactive approval and stops before any
changes if there is no terminal. It never installs Pi, Node, Git, or Homebrew.
Rerunning it detects the existing client and offers an update instead of resetting
or silently pulling the checkout.

Default client locations:

```text
~/.local/share/pi-setup/checkout/   Managed Git checkout
~/.local/bin/pi-setup              Command linked into that checkout
~/.local/state/pi-setup/           Tool-choice history and replacement backups
~/.pi/agent/                      Pi settings/local additions + foundation links
```

`PI_SETUP_HOME` selects another managed installation directory (the checkout lives
in its `checkout/` child). `PI_SETUP_REPOSITORY` selects a fork/source for obtaining
the checkout. Existing Git upstream configuration is not silently changed.
`PI_CODING_AGENT_DIR` still controls the Pi target. The installer does not edit
shell startup files; add `~/.local/bin` to PATH yourself if needed.

### Optional tools

Installation shows one checklist of optional tools and companion skills, all
unchecked by default. Related tool and skill choices are listed together.
Updates offer newly introduced missing tools; previously declined tools remain
available through `pi-setup install`. Existing detected executables are shown as
installed and are not automatically reinstalled or upgraded.

Selected native installer commands are previewed and need final approval.
Unavailable installer prerequisites are reported instead of installing another
Node, Homebrew, or package manager. Choice history is private client-local state,
not part of Pi settings. Cancelling does not remember a declined choice;
completing and approving an unchecked offer does. No deselection uninstalls tools.

| Choice | Native installation |
| --- | --- |
| GitHub CLI (`gh`) | `brew install gh` |
| gh-stack extension | `gh extension install github/gh-stack` |
| Herdr | `brew install herdr` |
| agent-browser | `npm install -g agent-browser`, then `agent-browser install` |
| Each companion skill: gh-stack, Herdr, agent-browser | `gh skill install <upstream-repository> <skill> --dir <consumer-agent>/skills` |

One **agent-browser** tool checkbox includes its CLI and Chrome for Testing
download; both commands appear before approval. Existing installations are not
probed for missing Chrome or repaired; use their owner's commands yourself.
Terminal Browser is deferred: its installed setup does not currently register Pi
and has effects beyond a Pi skill link.

If GitHub CLI is missing, explicitly select it before selecting dependent choices.
Deselecting it clears those dependent selections; no dependency is silently
installed. The approved commands run in dependency order. If `gh` was previously
declined, use `pi-setup install` to revisit it. Existing `gh` must support `gh skill`
for companion installation; update an older CLI yourself through its existing
owner. Authentication is left to GitHub CLI; setup never runs `gh auth login` or
changes Git configuration. gh-stack requires Git >=2.36.

Companions are independent: a missing skill is offered even when its CLI is already
installed, and selecting a skill does not install its CLI/extension. The explicit
skills directory respects `PI_CODING_AGENT_DIR`, including a custom location.
Upstream content is installed by GitHub CLI with tracking metadata, not copied
into this repository. Existing skill paths—including local directories, symlinks,
and broken links—are preserved without overwrite or adoption. gh-stack presence
is detected through `gh extension list`, not by mistaking `gh` for the extension.
Native commands may leave approved partial changes if they fail; rerun after
following the owner's instructions. Missing choices are informational in `check`,
not auto-repaired.

## Checkout-based setup

Require macOS, Node.js >=26.0.0, and an existing `pi` on PATH. Setup reuses the
installation it finds, including a version-manager installation; it will not
install or upgrade Pi or Node. Homebrew is not needed for the current foundation
and Pi-package steps. Optional CLI tools require their listed native installer.

```sh
./setup.sh --dry-run       # Read-only preview; no prompts or installations
./setup.sh                 # Install/reconcile this checkout; safe to repeat
./update.sh                # Pull latest pushed upstream, then reconcile
node scripts/check.mjs     # Read-only resource/package-declaration status
```

Choose global instructions, extensions, personal skills, preferences, and optional
Pi packages. Setup previews actions before asking about replacements and applying
anything. Replacement approval and final confirmation default to **no**.
Unchecked components are not uninstalled; existing correct links are no-ops.
Existing settings default to **not selected**: ordinary reruns leave their contents
byte-for-byte unchanged, even when the repository adds new preference fields.
Preferences are offered by default only when no settings file exists.

- Targets follow `PI_CODING_AGENT_DIR`, or default to `~/.pi/agent`.
- Links derive from this persistent checkout; do not remove it afterward.
- `/move` links only its entry file so its existing local `config.json` survives.
  The shared model helper also links as an individual file rather than replacing
  the entire local `extensions/lib/` directory.
- **Opt-in preferences** merge into the writable live settings file. Unknown local
  fields, model/editor choices, trust policy, and package resource filters remain
  local. Existing preferences are never refreshed merely because source was
  updated; selecting preference changes and replacing conflicts require approval.
  Settings must be a regular JSON file; setup stops rather than writing through
  a settings symlink.
- Selected missing Pi package declarations use `pi install <source>`. Existing
  declarations, including pinned versions and filters, are retained without an
  implicit update. Declared does not mean its runtime installation was verified.
- Replaced resources and existing settings are backed up in a private run folder
  under `~/.local/state/pi-setup/backups/`, outside the checkout. Setup prints the
  backup location. A failed external install may leave earlier approved changes;
  backups remain available and setup does not claim transactional rollback.
- No whole-agent replacement, pruning, tool upgrades/uninstalls, reloads, or server
  restarts. Sessions, tasks/todos/artifacts, credentials, MCP configuration, and
  unrelated local additions are not installer-owned data.

**Existing customized environments:** review local workflow adapters and child
MCP policy before replacing their foundation extensions. Setup cannot infer
workplace policy from custom code or migrate it for you. Keep the checkout setup
separate from your eventual live migration review.

### Updating versus local development

`./update.sh` pulls the **latest pushed revision of the checkout's tracking
branch**, not a release tag. It requires a clean Git checkout with an upstream
configured and permits fast-forward only. Local edits/untracked files or divergent
history stop the update; it never stashes, resets, rebases, or switches branches.
After pulling, it starts the newly pulled installer for review of new links.
An installer cancellation does not undo the completed source update.

Keep machine-local extensions and settings outside the checkout, alongside the
managed links. They are not removed or replaced during normal reconciliation.
Updates do not automatically upgrade external Pi packages or supporting tools.
Existing linked source changes become active when you reload; setup never does
that for you.

For local development: edit here, run `npm test`, run `./setup.sh` for new
resources or explicitly chosen settings/dependencies, then reload individual idle
Pi sessions yourself. Commit or otherwise resolve source edits before using the
updater. Existing linked source edits need no copy-back step.

### Maintaining and consuming your own setup

```text
Development checkout                  Managed consumer checkout
edit → npm test → commit → push  ───→  pi-setup update → review → /reload
```

Do not point the consumer path at the development checkout. Development edits and
pushes do not alter the consumer until you update it. Running `./setup.sh` directly
is an explicit developer path: its links target that checkout, so use the client
bootstrap/command for ordinary consumer testing.

## Attribution and publication

Original pi-setup content is licensed under [MIT](LICENSE).
Web-search documentation retains its design inspiration credit. External tools
and packages are installed separately under their own terms, not vendored here.

`private: true` prevents accidental npm publication; it does not restrict public
Git distribution or alter the license.
