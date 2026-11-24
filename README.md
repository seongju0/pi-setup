# pi-setup

Opinionated setup for [Pi](https://pi.dev): extensions, skills, instructions and
preferences for coding, research and ongoing work. Built around explicit
permissions, durable task context, deliberate delegation and independent review.

Use it as a reference or copy the parts that fit your workflow. There is no
installer or automatic sync.

## Use it

Copy whole feature directories from `agent/` into `~/.pi/agent/` (or
`$PI_CODING_AGENT_DIR`) for personal use, or `.pi/` for a project. Read each item's
docs for dependencies and preserve sibling paths, including shared `extensions/lib/`
files and companion skills. External tools and accounts are managed separately.

Compare existing files before copying. Merge selected instruction sections from
[`agent/AGENTS.md`](agent/AGENTS.md) and preferences from
[`agent/settings.base.json`](agent/settings.base.json); do not replace your own
instructions or settings. Adapt instruction links and adopt their required tools
and skills too.

Load extensions in a new session or use `/reload` deliberately in an idle session.
To try one from this checkout, use `pi -e ./agent/extensions/context/index.ts`.

## Extensions

| Extension | Purpose |
| --- | --- |
| [continue](agent/extensions/continue) | Idle-only continue shortcut |
| [move](agent/extensions/move/README.md) | Move a saved session to another directory |
| [no-sleep](agent/extensions/no-sleep) | Keep macOS awake during runs with `caffeinate` |
| [statusline](agent/extensions/statusline/README.md) | Git, model, context and cache footer; configurable loader |
| [reply-visuals](agent/extensions/reply-visuals/README.md) | Chat emphasis and status chips |
| [Context](agent/extensions/context/README.md) | Durable work context, artifacts and integrated session-local tasks |
| [session-history](agent/extensions/session-history/README.md) | Search saved conversation history and read exact references |
| [usage](agent/extensions/usage/README.md) | Local token usage and cost estimates |
| [view](agent/extensions/view/README.md) | Open paths in your editor; defaults to Zed |
| [web-search](agent/extensions/web-search/README.md) | Native Anthropic/OpenAI public search |
| [herdr-session](agent/extensions/herdr-session/README.md) | Herdr tabs, research workers, reports and optional reboot restore |
| [subagent](agent/extensions/subagent/README.md) | Parent-owned background workers and selected MCP capabilities |

Context is self-contained: copy its whole directory, with Node.js 26+ and a supported Pi installation. It provides `context_project` / `context_project_*` tools for independent project memory, `context_knowledge` for explicitly maintained reusable knowledge and unchanged `task` / `/task` session-local task JSON. `/context` is the only project command; old `todo*` tool aliases, `/todo` and the retired move tool are not registered. Existing SQLite schema1 project stores need the separate explicit schema2 upgrade; legacy JSON import remains a different supported CLI. Copying source does not migrate data. Session-history is optional enhanced journal retrieval, not a Context source dependency. Before adopting Context, manually retire both old task and todo extension entries; preserve all runtime task/project/session data. See the [Context adoption steps](agent/extensions/context/README.md#adoption).
Subagents require sibling web-search source unless callers explicitly use
`web: false`. See the linked READMEs for required shared files and external tools.

## Skills

| Skill | Purpose |
| --- | --- |
| [authed-browser](agent/skills/authed-browser/SKILL.md) | Guide existing signed-in browsing through Search MCP |
| [build](agent/skills/build/SKILL.md) | Implement and verify a settled change |
| [checkout](agent/skills/checkout/SKILL.md) | Cache and refresh repositories for inspection |
| [codebase-design](agent/skills/codebase-design/SKILL.md) | Define boundaries, ownership and caller contracts |
| [deliver](agent/skills/deliver/SKILL.md) | Implementation, independent review and draft PR |
| [draft-pr](agent/skills/draft-pr/SKILL.md) | Create draft PRs and refine existing titles and descriptions |
| [handoff](agent/skills/handoff/SKILL.md) | Transfer work to an independent session |
| [linear-issues](agent/skills/linear-issues/SKILL.md) | Write and organize issues and milestones |
| [peer-review](agent/skills/peer-review/README.md) | Evaluate a PR using the shared review and pragmatic design standards |
| [plan](agent/skills/plan/SKILL.md) | Produce a codebase-verified, build-ready implementation plan |
| [research](agent/skills/research/SKILL.md) | Coordinate read-only Herdr research |
| [review](agent/skills/review/SKILL.md) | Review correctness, regressions and tests |
| [walkthrough](agent/skills/walkthrough/SKILL.md) | Explain behavior and architecture clearly, with shared illustrations and PR walkthrough guidance |
| [writing-skills](agent/skills/writing-skills/SKILL.md) | Author focused skills |

`peer-review` requires sibling `review`, `codebase-design` and
`build/references/testing.md`, plus PR/source access. Copy `walkthrough/` too for
combined explanation and evaluation; its `references/pr-walkthrough.md` guides
chat-first PR explanations without requiring a review. Copy whole directories
and preserve local changes. Neither requires `summarize-pr` or HTML tooling;
see the peer-review README for adoption and validation boundaries.
`draft-pr` also requires the sibling `walkthrough/` directory, including its PR
walkthrough guidance and shared `references/illustration-examples.md` catalogue.

`authed-browser` requires the external [Search browser and upstream `search-mcp`](https://github.com/driceroland/Search#testing-it-without-closing-it),
Python 3, and coding-agent control enabled in Search. Obtain the bridge from its
upstream repository, keep it outside this catalog, and register it with Pi using
`pi mcp add search -- /absolute/path/to/search-mcp`. Allow at least 120 seconds
for Search's connection prompt (for example, set the server's `timeout` to `180`
in your user-level MCP configuration). Load the configuration in a new session
or deliberately reload when idle. No browser build is needed for the running-app
bridge. Existing user tabs are optional read-only; agents act in their own tabs.
Copy the skill directory and selectively merge the Browser routing section of
`agent/AGENTS.md`; MCP configuration stays with the user's MCP client, not here.

### Obtain or update the Search MCP bridge manually

The bridge is a standalone Python script; do not copy it into `pi-setup`. This
example pins the upstream revision used for the initial setup. Download to a
staging directory first, then inspect the script and license before installing:

```sh
revision=4dbc44ec9c64e454493a7fe66730c3b5d08d67c1
staging="$(mktemp -d)"
curl --fail --location "https://raw.githubusercontent.com/driceroland/Search/$revision/search-mcp" -o "$staging/search-mcp"
curl --fail --location "https://raw.githubusercontent.com/driceroland/Search/$revision/LICENSE" -o "$staging/LICENSE"
printf 'Review the downloads in %s before continuing.\n' "$staging"
```

After reviewing, in the same shell (stop if either download failed):

```sh
destination="$HOME/.local/share/search-mcp"
mkdir -p "$destination"
# For an update, preserve the previous bridge before replacing it.
if [ -f "$destination/search-mcp" ]; then
  cp -p "$destination/search-mcp" "$destination/search-mcp.previous"
fi
install -m 755 "$staging/search-mcp" "$destination/search-mcp"
install -m 644 "$staging/LICENSE" "$destination/LICENSE"
printf 'https://github.com/driceroland/Search\nCommit: %s\n' "$revision" > "$destination/UPSTREAM.txt"
```

For first-time setup, register that path with
`pi mcp add search -- "$HOME/.local/share/search-mcp/search-mcp"`, then set the
server timeout as described above. Do not rerun registration merely to update
the script: it can replace an existing server entry and its custom settings.
For an update, choose an explicit newer upstream commit, review its changes and
repeat the download/review/replacement steps while no browser task is active.
Use a new Pi session or deliberately reload when idle to load the new bridge;
its first browser operation remains subject to Search's consent rules. These are
manual instructions, not an installer or an automatic update mechanism.

## Updates

Compare with newer source and merge the changes you want. Preserve local
`move/config.json`, `statusline/loader.json`, settings and runtime data.
External skills, packages and tool-generated guidance use their owner's update
mechanism; this catalog does not provide a skill-updater command.

The SDLC skills `design` and `open-pr` are now `plan` and `draft-pr`. When adopting
these names, copy the new directories or replace per-skill links, and update
`/skill:` invocations and required skill paths. Compare local changes before
manually retiring the old copies or links. Old-name aliases are not provided;
keeping both entries can expose duplicate guidance.

For older linked setups, update the checkout through Git, not `pi-setup update`:
the retired updater can pull successfully, then fail on the removed setup script.
The old `~/.local/bin/pi-setup` launcher becomes dangling; retire it manually.
Context replaces the old source `task/` and `todo/` entries; its runtime data paths
are unchanged. The custom `update-skills` extension and `/skills` updater were
retired. Remove an older `extensions/update-skills/` entry explicitly if you no
longer want that command; copying new source does not remove the old copy.
The illustration catalogue moved from `draft-pr/references/illustration-examples.md`
to `walkthrough/references/illustration-examples.md`. Adopt both updated skill
directories; compare local additions before manually removing the obsolete copy.
Other resource paths are unchanged apart from this move and the skill renames above.
Keep any checkout still used by links or restore hooks, Pi sessions/tasks/TODOs/subagent
records, and `~/.local/state/pi-setup/{herdr-sessions,backups}/`.

## Development

Run `npm test` with Node.js 26+ and an existing Pi installation. Tests use
temporary state and no real service calls. See [AGENTS.md](AGENTS.md).

[MIT license](LICENSE).
