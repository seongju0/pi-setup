# Background subagents

**Delegate a small job, keep working, and get the answer back automatically.** Each worker is a headless Pi process with its own saved conversation.

Use subagents for parent-owned coding, review, and research. Each assignment should state its scope, permissions, evidence paths, and stop condition. There is no durable executor here.

## Architecture at a glance

```text
Main Pi session
  │
  ├── subagent tool: spawn / send / stop / status
  │         │
  │         ▼
  │   Manager (index.ts)
  │     ├── validates models and owns child/run state
  │     ├── persists metadata and guards parent ownership
  │     └── ChildRpc (rpc.ts) ── JSONL over stdin/stdout ──► Pi child
  │                                                        ├── model + tools
  │         ◄────────────── responses / events ─────────────└── saved conversation
  │
  ├── above-composer widget ◄── child state + native context estimates
  └── automatic follow-up   ◄── final answer + diagnostic + artifact paths
```

**The child does the work; the manager handles reporting.** The child gets the assignment and its own history—not the parent's transcript. Include the context and permission boundaries it needs.

## Quick start

Pi discovers `extensions/subagent/index.ts`. Run `/reload` after installing or changing the extension.

Ask the parent to delegate, or use the tool directly:

```json
{
  "action": "spawn",
  "name": "auth-reader",
  "model": "openai/gpt-6.1-sol",
  "message": "Read the authentication flow without changing files. Return relevant paths, the request lifecycle, and unresolved questions."
}
```

**Accepted is not completed.** `spawn` returns a child ID and run ID once the child accepts the prompt. Its terminal result arrives later as a parent follow-up. Successful `spawn` and `send` receipts include `nextAction` guidance alongside the existing metadata.

### Parent and child operating contract

```text
Delegate → continue independent work OR yield → automatic report → integrate result
```

- **Parent:** after acceptance, continue independent work. If the next step depends on the child and no independent work remains, end the current response with a brief pending update. Accepted workers keep running, and reports automatically resume you. Do not claim the overall task is complete while required results are pending.
- **Child:** complete only the focused assignment and required checks, then return a final answer immediately. If blocked, return the blocker and partial findings rather than waiting indefinitely. No separate notification or parent acknowledgement is needed.
- **Manager:** detect settlement, save the result, and deliver the terminal report to the owning parent. A busy parent's report queues until it yields; an idle parent resumes automatically.

**Do not sleep, repeatedly query `status`, ping children, or watch output files to discover completion.** Requested artifacts are deliverables, not completion signals: a file may exist before the child's checks and final response are complete. Use `status` for explicit inspection or recovery, such as inspecting a retained result after a report was cleared—not routine waiting.

Example: delegate a read-only review, then perform an independent check. If that check finishes first, respond, “The review is still running; I'll integrate its findings when it reports.” End the response rather than opening a sleep or polling loop. When the automatic report arrives, inspect its evidence and finish the user's task.

**Ending a response is not ending the runtime.** Quitting, reloading, or navigating away closes workers. Background execution also does not isolate shared files; assign disjoint edits to parent and child.

| Action | What happens |
|---|---|
| `spawn` | Create a named conversation and start its first assignment |
| `send` | Continue an idle conversation; reopen its process if closed |
| `stop` | Abort current work, if any, and release the process |
| `status` | Inspect one child or all children without starting work |

```json
{ "action": "send", "name": "auth-reader", "message": "Now identify where the access token is refreshed. Do not change files." }
{ "action": "stop", "name": "auth-reader" }
{ "action": "status", "name": "auth-reader" }
{ "action": "status" }
```

Use `id` instead of `name` when convenient. Names are unique within the owning session/branch. Busy `send` calls are rejected, not queued.

### Spawn inputs

| Input | Meaning |
|---|---|
| `name` | Required unique name; up to 64 characters |
| `message` | Required self-contained assignment; up to 30,000 characters |
| `model` | Optional exact physical `provider/model`; otherwise use normal inheritance |
| `cwd` | Optional working directory, resolved from the parent's cwd |
| `instructions` | Optional additional system-instruction **text**, not a path; up to 30,000 characters |
| `web` | Optional boolean, default true; load the local `web-search` extension; false explicitly opts out |
| `mcpServers` | Optional configured server-name allowlist, default none; only selected enabled servers connect |

`model`, `cwd`, `instructions`, `web`, and `mcpServers` are **spawn-only**. A later `send` preserves them; create a new child to change them. Unknown or disabled MCP servers fail before launch, never fall back to all servers. Selection applies to tools and resources without modifying global/project MCP configuration. Normal MCP credentials are reused, not copied into assignments. MCP access is not read-only permission or an OS sandbox.

### Skill-based assignments

Put the assignment, supported flow, settled decisions, exclusions, accepted trade-offs, permissions, deliverable paths and stop condition in `message`. Put applicable working rules and quality gates in `instructions`.

For a skill-based task, read the current `SKILL.md` and include its actual contents in `instructions`, identifying its absolute source path and directory so the child can resolve relative references. A path alone does not load the file. Include only skills relevant to the child's stage; keep lengthy supporting references in files and require relevant reads. Do not promote untrusted reports or external content into system instructions.

If the skill contents exceed 30,000 characters, split genuinely separable work or explicitly require a full-file read and disclose that fallback. Never silently truncate or claim full injection. If no skill applies, concise working rules or no `instructions` are appropriate.

Guidance does not broaden the assignment's permissions. The parent verifies returned work against the assignment and applicable skill; injection supplies guidance, not proof of compliance. These field-specific rules belong to the subagent tool; Herdr research/analysis uses its own launch mechanisms.

### Research reports

Assign distinct report paths to research workers and retain child-ID/report-path references. Reports survive worker completion and stopped conversations can reopen with `send`; `/tmp/` is not permanent archival storage. Completion comes from automatic terminal reports, not watching files.

## A conversation is not a process

A **child** is a saved conversation and configuration. A **process** is its currently open CLI. A **run** is one assignment in that conversation.

```text
spawn ──► starting ──► running ──► idle
                         ▲          │
                         └── send ──┘

running or idle ── stop ──► closed ── send ──► starting ──► running
                              │
                              └── history and configuration remain saved
```

This is the normal path. Startup/process failures can leave a child `failed`; assignment outcomes are recorded separately as `completed`, `failed`, `cancelled`, `timed_out`, or `interrupted`. The widget shows `stopping` while cleanup is in progress.

**Reopening resumes history, not execution.** Sending a new prompt to a closed child loads its saved conversation and starts only the new assignment. It does not replay the stopped one.

| Limit | Consequence |
|---|---|
| Four open processes | Idle children count too; stop one to free a slot |
| One assignment per child | Wait for completion or stop before sending again |
| 30 seconds per RPC command | Missing responses fail rather than waiting forever |
| No hard assignment deadline | Work continues until settlement, failure, explicit stop, or parent runtime shutdown |

Parallel launches reserve slots before asynchronous setup, so simultaneous calls cannot bypass the process limit.

## How an assignment moves through the code

### 1. Start or reopen

```text
spawn [tool action]
  requireLaunchModel()          validate and resolve the model
  reserve child + save instructions
  launch()
    ChildRpc                   start the headless Pi CLI
    get_state                  verify exact child session and physical model
  submit()
    prompt                     send the assignment
    return accepted + runId    parent can continue working

send [tool action]
  reject if busy
  launch() only if closed
  submit() using the saved conversation and configuration
```

Model selection uses this precedence:

```text
spawn.model → --subagent-model → parent's model at spawn time
```

For a GPT default:

```sh
pi --subagent-model openai/gpt-6.1-sol
```

The shared [`lib/models.ts`](../lib/models.ts) validator rejects unavailable models and virtual routers **without substitution**. Inheriting the parent's model also inherits its thinking level; other explicit models use Pi's configured thinking default, clamped to their capabilities. No workflow aliases or forced thinking level are used.

Existing children keep their resolved physical model if the parent or profile mapping changes. Providers defined only by another parent extension are not copied into children. Examples here use GPT; the extension itself does not enforce a GPT-only policy.

### 2. Finish and report

```text
child message_end
  collect final assistant text and reported usage

child agent_settled             after retries/compaction recovery
  settle() → finish()
    save <run-id>.md
    persist outcome
    sendMessage(subagent-report, followUp, triggerTurn)

parent records the report
  mark delivery = delivered
```

Completion waits for **`agent_settled`**, not `agent_end`. An idle parent reacts to the follow-up; a busy parent finishes its current turn first.

| Parent receives | Stays in child artifacts |
|---|---|
| Final answer, capped at 8,000 characters | Full final answer |
| Outcome and bounded diagnostic | Saved run details and reported usage |
| Child/run identity, model, result/transcript paths | Tool traces and native conversation history |

Delivery is tracked separately from execution: `pending` → `queued` → `delivered`. Undelivered results can remain `retained`. If a queued report is cleared, its result stays available through `status`; it is not automatically reinjected.

**Reports are delegated evidence, not new user instructions or authorization.** Reported token/cost totals are separate from the parent's footer usage.

## What you see in the widget

The widget appears above the composer only when the current session has children:

```text
Tasks · 2/3 complete
▶ #3 Integrate review findings

Subagents · 1 active
  ⠹ auth-reader · gpt-6.1-sol · ~$0.024 · running
  ✓ reviewer · claude-sonnet-5-5 · ~$0.011 · completed
```

- **Compact rows:** name, resolved physical model without its provider prefix, estimated session cost, and active state or terminal assignment outcome. Full model identity, process state, native context usage, and full history remain available through `status`.
- **Session cost:** `sessionCost` comes from Pi's native session statistics, covering the child's saved conversation across `send` and process reopening—not just the latest assignment. `~$0.024` is an estimate, not an invoice; positive amounts below $0.001 display as `~$<0.001`. Unknown pricing or older unsampled records display `~$?`, not a false zero. Zero is shown only when pricing is configured. Estimates update with the existing event-driven statistics reads and may lag during a streaming response; closed children retain their last sample.
- **Selection:** active workers first, then most recently finished assignments (completion time, falling back to start time). Show at most five entries; older children remain saved but are omitted without an overflow row.
- **Bounded layout:** one header, up to five single-line rows, and a blank line above and below: at most eight lines. Names truncate first while reserving room for model, cost, and status; at narrower widths the name is omitted and the model truncates, then cost is omitted if it cannot fit. Status takes priority. Width handling is Unicode-safe and rows never wrap. No fixed-height padding or embedded scrolling.
- **Activity:** The header is static with no indicator. Pi's built-in loader animates only active-row markers while starting, running, or stopping. It indicates an active assignment, not measured progress. Animation only requests local redraws and stops when inactive or when the widget is replaced/cleared.
- **Telemetry:** startup, completed messages/turns, compaction, and settlement trigger coalesced native statistics reads for context and cumulative cost. Compaction invalidates the old estimate; telemetry failures do not fail the assignment. Rendering, animation, and keystrokes make no RPC or model calls.
- **Isolation:** only the `subagent` widget key is touched. Tasks, Todo, footer, and composer are unchanged. RPC exposes metadata through status without terminal rendering or animation.

Closed/restored children retain their last recorded native context sample; older records may have no estimate. No process is launched just to reconstruct historical context.

## Ownership and recovery

```text
Parent turn aborted     → accepted workers keep running
Explicit stop           → child process closes; conversation remains
Quit / reload / navigate→ workers close; unfinished runs are interrupted
Restore saved metadata  → children appear closed; nothing auto-restarts
Explicit send           → reopen one saved conversation
```

Session/branch ownership and a runtime generation guard reject stale callbacks, so late events cannot report into another conversation. Restore reads only the active branch and current parent's records. Forks do not inherit worker ownership.

Background execution requires an **interactive or long-lived RPC parent**. Print/JSON parents exit too early and reject execution; `status` can still inspect restored metadata.

## Capabilities and safety boundaries

**These are workers, not sandboxes.** They inherit OS permissions and normal credential discovery. `bash` can read/write files and launch processes; stopping cannot undo edits or external effects.

| Child capability | Policy |
|---|---|
| Built-in tools | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `codemode` |
| Extensions | Discovered/configured extensions disabled; `builtin:codemode`, local web search (default on), and optional selected-server MCP integration loaded explicitly |
| MCP | None by default; `mcpServers` selects configured enabled servers before connections are created, including resources |
| Delegation | No subagent/Herdr launchers; `PI_SUBAGENT=1` also prevents this extension registering |
| Project trust | Same cwd inherits approval only if the parent trusts it; alternate cwd uses `--no-approve` and ignores trust-gated resources |
| Unexpected dialogs | Cancelled, never auto-approved |

Workers receive normal Pi instructions and skills/context permitted by project trust. They do **not** inherit arbitrary extensions or the parent's runtime integrations. Public `web_search` is enabled by default, follows the child's provider family, and reuses its normal Pi authentication. Set `web: false` only to opt out. Search does not fetch arbitrary pages. MCP selection does not inherit arbitrary parent permission extensions or enforce read-only operations.

### Optional personal MCP policy

To apply a local permission extension to MCP-enabled children, set `subagents.mcpPolicy` in **`getAgentDir()/settings.json`** (normally `~/.pi/agent/settings.json`):

```json
{ "subagents": { "mcpPolicy": "extensions/my-mcp-policy.ts" } }
```

The path can be relative to the agent directory, absolute, or start with `~/`. The module must default-export a single Pi extension factory receiving `ExtensionAPI`; async factories are awaited. Register permission hooks such as `pi.on("tool_call", ...)` there. Only trusted personal code should be configured: the factory has the same OS permissions as Pi.

The setting is read afresh whenever an MCP child process launches or reopens, not from cwd/project settings and not from model/tool arguments. No setting means generic selected-server MCP operation without an extra policy. A non-string or empty setting fails an MCP launch. Missing, unloadable, non-factory, or throwing policy modules prevent the child MCP integration from initializing; they never silently fall back to unprotected MCP. The policy factory runs before the MCP factory in the same child extension wrapper.

Policy paths are local runtime details in the child's generated `mcp.ts`, not persisted snapshot fields. Changing personal policy affects the next process launch/reopen, not an already-running child. Children without MCP do not load or validate this setting.

The recursion guard blocks ordinary tool delegation, not malicious shell execution. Delegate only authorized access and mutations. For concurrent edits, assign disjoint files or supply separate worktrees yourself.

## Files and persisted evidence

```text
extensions/subagent/
├── index.ts             tool + manager + reporting + persistence + widget
├── rpc.ts               subprocess + JSONL transport + command correlation
├── mcp.ts               selected-server config + child MCP integration
└── tests/
    ├── fake-pi.mjs      deterministic child CLI fixture
    ├── test.mjs         regression suite; no provider calls
    └── smoke.mjs        opt-in real CLI/provider check

~/.pi/agent/subagents/<parent-session-id>/<child-id>/
├── instructions.md      child identity and supplied instructions
├── <Pi session file>    saved native conversation
└── <run-id>.md          full final answer/diagnostic and reported usage
```

`subagent-state` custom entries store compact child metadata **outside model context**. `status` exposes the latest run, delivery state, model, native context estimate, and evidence paths. Earlier run artifacts remain in the child directory.

The artifact root follows `PI_CODING_AGENT_DIR` via `getAgentDir()`. Directories use `0700`; extension-written instructions/results use `0600`. Treat artifacts and native transcripts as sensitive. There is **no automatic retention cleanup**.

### Why a small local RPC transport?

Pi's exported `RpcClient` informed the design, but its current public API lacks process-exit notifications and dialog responses, and launches through `node` with a CLI path. `ChildRpc` supplies those required hooks without accessing private client fields.

`rpc.ts` handles LF-only JSONL framing, correlated commands, bounded diagnostics, process death, dialog denial, and cleanup. On POSIX, cleanup also kills the child's process group; Windows uses child-process signals.

## Checks

```sh
# Deterministic regression suite; no provider calls.
node agent/extensions/subagent/tests/test.mjs

# LIVE: uses existing credentials and incurs provider usage.
node agent/extensions/subagent/tests/smoke.mjs openai/gpt-6.1-sol
```

The regression suite uses the real Pi extension loader and real subprocesses with a fake CLI, without user configuration. It covers:

- Physical/inherited model selection, context reuse, concurrency limits, and busy-send rejection.
- Web-extension loading and capability persistence; selected MCP connections, tools and resources, unknown/disabled server rejection, optional personal policy blocking, project-policy exclusion, and configured-policy failure before connection.
- Reports/receipts and parent/child operating guidance, artifacts before settlement, retries, failures, explicit cancellation without assignment deadlines, dialogs, and transport framing.
- Reload/fork/tree ownership, restore, cleanup, and headless behavior.
- Compact widget bounds and recency ordering, animation/disposal, Tasks isolation, themes, narrow/Unicode layout, native versus billed context, and compaction/unknown telemetry.

The live smoke runs two bounded research assignments using the real model/CLI: default-enabled native `web_search`, `/tmp/` report writing, automatic reporting, and reopening the stopped child for a follow-up that preserves prior evidence. It verifies a successful direct `web_search` result with IANA source metadata in the actual child transcript, provider-family inheritance, and no shell fallback. It stops the child and removes test artifacts. **Its parent runtime is mocked**; it is not a real TUI test.

## Deliberately not built

No durable replay or crash-proof exactly-once delivery; no queued assignments, steering, role catalogs, DAGs/chains, interim reporting tools, automatic worktrees/merging, cross-session supervision, or dashboards.

## References and design provenance

Primary references reviewed against installed Pi **1.1.0** and upstream commit [`c5f5b328`](https://github.com/earendil-works/pi/tree/c5f5b3282d5e4203c085e59837ba17aeaf2829b5):

1. [Durable background subagent example](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/durable/test/examples/23-subagent-background.ts): independent conversations, background ownership, parent follow-up reports, and deduplication. This extension borrows the behavioral shape, **not** the durable runtime/checkpoints/replay.
2. [CLI reference](https://pi.dev/docs/latest/cli) and [CLI integration](https://pi.dev/docs/latest/cli-integration): model/session/resource flags; one-shot JSON versus long-lived RPC.
3. [RPC protocol](https://pi.dev/docs/latest/rpc), [commands](https://pi.dev/docs/latest/rpc-commands), and [extension UI](https://pi.dev/docs/latest/rpc-extension-ui): acceptance versus completion, cancellation, state verification, LF framing, and dialog responses.
4. [JSON event stream](https://pi.dev/docs/latest/json): authoritative `message_end` messages and final `agent_settled` completion.
5. [Extension API](https://pi.dev/docs/latest/extensions): custom tools, `sendMessage` follow-up delivery, session-scoped state, and shutdown contracts.
6. [Upstream subagent extension](https://github.com/earendil-works/pi/tree/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/examples/extensions/subagent): separate CLI processes, model inheritance, subprocess invocation, and output/error handling. Its synchronous one-shot/chain modes are not copied.
7. [RpcClient implementation](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/modes/rpc/rpc-client.ts) and [client example](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/examples/rpc-client.ts): command correlation, event subscription before prompting, and client lifecycle.
8. [SDK](https://pi.dev/docs/latest/sdk): the in-process alternative; RPC was chosen to retain a CLI process boundary.
9. Local [`lib/models.ts`](../lib/models.ts): physical-model validation.
10. [Terminal UI](https://pi.dev/docs/latest/tui), [widget-placement example](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/examples/extensions/widget-placement.ts), and local [`task`](../task/index.ts): above-editor widget placement, theme-aware rendering, width-safe lines, and independent widget keys.

Live `latest` documentation can change. Recheck the installed CLI/API contracts when upgrading Pi.
