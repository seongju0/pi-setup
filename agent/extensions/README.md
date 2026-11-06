# Foundation extensions

Each feature has an `index.ts` entry point. Tests and support files remain
beside their implementation. Pi supplies the host modules; no compilation or
vendored Pi runtime is needed.

| Source | Purpose |
| --- | --- |
| `continue/` | Idle-only continue shortcut |
| `move/` | Move a session using Pi's session APIs |
| `no-sleep/` | macOS sleep prevention using caffeinate |
| `task/` | Session-local task tracking |
| `todo/` | Durable local work context, paged artifacts and curated knowledge search; optional user-configured Linear integration |
| [`session-history/`](session-history/README.md) | Read-only current-branch history search and exact same-project evidence references |
| `update-skills/` | Skill inventory and owner-native updates |
| [`usage/`](usage/README.md) | `/usage [week\|month]`: local token usage and catalog cost comparison |
| [`view/`](view/README.md) | Open a path in a configurable GUI editor; defaults to Zed |
| `web-search/` | Native Anthropic/OpenAI public search |
| [`herdr-session/`](herdr-session/README.md) | hc-backed independent Pi tabs, parent-owned research terminals, and session-bound report transport |
| `subagent/` | Parent-owned background workers and selected MCP capabilities |
| `lib/models.ts` | Shared physical-model availability check; not an extension entry point |

Run all retained suites from the repository root with `npm test`.
The loader check also covers entry points without a dedicated suite.

Herdr sessions and subagents share physical-model validation, not workflow
policy. Local analysis guidance and MCP protections remain external additions.
See their READMEs for composition and permission boundaries. The Herdr tools
retain their public names but require `hc` and an interactive Pi TUI with a live
`HC_TERMINAL_ID`; they do not use the legacy worker-control backend. The research
skill uses these hc-backed workers and their session-bound report mailboxes.
The RPC subagent extension remains available for other workflows. Do not copy a
tool-managed Herdr integration into this directory.

Source is not automatically installed or linked from this checkout.
