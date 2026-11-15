# Herdr sessions

Start independently navigable Pi sessions in Herdr, optionally with
session-bound asynchronous reports and follow-up guidance. This extension owns
launching and report transport, not a particular analysis workflow or provider
policy. It never reads a named skill's guidance file.

Requires `hc` (herdr-core) and an interactive Pi TUI with a live
`HC_TERMINAL_ID`. The caller terminal is validated before launching. Public tool
and command names stay unchanged; the launch/control backend is core-only, with
no legacy `herdr` worker-control fallback. Pi publishes native OSC status.
Every interactive Pi session with `HC_TERMINAL_ID`, whether started manually or
as a managed child, publishes `pi.session-id` and `pi.session-cwd` terminal labels
at session start, including replacement after `/move` or `/resume`. Both labels
refer to the current Pi session; the cwd is not the shell or terminal launch cwd.
Consumers should use these labels only while the terminal actively reports Pi,
not after it returns to a shell. Publication is independent of research mailbox
restoration and does not change research ownership.
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

## Reboot restore (opt-in)

On macOS, the extension privately records the last Pi session in each local,
kept Herdr pane. To reopen it after a **host reboot**, add this as the **last
line of `~/.zshrc`** yourself (adjust the path if `PI_CODING_AGENT_DIR` differs):

```zsh
[[ -r ~/.pi/agent/extensions/herdr-session/restore.zsh ]] && source ~/.pi/agent/extensions/herdr-session/restore.zsh
```

Setup does not edit your shell files or enable the hook. Node must be on the
login shell's PATH. The root recovery shell runs Pi as its own foreground child,
with terminal redirects that bypass Powerlevel10k instant-prompt redirection.
Nothing is typed into the pane; no Herdr UI is driven.

The exact absolute session file and its cwd are recorded at each session start,
including repeated `/move`s. Normal quit disarms restore. Same-boot restarts,
nested shells, hidden research workers, non-kept terminals, and a second shell
startup in the same boot do not restore. The helper consumes the record before
launching, and checks the session header's ID/cwd, executable and prompt files.
A bad or unsupported target leaves a working shell with a one-line notice and,
when possible, a manual `pi --session` hint. No newest-file or ID search is used.

CLI policy:
- Replay `--offline`, `--models`, `--tui-mode`, and explicit `--system-prompt` /
  `--append-system-prompt`. Explicit prompt sources are resolved just as Pi
  resolves them at **each runtime start**: read an existing file (strip BOM),
  otherwise use literal source text. Relative paths follow the process launch
  directory, not the moved session cwd. The resolved text is copied privately;
  deleting the source afterwards does not affect that capture until a reload or
  session replacement. Deleting it before `/move` or `/reload` changes live Pi
  and the snapshot to literal path text. Absent flags leave discovery dynamic.
- Do not replay the original task, model/provider/thinking, name, verbose,
  `--use-theme`, session-selection flags, or one-shot/non-TUI flags. Pi restores
  session model/thinking natively.
- Reject API-key, session-directory/no-session, tool-selection, extension, MCP,
  skill, template, theme-resource, context-file and project-trust overrides, and
  unknown flags. Only unsupported **flag names**, never their values, are saved.

State lives under `~/.local/state/pi-setup/herdr-sessions/<coreId>/`: private
0700 directories, 0600 atomic record/prompt files, validated as user-owned regular
files (no symlinks). Records contain session association, boot/core identity,
Pi invocation and the supported replay flags—not transcripts, credentials,
task text, environment dumps or timestamps. Explicit prompt text is sensitive
and remains only in private prompt copies. An absent prompt flag removes its
old copy. Records are retained as history; they are not pruned.

Read-only inspection (never launches or consumes; never prints prompt text):

```sh
node ~/.pi/agent/extensions/herdr-session/restore.mjs status
```

Limitations: a manual SIGTERM/SIGHUP to Pi while its shell survives can cause a
restore at the next reboot. A new session with no messages has no saved file yet
and produces a notice rather than a fresh session. There is no same-boot,
core-wipe, Linux or remote recovery. Real reboot timing and Powerlevel10k rendering
still require a separately authorized manual reboot check; local tests do not
prove those integration boundaries. Existing sessions need an explicitly
authorized reload to start recording; this change does not reload them.

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
