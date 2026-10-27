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
| `todo/` | Durable local work context; optional user-configured Linear integration |
| `update-skills/` | Skill inventory and owner-native updates |
| [`view/`](view/README.md) | Open a path in a configurable GUI editor; defaults to Zed |
| `web-search/` | Native Anthropic/OpenAI public search |
| `herdr-session/` | Independent guided sessions and session-bound report transport |
| `subagent/` | Parent-owned background workers and selected MCP capabilities |
| `lib/models.ts` | Shared physical-model availability check; not an extension entry point |

Run all retained suites from the repository root with `npm test`.
The loader check also covers entry points without a dedicated suite.

Herdr sessions and subagents share physical-model validation, not workflow
policy. Local analysis guidance and MCP protections remain external additions.
See their READMEs for composition and permission boundaries. Do not copy a
tool-managed Herdr integration into this directory.

Source is not automatically installed or linked from this checkout.
