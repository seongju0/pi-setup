# Foundation extensions

Commands and configuration by extension:

| Source | Purpose |
| --- | --- |
| `continue/` | Idle-only continue shortcut |
| `move/` | Move a session using Pi's session APIs |
| `no-sleep/` | macOS sleep prevention using caffeinate |
| [`statusline/`](statusline/README.md) | Minimal directory/Git, model/context/cache footer; separated extension info, native input spacing and configurable loading animations/phrases |
| `task/` | Session-local task tracking |
| `todo/` | Durable local work context, paged artifacts and curated knowledge search; optional user-configured Linear integration |
| [`session-history/`](session-history/README.md) | Read-only current-branch history search and exact same-project evidence references |
| `update-skills/` | Skill inventory and owner-native updates |
| [`usage/`](usage/README.md) | `/usage [week\|month]`: local token usage and catalog cost comparison |
| [`view/`](view/README.md) | Open a path in a configurable GUI editor; defaults to Zed |
| `web-search/` | Native Anthropic/OpenAI public search |
| [`herdr-session/`](herdr-session/README.md) | hc-backed independent Pi tabs, parent-owned research terminals, and session-bound report transport |
| `subagent/` | Parent-owned background workers and selected MCP capabilities |

See [Herdr sessions](herdr-session/README.md) and [subagents](subagent/README.md)
for delegation, lifecycle, and permission boundaries.

Run `npm test` from the repository root.
