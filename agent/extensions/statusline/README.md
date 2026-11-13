# Statusline

A small standalone footer for **Pi 1.5.2**, using only the public
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` APIs. No
additional dependencies or persisted session state. Loader
preferences live in the adjacent editable `loader.json`.

On `session_start` in interactive TUI mode it installs the footer and a thin
native `CustomEditor` subclass with one blank row above and below the top border:

```text
worktree (branch*)      claude-sonnet-5-5 · high · ctx 43%/200k · cache 92%
  ──────────────────────────────────────────────────────────────────
on-call · … · ⚠ …
todo · in progress · brief ~3.2k (1.2%) · Title
~/Projects/worktree
```

- Left: working-directory basename (including a worktree's own name), native
  Pi Git branch, and `*` when the last successful Git status found tracked or
  untracked changes. No `*` means clean **or unknown**, not a clean guarantee.
- Right: selected model ID, native thinking level, and native context occupancy
  percentage/window capacity. Provider is omitted to keep the row compact.
  Unknown occupancy is `?`, never a fabricated zero. Context uses semantic
  `warning` at 70% and `error` at 90%; everything else is muted.
- Optional info rows, one per extension, separated from the main line by a thin, centered grey
  divider inset two columns on each side (`borderMuted` theme color): existing
  `setStatus()` values. The divider is omitted when there is no info. The
  `on-call-mode` status comes first so a long TODO does not hide its safety warning. Existing ANSI
  styling is retained for other extensions; the `todo` row uses the same muted
  theme as the main footer. Newlines, tabs and Unicode line separators become
  spaces. TODO supplies its own compact wording, for example
  `todo · in progress · brief ~3.2k (1.2%) · Title`; the percentage is the loaded
  brief's share of the model window, not overall session context occupancy.
- Bottom path row: the session's current `ctx.cwd`, below all extension info rows
  (or directly below the main row when no extensions publish status). The home
  directory is shortened to `~` only at a directory boundary. The muted path is
  read on every render, stripped of terminal controls and clipped to the pane's
  Unicode-aware width. No `pwd` shell command, polling or separate extension.
- `cache`: cached-read tokens / (uncached input + cached reads + cache writes)
  for the latest assistant/model call on the active session branch. Output tokens
  are excluded. A real zero is `0%`; missing/zero-total usage is `—`, without
  falling back to an older call. This is token reuse, not percentage cost savings.
  It updates when a completed call is recorded; branch-leaf caching avoids a
  session-history scan on every animation frame. No extra API request is made.
- Narrow terminals drop cache first, then thinking, then clip the model and secondary
  directory/branch fields. Context has highest priority. Extremely narrow
  terminals necessarily clip context too. All rows use real pi-tui ANSI/Unicode
  visible-width and truncation helpers.

The footer reads `ctx.model`, `pi.getThinkingLevel()`, and
`ctx.getContextUsage()` directly during rendering. It does not scrape widgets,
parse status text for numeric data, or alter existing task/subagent widgets.
There is no cost, quota, cumulative token accounting, clock, PR/CI,
or general configuration framework.

## Input spacing and loader

A blank row separates task/subagent widgets from the embedded loader/top border;
a second blank row separates that border from the input. Widget contents are unchanged.
The editor inherits native rendering, input, shortcuts and autocomplete, without
copying Pi's editor implementation or patching prototypes. Mouse rows are shifted
back by two before delegating to the native editor; cursor/IME markers remain in
the native input lines. Pi still supplies horizontal padding, completion settings,
app handlers and theme.

### Configurable loader

Edit `~/.pi/agent/extensions/statusline/loader.json`, then `/reload`.
With a managed pi-setup link this edits tracked checkout source; preserve or
commit your customizations before updating, since updates require a clean checkout.

Example configuration:

```json
{
  "spinner": "native",
  "intervalMs": 80,
  "messages": ["Thinking it through", "Hacking away", "Fixing"]
}
```

The default is `native`, using Pi's built-in animation, color and cadence, with
nine custom loading phrases in `loader.json`. Choose a `spinner`:

- `native`: delegates to Pi's own spinner without copying its frame definitions.
- `scan`: a dot sweeps back and forth across five cells (`●····` → `·●···` …).
- `stack`: a six-column bracket fills and empties (`[    ]` → `[=   ]` …).

`scan` and `stack` are independently generated in `spinners.ts`. Their motion is
decorative, not a measure of task progress. No borrowed spinner tables remain.

For your own animation, add a `frames` array such as `["·", "•", "●", "•"]`;
custom frames override `spinner`. `intervalMs` controls generated/custom
animations; `native` uses Pi's default timing instead.
One phrase is randomly chosen on `agent_start` and stays fixed throughout that
run, including its tools; a later run can randomly choose the same phrase again.
A one-item list gives fixed loading text. There is no timed word rotation.

The spinner name must be known, or custom frames supplied. Custom frames and
messages must be nonempty lists of nonblank, single-line strings
without control characters; `intervalMs` must be a positive integer within the
native timer range. Generated/custom frames use literal glyphs in the terminal's
default foreground; `native` retains Pi's own colors. Configuration is
read only at session start/reload, not on each frame or tool call. If the file is
missing/invalid, a warning is shown and the native loader is restored; fixing the
file and `/reload` enables customization again. The footer still works.

This uses public `ctx.ui.setWorkingIndicator` and `setWorkingMessage` only. Pi
owns the animation timer, interruption and cleanup. `agent_settled` restores the
normal working message. Native retry/compaction/summarization statuses retain
their own messages and lifecycle. No extra word timer, model call or replacement
loader renderer is involved. Loading phrases are decorative, not reports of tool
actions.

Use `/reload` to load config, footer or spacing edits; a full restart is not needed.

## Git lifecycle and limits

Dirty detection is asynchronous `pi.exec("git", …)` with no shell, optional
locks disabled, a 1.5-second timeout and a 64 KiB output bound. It uses only
`git status --porcelain=v1 --untracked-files=normal`; no diff or polling.
Pi's existing footer provider owns branch discovery/watchers.

Refresh happens on initial footer creation, native branch changes, completed
agent runs (`agent_settled`), and completed agent `bash` tools. Render never
starts a process. Refresh failures (including timeout/truncation) clear stale
dirty state; non-repositories are normal. Overlapping refreshes abort the old
request and ignore late results. Footer disposal/session shutdown aborts pending
work and unsubscribes from branch updates.

External edits and manual `!`/`!!` commands may remain unsampled until the next
refresh event; v1 deliberately does not wrap user shell execution or add file
watchers. The footer is advisory, not an authorization or data-safety gate.

## Checks

From the pi-setup repository root, run `npm test` for all foundation checks, or:

```sh
node agent/extensions/statusline/tests/test.mjs
```

Requires the installed Node runtime with native TypeScript stripping (tested on
Node 26.5.0) and Pi's installed pi-tui. The suite finds Pi under `npm root -g`,
or accepts `PI_TEST_PACKAGE_ROOT=/absolute/path/to/pi-coding-agent`.
It installs no dependencies and launches no interactive Pi session.

Seven compact native Node tests execute the real registered lifecycle/render
implementation, including the actual native editor class and fixture config files.
Only the host/UI/theme, Git execution and random choice boundaries are mocked;
width helpers are the actual installed pi-tui implementation. Coverage includes
interactive-only installation, live data, wide/narrow Unicode and ANSI,
unknown context, warning/error thresholds, on-call ordering, latest-call cache
semantics and narrow-width priority, native editor gap/cursor/mouse/shortcuts,
preset/custom loader selection, lifecycle/random choice/config-error fallback, Git success and
failure, non-repositories, out-of-order completion and disposal.

These are source-level regression checks, not a live terminal/theme or real Git
integration check. Settings changes, removal of other UI extensions and reload
are intentionally outside this extension's implementation/checks.
