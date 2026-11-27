# Session tasks

Standalone session-local task board for Pi (`task` tool and `/task` TUI panel), decoupled from Context. Requires sibling `extensions/lib/status-style.ts`. No external tools, attached project, or Context database are required; preserve existing task records when updating source.

The `task` tool supports:

```ts
{ action: "create", subject: "Fix authentication", description: "Acceptance criteria…" }
{ action: "list" }
{ action: "get", id: "1" }
{ action: "update", id: "1", status: "in_progress" }
{ action: "update", id: "2", dependsOn: ["1"] }
```

Codemode returns `{ tasks, storage }`. Create, get and update return the affected task in `tasks[0]`; list returns all tasks. There is no root `result.id`. Native text displays the single affected task for create/get/update, not the codemode envelope. Get and update require an explicit `id`.

Statuses: `pending`, `in_progress`, `completed`, `failed`, `cancelled`. Only completed dependencies unblock a task. Setting `dependsOn` replaces the complete dependency list; `[]` clears it. Missing references, self-dependencies, and cycles are rejected. Tasks cannot start or complete while blocked.

## Storage

`<agent-dir>/tasks/sessions/<session-id>.json`, normally `~/.pi/agent/tasks/sessions/<session-id>.json`.

- Resume/reload restores the session's tasks; `/new` and `/fork` start empty.
- `/tree` does not rewind task state.
- `--no-session` uses memory only. Read-only operations do not create a task file.
- Writes use private temporary files and atomic replacement. Invalid files are reported, never silently reset.

## Check

```sh
npm test
# or directly:
node agent/extensions/task/tests/test.mjs
```
