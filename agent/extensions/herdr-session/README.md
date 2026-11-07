# Herdr sessions

Start independently navigable Pi sessions in Herdr, optionally with
session-bound asynchronous reports and follow-up guidance. This extension owns
launching and report transport, not a particular analysis workflow or provider
policy. It never reads a named skill's guidance file.

Requires `hc` (herdr-core) and an interactive Pi TUI with a live
`HC_TERMINAL_ID`. The caller terminal is validated before launching. Public tool
and command names stay unchanged; the launch/control backend is core-only, with
no legacy `herdr` worker-control fallback. Pi publishes native OSC status; managed
children also publish their current Pi session identity as a terminal label.
Do not copy a tool-generated Pi integration into this project.

## Tools

| Tool | Behavior |
| --- | --- |
| `herdr_new_session` | Start an independent, kept terminal in a visible app tab; optionally supply a handoff and persistent guidance file |
| `herdr_research_start` | Start 1–4 guided read-only child terminals with asynchronous reports |
| `herdr_research_report` | Submit a report from a registered worker |
| `herdr_research_guide` | Queue follow-up guidance for a worker owned by this session |

The existing research tool names and stored run/session bindings are retained.
The research skill uses these hc-backed tools with file-only reports and queued
follow-up guidance. They also support separately configured local read-only workflows.

`/herdr [workspace] [--cwd path] [--model provider/model] [--label text]
[--handoff file] [--append-system-prompt file]` starts an independent session.

`/herdr-id` shows and copies the current `HC_TERMINAL_ID`, with an `hc send`
example. It warns when no ID is available; if copying fails, the ID remains
visible. It does not launch a session or call `hc`.

## Terminal lifecycle and placement

- Independent sessions (`herdr_new_session`, `/herdr`, and the handoff skill)
  start fresh Pi sessions in their own named app tabs, preserving caller focus.
  They have no hc parent and use `keep: true`. The `workspace` parameter is a
  compatibility alias for an existing space's exact ID or unique local name;
  it defaults to the caller's space.
- Research workers are hc children of the caller terminal, with `keep: false`
  and the default end-with-parent lifetime. They survive app closure and
  extension reload while the parent terminal remains alive. They do not create
  named app tabs. An explicit research `workspace` may select only the parent's
  own space, never a cross-space worker tab.
- Launch results identify `backend: "hc"`, `terminalId`, `sessionId`,
  `sessionPath`, `name`, `label`, `cwd`, `model`, `launchState`, and `deliveryState`.
  Independent sessions include `workspaceId`, `tabId`, and `paneId`; research
  results need not have app-placement IDs.

## Guidance, models and launch acknowledgement

- `handoff` and `appendSystemPrompt` accept non-empty files, resolved against
  the caller's cwd, not the destination directory. They have different authority:
  `handoff` delivers a task brief as user instructions; `appendSystemPrompt` adds
  session-wide system instructions that later user messages cannot override.
  Keep temporary task/phase choices in the brief, with their scope and end condition.
  Reloading or changing tasks does not remove appended system instructions.
  Independent handoffs do not automatically inherit the parent's appended guidance.
- Independent sessions use Pi defaults when no model is supplied. Reporting
  workers inherit the parent model when omitted.
- Explicit models must be available physical models. No virtual routing or
  silent model/provider substitution.
- Appended guidance and worker task/reporting boundaries survive compaction.
- Launches reuse the current Pi executable: absolute Node/Bun plus CLI script,
  or the compiled Pi executable, before falling back to `pi` on PATH. This avoids
  depending on the Herdr service's PATH for an installed CLI.
- Each launch uses a fresh session file seeded through Pi's public session SDK,
  so its exact session ID and path are known before Pi starts. A handoff is
  accepted only when its initial prompt is recorded in that intended session.
  Acceptance is not task completion. No session is relaunched and no prompt is
  resent during confirmation. Partial failures retain known terminal, session,
  and app-placement identifiers; inspect those sessions before retrying rather
  than blindly creating duplicates.
- Creating a session is not permission to access data or change external systems.

## Reporting

`herdr_research_start` accepts `tasks`, optional `model`,
`appendSystemPrompt`, `workspace`, `cwd`, and `reportDirectory`.

Without `reportDirectory`, workers submit Markdown findings to the run's private
report folder. With it, the directory must already exist; relative paths resolve
against the caller's cwd. Reports must be existing files inside that directory,
including after canonical path resolution. Inline findings, outside paths and
symlink escapes are rejected. Summary text is replaced with
`Shareable report: <path>`; the parent notification contains the path, not file
contents.

This validates transport, **not sanitization**. The calling workflow owns
reviewing report contents and deciding what may be shared. A directory setting
does not authorize access to sensitive data. Default research stays within code,
verified non-sensitive lower environments, and public sources; operational or
patient-bearing datasets, sensitive production copies, and unknown data
provenance require a separately authorized workflow. Available tools do not
expand those permissions.

Reports and guidance use session-bound local mailboxes, not `hc send`. Busy
sessions receive queued follow-ups without terminal input. Reload restores runs
from the active branch, avoids duplicate delivered reports, and does not grant
ownership to forks or new sessions. Saved reports from old runs remain readable,
but legacy worker control is not supported. Independent handoffs do not register
reporting or inherit worker mailbox bindings.

New worker sessions persist their mailbox identity and reserve their exact
session binding before terminal launch. After inspecting a failed launch and
confirming whether a terminal exists, resuming that exact `sessionPath` restores
report submission even without `HERDR_RESEARCH_*` environment variables. Preserve
its model and appended guidance when recovering; this does not automatically
relaunch, resend a task, or reassign parent follow-up control to another terminal.
Forks and unrelated sessions cannot claim the binding. Older worker sessions
without persisted identity still require their original worker environment;
appended instructions alone do not register a worker.

## Local workflow composition

Keep specialized policy and guidance outside the foundation. A local skill can
prepare files and call these tools, or a local extension can perform executable
preparation and call them through `ctx.executeTool()`:

```ts
const outcome = await ctx.executeTool("herdr_new_session", {
  handoff: briefPath,
  model: selectedPhysicalModel,
});
return { ...outcome.result, isError: outcome.isError };
```

Only add `appendSystemPrompt` when the supplied rules should remain binding for
that session's lifetime. Do not promote a whole task brief or historical execution
choices into system instructions merely to preserve them across compaction.

For explicitly requested reporting, call `herdr_research_start` with the task,
persistent guidance and a dedicated `reportDirectory`. Keep independent handoff
as a local workflow's default unless the user requests reporting. A specialized
launcher is a local addition, not registered by this extension.

## Checks

From the repository root, run `npm test`.
The retained suite covers actual Pi loading, skill expansion and synthetic
compaction with a fake hc CLI and synthetic model responses. The
[standalone live smoke test](tests/README.md) is separate and opt-in: it creates
one real interactive child, may incur provider charges, and retains its tab.
