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
| [update-skills](agent/extensions/update-skills/README.md) | Inspect skill ownership and use owner-native updates |
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
| [authed-browser](agent/skills/authed-browser/SKILL.md) | Use an existing signed-in Ardia account or tab |
| [build](agent/skills/build/SKILL.md) | Implement and verify a settled change |
| [checkout](agent/skills/checkout/SKILL.md) | Cache and refresh repositories for inspection |
| [codebase-design](agent/skills/codebase-design/SKILL.md) | Define boundaries, ownership and caller contracts |
| [deliver](agent/skills/deliver/SKILL.md) | Implementation, independent review and draft PR |
| [design](agent/skills/design/SKILL.md) | Produce a build-ready specification |
| [handoff](agent/skills/handoff/SKILL.md) | Transfer work to an independent session |
| [linear-issues](agent/skills/linear-issues/SKILL.md) | Write and organize issues and milestones |
| [open-pr](agent/skills/open-pr/SKILL.md) | Write source-grounded PR descriptions |
| [research](agent/skills/research/SKILL.md) | Coordinate read-only Herdr research |
| [review](agent/skills/review/SKILL.md) | Review correctness, regressions and tests |
| [walkthrough](agent/skills/walkthrough/SKILL.md) | Explain behavior and architecture clearly |
| [writing-skills](agent/skills/writing-skills/SKILL.md) | Author focused skills |

## Updates

Compare with newer source and merge the changes you want. Preserve local
`move/config.json`, `statusline/loader.json`, settings and runtime data.

For older linked setups, update the checkout through Git, not `pi-setup update`:
the retired updater can pull successfully, then fail on the removed setup script.
The old `~/.local/bin/pi-setup` launcher becomes dangling; retire it manually.
Context replaces the old source `task/` and `todo/` entries; its runtime data paths are unchanged. Other resource paths are unchanged. Keep any checkout still used by links or restore
hooks, Pi sessions/tasks/TODOs/subagent records, and
`~/.local/state/pi-setup/{herdr-sessions,backups}/`.

## Development

Run `npm test` with Node.js 26+ and an existing Pi installation. Tests use
temporary state and no real service calls. See [AGENTS.md](AGENTS.md).

[MIT license](LICENSE).
