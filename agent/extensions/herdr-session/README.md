# Herdr sessions

Start independently navigable Pi sessions in Herdr, optionally with
session-bound asynchronous reports and follow-up guidance. This extension owns
launching and report transport, not a particular analysis workflow or provider
policy. It never reads a named skill's guidance file.

Requires the Herdr CLI and an interactive Pi session inside Herdr for reporting.
Herdr owns its generated Pi state integration; do not copy that generated file
into this project.

## Tools

| Tool | Behavior |
| --- | --- |
| `herdr_new_session` | Start an independent session; optionally supply a handoff and persistent guidance file |
| `herdr_research_start` | Start 1–4 guided read-only workers with asynchronous reports |
| `herdr_research_report` | Submit a report from a registered worker |
| `herdr_research_guide` | Queue follow-up guidance for a worker owned by this session |

The existing research tool names and stored run/session bindings are retained.
The research skill uses subagents; these Herdr tools also support separately
configured local read-only workflows.

`/herdr [workspace] [--cwd path] [--model provider/model] [--label text]
[--handoff file] [--append-system-prompt file]` starts an independent session.

## Guidance, models and launch acknowledgement

- `handoff` and `appendSystemPrompt` accept non-empty files, resolved against
  the caller's cwd, not the destination directory.
- Independent sessions use Pi defaults when no model is supplied. Reporting
  workers inherit the parent model when omitted.
- Explicit models must be available physical models. No virtual routing or
  silent model/provider substitution.
- Appended guidance and worker task/reporting boundaries survive compaction.
- A handoff succeeds only after its initial prompt is found in the intended
  session. Confirmation uses the created pane ID, not the generated agent name,
  which may be unavailable after a startup readiness timeout. Agent-not-found
  responses during detection are retried within the existing 15-second
  confirmation window; the exact session ID and initial prompt must still match.
  No agent is relaunched and no prompt is resent during confirmation.
  Partial failures retain existing tab/pane/agent identifiers; inspect those
  sessions before retrying, rather than blindly creating duplicates.
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
does not authorize access to sensitive data.

Reports and guidance use session-bound local mailboxes. Busy sessions receive
follow-ups without terminal input. Reload restores runs from the active branch,
avoids duplicate delivered reports, and does not grant ownership to forks or new
sessions. Independent handoffs do not register reporting or inherit worker
mailbox bindings.

## Local workflow composition

Keep specialized policy and guidance outside the foundation. A local skill can
prepare files and call these tools, or a local extension can perform executable
preparation and call them through `ctx.executeTool()`:

```ts
const outcome = await ctx.executeTool("herdr_new_session", {
  handoff: briefPath,
  appendSystemPrompt: guidancePath,
  model: selectedPhysicalModel,
});
return { ...outcome.result, isError: outcome.isError };
```

For explicitly requested reporting, call `herdr_research_start` with the task,
persistent guidance and a dedicated `reportDirectory`. Keep independent handoff
as a local workflow's default unless the user requests reporting. A specialized
launcher is a local addition, not registered by this extension.

## Checks

From the repository root, run `npm test`.
The retained suite covers actual Pi loading, skill expansion and synthetic
compaction with a fake Herdr CLI and synthetic model responses. Live Herdr
checks are separate, opt-in, and may create real sessions.
