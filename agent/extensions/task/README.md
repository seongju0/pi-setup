# task

Personal Pi extension. Run `/reload` after installation, then `/task` to open the keyboard-driven task panel. A compact task summary stays above the editor.

The `task` tool supports:

```ts
{ action: "create", subject: "Fix authentication", description: "Acceptance criteria…" }
{ action: "list" }
{ action: "get", id: "1" }
{ action: "update", id: "1", status: "in_progress" }
{ action: "update", id: "2", dependsOn: ["1"] }
```

Statuses: `pending`, `in_progress`, `completed`, `failed`, `cancelled`.
Only completed dependencies unblock a task. Setting `dependsOn` replaces the complete dependency list; `[]` clears it. Missing references, self-dependencies, and cycles are rejected. Tasks cannot start or complete while blocked.

## Storage

`<agent-dir>/tasks/sessions/<session-id>.json`, normally `~/.pi/agent/tasks/sessions/<session-id>.json`.

```json
{ "version": 1, "nextId": 1, "tasks": [] }
```

- Resume/reload restores the session's tasks; `/new` and `/fork` start empty.
- `/tree` does not rewind task state. Task files are independent of conversation history.
- `--no-session` uses memory only. Read-only operations do not create a task file.
- Writes use private temporary files and atomic replacement. Invalid files are reported, never silently reset.
- One Pi writer per session is supported. The write queue is process-local, not a cross-process lock.
- Completed/cancelled tasks remain available in `/task`, collapsed in the widget. No automatic deletion or execution.
- At a normal user-run boundary, `before_agent_start` supplies a hidden, persisted `task-context-v1` snapshot of up to 10 nonterminal task summaries. It is emitted only when the visible summary changed or compaction omitted the last snapshot. No context hook appends a temporary per-request tail. Tool results supersede older snapshots within a run; `task list` returns current state. When the last active task finishes, one `No active tasks remain` snapshot clears the prior summary. Older snapshots remain in history until ordinary Pi compaction; task records are not deleted. Reload/tree navigation reuse a matching snapshot rather than moving or replacing earlier messages.

No pi-durable, worker execution, project sharing, legacy migration, or runtime dependencies beyond Pi's supplied packages.

## Check

```sh
# From the repository root (isolated temporary agent/home):
npm test
```

Checks use disposable storage and Pi's actual extension loader, with no model calls. Lifecycle checks cover deduplicated persisted snapshots, no per-request injection, compaction refresh and terminal-task clearing. The todo extension's suite also loads both real extensions together and checks serialized Anthropic prefix stability across task changes, queued todo notes and reopen.
