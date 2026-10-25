# Todo

Durable work context for Pi, not autonomous goal execution. Reload Pi with `/reload` to load this directory's `index.ts`.

This README is the human-readable architecture/design reference. Use `/skill:walkthrough` for presentation: small inline diagrams beside the behavior they explain, shallow responsibility trees, and brief tables. Keep the reference here, not in a second competing architecture document. The skill is a presentation aid, not a runtime dependency.

**Start here:** [Commands](#commands) · [Architecture](#architecture) · [Design invariants](#design-invariants) · [Compaction](#compaction) · [Checks](#checks)

## Architecture

```text
You: /todo commands                  Agent / research / plan / design skills
         │                                          │
         │ dialogs + picker                          │ typed todo tools
         └───────────────────┬───────────────────────┘
                             ▼
                      index.ts — Pi adapter
                 commands · tools · lifecycle events
                             │
            ┌────────────────┼────────────────┬──────────────┐
            ▼                ▼                ▼              ▼
         state.ts        session.ts      artifacts.ts     linear.ts
         validated       selection &     documents &      existing Linear
         changes         resume bundle   catalog          MCP tools
                             │
                       compaction.ts
                    summary focus & pending
                    reconciliation receipts
            └────────────────┴────────────────┴──────────────┘
                             ▼
                         storage.ts
                cross-process lock · revision checks
                dependencies.ts — graph + readiness
                      atomic file replacement
                             ▼
                        ~/.pi/agent/todos/
                   JSON context + Markdown artifacts
```

**Pi owns the conversation; the extension owns durable work context.** Skills produce substantive work and documents. The extension supplies the shared persistence seam; it does not run or replace those skills.

### Pi integration points

| Pi feature | Responsibility |
| --- | --- |
| Directory extension loading | Loads `index.ts`; feature modules remain colocated. |
| `registerCommand` + completions | `/todo` interaction; `waitForIdle` prevents command mutations during agent streaming. |
| `registerTool` + TypeBox schemas | Validated inputs; `structuredContent` and an output schema expose results to codemode. |
| Sequential tool execution | Most state-changing tools serialize within a Pi batch; filesystem locking also protects against other Pi processes. |
| `select`, `input`, `editor`, `confirm`, `notify`, `custom` | Native dialogs and themed checklist picker; RPC falls back to selection dialogs. |
| `setStatus` | Displays selected item and local status. |
| `appendEntry` + `getBranch` | Persists attachment, acknowledgement, and compaction receipts; reconstructs active-branch selection. |
| `session_start`, `session_tree`, `session_shutdown` | Restores/clears session attachment without rewinding durable files. |
| `before_agent_start` | Resets turn acknowledgement. Pending compaction reconciliation remains until acknowledged. |
| `context` + `context.ts` | Replays one current brief and persisted notices at stable first-delivery anchors. Explicit resets discard obsolete todo injections and pre-reset Anthropic thinking. Watches selected/parent/prerequisite revisions; never replaces the system prompt. |
| Settlement | No automatic bookkeeping continuation or UI nag. Checkpoint criteria are soft guidance in the loaded brief. |
| Compaction lifecycle events | Preserve summary focus, record successful compaction, route pending reconciliation, clear temporary preparation on failure. |
| `estimateTokens` + model context window | Warns about large injected context using Pi's native estimate, without blocking updates. |
| `ctx.executeTool` | Calls connected Linear MCP tools through validation and permission hooks. |
| `sendMessage` / `sendUserMessage` | Context loads are recorded without starting a model run; explicit checkpoint/sync commands ask the agent to act. |

### Two persistence layers

```text
Pi's append-only session history           Durable todo directory
────────────────────────────────           ──────────────────────
attached todo ID ─────────────────────────► todo.json
acknowledgement receipt                     artifacts/*.md
compaction/reconciliation receipt           project-scoped todos/

fork / tree / reopen:                       remains current:
restore pointers from active branch         NEVER rewound with session history
```

Transient acknowledgement/refresh flags and known revisions live in memory. Pending compaction reconciliation also has a session receipt so reopening does not lose it. A scoped starting brief is recorded as one hidden `todo-context-v1` message at a loading boundary; it is not another editable source of truth. Later reads and tool results supersede that brief.

### Resume path

```text
/todo resume <selector>
  → resolve one item; reject ambiguity
  → validate scoped resume bundle
  → confirm switch if current bookkeeping is pending
  → persist attachment + show status
  → load parent/selected briefs, child summaries, and relevant artifact catalog
  → list required current artifacts (title, kind, description, size); bodies load on demand
  → record one starting-context message; stop without starting implementation

ordinary model requests
  → use existing conversation + read/checkpoint/artifact tool results
  → check selected/parent/transitive prerequisite revisions, not artifact bodies
  → if another writer changed state, add a small drift notice
  → do NOT regenerate the full brief

reopen / tree navigation
  → restore the persisted brief, notice anchors and reset boundary
  → legacy/unanchored sessions load once to establish the persisted-only anchor boundary

successful compaction / explicit refresh / switch
  → load scoped context once; replace obsolete todo injections
  → exclude pre-reset Anthropic thinking consistently on later requests
  → preserve new thinking after the boundary
```

Resolved questions and superseded decisions/documents stay out of normal orientation but remain available when litigating a decision. Ask the agent to present them conversationally or through `/skill:walkthrough`.

### Write path

```text
todo_checkpoint / todo_artifact
  → validate request; confirm consequential direction changes
  → acquire short cross-process write lock
  → read current manifest; reject stale revision
  → apply structured changes; start not-started items on saved activity; validate graph/completion prerequisites
  → atomically replace the item's todo.json, then start its not-started parent project
  → return downstream readiness + compact updated_parent receipt; release lock

artifact content update
  → write a new Markdown revision FIRST
  → publish its path in the manifest LAST
```

A failed manifest commit may leave an unreferenced artifact revision, but never replaces content referenced by the old manifest. Checkpoint retries use the last receipt; artifact retries require inspecting the manifest. Item and parent writes share the store lock but are not a multi-file transaction: an interruption between writes can leave the item saved and its parent status unchanged. Local files and Linear are not one distributed transaction.

## Design invariants

| Choice | Why / boundary |
| --- | --- |
| JSON context, Markdown artifacts | Machines manage compact operational state; humans review substantive documents. |
| Projects own outcomes | May span repositories/issues. Children are simple todos, not nested projects. |
| Multiple artifacts per item | Plan/design/research are categories, not singleton slots. Relevance and supersession are explicit. |
| Current snapshot, not session diary | Replace stale state/next actions. Long rationale belongs in artifacts; compact decisions retain references. |
| Draft is not approved | Saving a document does not authorize implementation. Changed outcomes/approved direction require sign-off. |
| Selection is not execution | No automatic goal pursuit, budget accounting, branch checkout, or worker launch. |
| Local memory is not live remote truth | Verify relevant Git/PR/Linear facts. Partial todo completion never closes its parent issue. |
| Deterministic mechanics, semantic agent judgment | Code enforces schema, relevance, revisions, locking, and placement. The agent decides which knowledge matters and whether evidence supports a claim. |
| No silent context loss | Active scoped context is retained regardless of size. History and explicitly consult-on-demand records remain retrievable; required artifacts cannot be hidden. Missing mandatory context and invalid state fail visibly; size warns without blocking repairs. |

## Commands

| Command | Action |
| --- | --- |
| `/todo` | Browse ongoing work; use the bottom **Completed** entry to revisit finished projects and standalone todos. Open a project to see its checklist. |
| `/todo new project` | Create and attach an outcome-oriented project. |
| `/todo new simple` | Create and attach a standalone item; optionally place it in the active project. |
| `/todo resume <ID, unique ID prefix, exact title, or full Linear URL>` | Attach existing work without starting implementation. |
| `/todo refresh` | Reload attached context once without starting work. |
| `/todo checkpoint` | Ask the agent to preserve only material discoveries/progress/artifacts, then stop. |
| `/todo tighten` | Ask the agent to review current progress and reduce active context reversibly, then stop. |
| `/todo leave` | Detach; warn if this turn has not been checkpointed/acknowledged. |
| `/todo status [todo\|in_progress\|done\|canceled]` | Change local progress, not Linear status. |
| `/todo sync` | Ask the agent for a read-only refresh of the linked Linear issue. |

Commands use Pi's built-in dialogs and a themed terminal picker. Selection does not change the working directory, checkout a branch, launch work, or resume an automatic work loop. Ask the agent what to do next, or use your existing research/analysis/design/build/walkthrough skills.

Creation does not automatically harvest the conversation. Ask the agent to adopt the relevant discoveries or skill outputs using checkpoint/artifact tools; it should select useful knowledge, not copy the transcript.

## Storage and organization

The terminal picker uses a rounded border, two-column inner padding, consistent section spacing, and a 110-column preferred width (clamped to the terminal). It hides internal UUIDs, shows human-readable status and project completion counts, and previews the highlighted item's latest saved status above its Goal. Status uses `current_state.summary`, with an explicit fallback when none is saved, and retains dependency/waiting context. It is saved task context, not a live production/Linear check. Checkpoint guidance asks for 1–3 short plain-English sentences with normal spacing: progress first, remaining work/next step second, retaining material uncertainty and authorization boundaries. IDs, counts and detailed receipts belong in evidence/artifacts; the picker renders saved text rather than generating or repairing prose. Status and Goal wrap to three and two lines respectively, with visible ellipses for overflow; the list page size leaves room for both sections on shorter terminals. The main root list contains ongoing projects and standalone todos, followed by a red **Completed** navigation entry with a blank line above it when completed root items exist. That entry opens completed projects and standalone todos; completed projects use the same checklist and **Resume project overview** action as ongoing projects. Project checklists include completed/canceled children. Enter opens a project or attaches an item using its latest saved context, without reopening terminal work. Escape steps back from a project to its originating list, from Completed to the main list, or closes the main picker. Completed work remains accessible even when there is no ongoing work. Browsing does not attach work or change progress. Checkboxes reflect local status (`[ ]` not started, `[~]` in progress, `[!]` waiting on prerequisites, `[✓]` done, `[-]` canceled); use `/todo status` to change it. RPC clients use ordinary hierarchical selection dialogs; direct ID/title/URL selectors and noninteractive listing still work.

Defaults to `~/.pi/agent/todos/`; `PI_TODO_PATH` overrides the root (relative overrides resolve at extension load). Private directories/files are created with modes 0700/0600. Existing directories are not chmodded. Nothing is automatically published, committed, or garbage-collected. Autonomous tightening changes orientation, not retention.

```text
<root>/<project-id>/
  todo.json
  artifacts/<artifact-id>-<revision>.md
  todos/<simple-id>/
    todo.json
    artifacts/<artifact-id>-<revision>.md
<root>/<standalone-simple-id>/
  todo.json
  artifacts/...
```

`todo.json` is the machine-owned source of truth: version, identity, outcome, local progress, current state/evidence, decisions/rationale/approval, questions/resolutions, depends_on IDs, next actions, references, artifact catalog, optional Linear snapshot, revision, optional context visibility policy, and last checkpoint receipt. No context.md or duplicated editable Markdown task list.

Projects contain simple todos only. Simple items can own any number of artifacts. Each artifact has a kind, description, lifecycle (`current`, `reference`, `superseded`), required flag, and `applies_to` direct-child IDs. Empty `applies_to` means owner-wide. An item-scoped artifact belongs on that item, not on its sibling. Dependencies connect simple peers in the same scope; no nested projects or execution scheduler.

Implementation is colocated by responsibility: `context.ts` (anchored provider projection and reset thinking), `state.ts` (schema/operations), `storage.ts` (persistence), `artifacts.ts`, `session.ts` (resume/selection), `compaction.ts`, `linear.ts`, `dependencies.ts` (graph validation/readiness), `picker.ts` (hierarchical checklist), `tightening.ts` (reversible orientation cleanup), and `index.ts` (Pi tools/commands).

## Dependencies

```text
Stored: status + depends_on IDs
            │
            ▼
dependencies.ts computes current transitive prerequisites
            │
            ├── dependencies_satisfied
            ├── waiting_on: ID / title / status
            ├── review_required
            └── downstream dependents

Upstream write ──► recompute affected descendants ──► return current states
                   NO dependent status writes or execution
```

Only simple peers in one project (or standalone simple peers) may depend on each other. Missing targets, duplicate IDs, self-edges, cross-scope edges, project edges, and cycles are rejected. Dependencies do not block starting or saving work. All transitive prerequisites must be `done` before setting or reasserting `done`. Dependency edits on a completed item must also leave its prerequisites satisfied; reopen it in the same checkpoint when revising unfinished prerequisites. Notes/artifacts remain editable during review; resume, reading and planning are always allowed. The picker shows dependency waiting/review labels only for not-started items; started items simply show `In progress`.

| Upstream change | Derived downstream behavior |
| --- | --- |
| Done | Recompute readiness; never automatically start anything. |
| Canceled | Unsatisfied prerequisite and review warning; no implicit waiver or cascade cancellation. |
| Reopened | Unsatisfied again; descendants retain their status. Completed descendants require review. |
| Explicit edge replacement/removal | Validate graph and recompute the downstream chain. |

There is no writable `blockers` field or `blocked` status. Waiting is computed from dependencies. Authorization/deployment requirements should be concrete prerequisite todos. Readiness only means recorded prerequisites are done, not permission to run production operations.

**Compatibility:** old manifests without `depends_on` read as `[]`. Legacy blocker text is preserved verbatim in unresolved questions with deterministic IDs. A legacy `blocked` status becomes `todo` plus an unresolved migration note; no start/completion is inferred. Read normalization does not rewrite files or advance revisions. The next successful write persists the normalized format. Review those questions and explicitly model or resolve constraints; no prerequisite items/edges/completions are invented. Large context remains intact rather than discarding legacy text or blocking updates. Reload other running Pi sessions before writing the new format: older extension versions reject its new fields.

## Agent/programmatic interfaces

All tools return structured data, usable through codemode. Read an item before mutating it: writes require its current revision.

- `todo`: `list`, `get`, `create`, `resume`, `refresh`, `leave`. `list` returns summaries plus dependencies/readiness; `get` includes historical decisions/questions/artifact metadata and current downstream effects. `create` accepts optional `depends_on` IDs. `create` does not attach; `resume` attaches and records a scoped context message, returning a compact receipt rather than duplicating the bundle in its tool result. `refresh` reloads the attachment without starting work.
- `todo_checkpoint`: `{id, revision, key, changes}`. Related changes commit together. Scalar/list context fields replace their field. Decisions/questions upsert by stable IDs; omit ID to create. Resolutions and supersession preserve old records. `changes: {}` is a valid no-change checkpoint.
- `todo_tighten`: `{id, revision, reason, consult_on_demand_decisions?, consult_on_demand_artifacts?, restore_decisions?, restore_artifacts?, retire_artifacts?, current_state?, next_actions?, references?}`. Hide lists add to the saved visibility policy and restore lists remove from it, so partial calls never unhide earlier items. No decisions or documents are deleted. Optional mutable-field replacements preserve previous values in an immutable reference artifact before the manifest is published. Required artifacts cannot be hidden; optional `retire_artifacts` demotes listed artifacts to `required:false, lifecycle:"reference"` (still readable) — use it when a slice/PR merges. Missing/duplicate IDs and stale revisions fail. The agent checks semantic relevance and retains active rules/permissions/constraints. Editing a hidden decision makes it visible again; updating an artifact body or making it required also clears its explicit exclusion (lifecycle still controls reference visibility). Changes saved orientation for future loads and returns a compact receipt with `context_refreshed:false`. It does not reload the attached brief or compact the conversation. After an uncertain response, read the manifest before retrying.
- `todo_ack`: `{id, reason: "no_change" | "needs_approval", explanation}`. Acknowledges only the attached item. `needs_approval` also preserves the pending question in durable context; it does not change established decisions.
- `todo_artifact`: `read` by item/artifact ID, or `upsert` with current item revision and complete catalog metadata. Include body to create/update Markdown; omit body for metadata-only updates to an existing artifact. Several current plans/designs/research docs can coexist. Mark an old document superseded explicitly; artifacts do not become approved just because they exist. Reference/superseded artifact metadata is consult-on-demand through get, not part of normal orientation.
- `todo_linear`: `{id, revision, target_status?}`. Omit target for a read-only snapshot refresh.

Example checkpoint:

```js
const item = await tools.todo({action: "get", selector: "<todo-id>"});
await tools.todo_checkpoint({
  id: item.todo.id,
  revision: item.todo.revision,
  key: "dry-run-verified-1", // Reuse only for the identical retry payload.
  changes: {
    current_state: {summary: "Dry run verified; no production writes yet", evidence: ["<report URL/path>"]},
    next_actions: ["Request approval for the first cohort"]
  }
});
```

Example prerequisite update:

```js
const item = await tools.todo({action: "get", selector: "<dependent-id>"});
const result = await tools.todo_checkpoint({
  id: item.todo.id, revision: item.todo.revision, key: "set-prerequisites-1",
  changes: {depends_on: ["<prerequisite-id>"]} // Complete replacement; [] clears.
});
text(result.dependency);
text(result.affected_dependents);
```

Native callers use `create`, `checkpoint`, and `mutate` in `storage.ts`; graph/completion checks run under the same write lock regardless of caller. These operations return the located item plus `dependency` and `affected_dependents`. Activity writes also return a compact `updated_parent` receipt when they start the parent, so the session observes that revision without reloading its brief. Derived dependency fields are never persisted; an automatic parent status change advances the parent's revision too. Generic `mutate` calls do not start work unless the activity flag is supplied; artifact upserts supply it, while Linear refresh and tightening do not.

Checkpoint idempotency covers the most recent successful checkpoint: an identical retry returns its receipt, even with the old revision. A changed payload/owner using that key fails. Its computed dependency/effect fields are current read projections, not replayable transition events. Earlier replay attempts fail revision checking rather than overwriting newer state. Artifact updates are revision-guarded, not independently retry-keyed: read the manifest after an uncertain response before retrying.

## Resume and checkpoint behavior

The session history stores attachment/bookkeeping receipts, context-load messages, and `todo-context-anchor-v1` metadata. Those historical briefs are not canonical copies of the todo. Reopening/fork/tree navigation reconstructs selection, reconciliation and the existing anchored provider projection without replacing the brief. Sessions saved before persisted-only anchors (`anchor_version:2`) establish a fresh boundary once, including older anchors that may refer to a temporary message from another extension. Canonical files never rewind with session history. New blank sessions attach nothing.

**Full context loads only at reset boundaries:** attach/create/switch, successful compaction, explicit `/todo refresh` or tool refresh, legacy session restoration without persisted-only anchors, and repair of a missing anchor. Checkpoints, tightening and status changes do not reload it; command status changes send a short persisted notice. A load contains selected/parent briefs, compact child summaries, relevant artifact pointers, and an index of required current artifacts (title, kind, description, character count). Like skills, the agent reads only the bodies relevant to the session focus via `todo_artifact` read; missing required files still fail visibly. Resolved questions, superseded decisions, reference/superseded artifacts, and explicitly consult-on-demand decisions/artifacts stay out; they remain available via get/read. This is reversible filtering, not deletion. An agent may use tightening on parent context too, but must keep project-wide authorization and safety boundaries visible. Obsolete load messages are filtered from provider context, although the append-only session history preserves them.

**Automatic progress:** a nonempty context checkpoint or artifact upsert moves its owner from `todo` to `in_progress` and starts its parent project if the parent is also `todo`. This applies to the item being written, regardless of whether the session attached that child or its project overview. Writing project context never starts its children. Explicit status choices take precedence; `done`/`canceled` items and parents are not automatically reopened. A status-only `in_progress`/`done` checkpoint also starts a not-started parent; a status-only reset/cancellation does not. Empty checkpoints, approval-evidence-only receipts, reads, resume, no-change acknowledgments, tightening and Linear refresh do not start work. An acknowledgment that saves a new approval question is a context write, not permission to execute. Existing stale statuses are not backfilled until a qualifying write occurs.

During uninterrupted work, the main agent reads relevant material and writes meaningful updates through structured tools. Their results are already in the conversation, so local reads/checkpoints/artifact/Linear results update known revisions without regenerating the full brief. Read-only conversations with no durable change need no bookkeeping call. When explicitly reconciling compaction, switching/detaching, or answering `/todo checkpoint`, use `todo_ack` with `no_change` instead of an empty checkpoint receipt.

Each request checks selected/parent and transitive prerequisite manifests for revision drift; the watch set adapts when edges change. An external change produces one small notice per observed revision combination—not another full snapshot. Read updated items or refresh before relying on old facts. Non-prerequisite sibling changes/new children are discovered via list or explicit refresh; this is not a whole-project filesystem watcher. Direct manual edits without revision advancement are not detected by this check. Delivered drift notices remain at their original positions after reads/acknowledgment; a reset removes obsolete notices.

The recorded starting brief still consumes ordinary conversation context when sent to a provider. The saving is avoiding repeated regeneration, artifact reads, and appended copies—not making previously loaded text free. No background worker, periodic cleanup, or extra model calls for snapshot generation. The foreground agent judges relevance; code validates and persists explicit visibility choices.

There are no fixed character ceilings for orientation or required artifacts. Orientation above 18000 characters, a full bundle above 40000 characters, injected context above an estimated 10% of the model window, or Pi's `ctx.getContextUsage().percent >= 70` produces a nonblocking tightening nudge. Unknown usage is not guessed. Warnings deduplicate by load/model window/high-usage state. Each delivered warning is persisted and retains its original position until a reset, even after usage falls. No automatic cleanup turns are started. The agent considers `todo_tighten` (retiring merged-work artifacts, hiding replaced decisions) when a slice/PR merges or at a natural stopping point when material progress makes earlier context redundant, not just because it is old or large. Pi's usage is an estimate, not a provider tokenizer or a guarantee the request fits. Tightening changes durable orientation for future loads, not the current brief or conversation. Explicit refresh replaces the brief; ordinary tool-result history still takes space until Pi compaction. Required material cannot be hidden and missing required material still fails visibly.

Checkpointing is autonomous bookkeeping, not a confirmation dialog or per-turn ritual. Preserve information only if omission would make a fresh session decide materially wrong, repeat significant work, or cross an authorization boundary. Save verified material progress/completion with evidence, active constraints/prerequisites, consequential direction choices and delivery-affecting unresolved questions. Approval of a minor tweak alone is not a decision. Replace current state/actions; update one current specification for names, constants and presentation refinements rather than adding a record for every iteration. Batch related material findings; ordinary tool calls, repeated test runs and pure discussion do not justify standalone checkpoints. No settlement hook requests another model turn or nags the UI. Old forced-reminder messages are filtered from provider context. Explicit `/todo checkpoint` still asks the model to act. Successful write/edit/bash operations and scoped artifact updates conservatively mark bookkeeping pending for switch/detach and compaction safety; this is not proof of new knowledge and never forces a follow-up. Crash capture is not guaranteed; checkpoint consequential progress during work.

Changed outcomes and updates/supersession of approved decisions require interactive confirmation unless `changes.approval_evidence` quotes explicit user approval already given in the conversation for these exact changes. The agent must not infer approval from historical task data, unrelated permission, or saving itself. The quote is saved in affected decision evidence and, for changed outcomes, current-state evidence. This avoids a second confirmation for recording an actual approval; it is not a new authorization mechanism. Draft decisions, factual progress and reversible tightening can be saved automatically. Long rationale belongs in artifacts; compact decisions carry the pointer. `needs_approval` preserves an unresolved approval question, records a session acknowledgement, and surfaces it to the user; it does not approve or silently apply the proposed change.

## Cache stability and reset boundaries

```text
ordinary work: brief → warning → assistant → tool result → assistant
                       ↑ stays here on replay, even if Pi queued persistence

explicit reset: old todo injections out → current brief in
                pre-reset Anthropic thinking out; new thinking stays
```

Pi queues `sendMessage(..., {triggerTurn:false})` while streaming. A message first supplied by the context hook can be persisted after the response that saw it. Merely persisting a warning is therefore insufficient: `context.ts` replays each note at its first-delivery anchor. Anchor receipts identify a preceding **persisted** transcript message by role, timestamp and response/tool-call IDs; they do not copy tool output or infer order from elapsed time. Candidates must match saved message entries (or persisted compaction/branch summaries), never temporary messages supplied by other context hooks. Reopening restores these receipts. Pre-version-2 epochs migrate through one deliberate reset. A missing anchor also establishes a fresh persisted-only epoch, retaining canonical todo data and consistently retiring pre-reset Anthropic thinking; it does not guess a nearby timestamp or re-anchor the same notice on every request. Other context-load errors still abort visibly. The task extension now supplies deduplicated persisted before-agent snapshots rather than a moving task-list tail.

A reset retains one current brief (or a short detached-state note), removes superseded todo injections, and consistently excludes pre-boundary `anthropic-messages` thinking from provider input. This is necessary because the installed Anthropic adapter otherwise replays signed thinking bound to the old prefix. New thinking after the boundary is preserved. Raw transcript entries, answers, tool calls/results and durable todo data are not deleted. A reset can rebuild the prompt cache once; subsequent requests must keep the new prefix stable. This does not prevent unrelated cache expiry, model changes or edits by other extensions.

**Memory is not a transcript.** Todo tools explicitly save high-signal state, decisions, constraints, evidence and artifacts. They do not automatically harvest tool calls/results. Those outputs remain in Pi's conversation history, not the durable todo store. No new checkpoint frequency, scheduler or automatic model turns are introduced.

## Compaction

Compaction shortens model history, not durable todo files or Pi's full branch ancestry. Saved context loads again on the next request, independently of the summary.

```text
Conversation ──────► Pi's default compactor ───► Shortened conversation
                             ▲                          │
                             │ preservation focus        ▼
                     active ID + revision         next model request
                     pending bookkeeping flag           ▲
                                                        │ fresh context hook
~/.pi/agent/todos/ ──────────────────────────────────────┘
                   untouched durable state
```

### Before / after / failure

```text
session_before_compact
  → capture active ID, saved revision, and bookkeeping-pending flag
  → append preservation focus to prepared summary messages
  → include it in both history and turn-prefix inputs for split turns
  → let Pi summarize normally; preserve user custom instructions

session_compact (success)
  → append a todo-compaction-v1 session receipt
  → mark scoped context for one boundary reload on the next request
  → carry pending reconciliation into that brief
  → do NOT start a model request from this event

next normal request / existing automatic recovery
  → compare summary/retained messages against fresh durable state
  → checkpoint supported unsaved facts, or acknowledge no_change/needs_approval
  → clear pending reconciliation and persist acknowledgement

session_compact_failed
  → discard temporary preparation
  → do not publish success or clear older pending reconciliation
```

Manual `/compact` waits for the next user request. Threshold compaction and overflow recovery use Pi's existing continuation/retry behavior. Compaction never starts an extra bookkeeping turn; pending reconciliation is a nudge in the next normally loaded brief. Pending reconciliation survives reopening and clears after a successful checkpoint or acknowledgement.

**Why prepared messages?** Pi permits cancellation or a replacement compaction result, but not returned `customInstructions`. We append a synthetic user note to the mutable preparation arrays consumed by its default summarizer. No second summarizer, changed cut point, replacement system prompt, or extra summarization calls. Another extension supplying its own summary may ignore these inputs; the successful-compaction receipt and fresh reconciliation guidance still apply.

**Guarantee:** attachment and saved state survive; a scoped brief reloads once after successful compaction, and pending bookkeeping is routed back to the agent. The retained brief is never truncated for size; summary text is never automatically promoted to an approved decision.

**Limit:** the summarizer can still omit unsaved facts. The pending flag means this work run has not acknowledged bookkeeping, not that code knows which discoveries remain unsaved. Immediate checkpoints are the primary protection. Missing evidence becomes an open question, not an invented fact.

Required artifacts load as an index, not bodies, so the fixed payload stays small. Retire designs and verification for merged work with `todo_tighten retire_artifacts`. We never silently truncate or demote required artifacts.

## Linear

Use full issue URLs, not bare ticket identifiers, for stored references. Link through checkpoint changes with `{linear: {url, coverage: "whole" | "partial"}}`. The MCP tools must be connected and callable from extension tools.

Local progress and issue status are intentionally separate. Several todos may reference the same issue; finishing one never finishes the issue. On attachment the agent is instructed to refresh linked issue state before relying on it. Commands themselves do not make model/remote calls except explicit checkpoint/sync requests. If refresh is unavailable, the previous snapshot remains timestamped and must be described as stale.

Whole-issue status writes require an exact team status, interactive confirmation, and a fresh remote/local drift check. Partial items cannot write the issue status through this extension. No ticket creation, description mirroring, background polling, credentials, or automatic bidirectional synchronization. The check before saving is not a server-side compare-and-swap; Linear can still change immediately afterward. A failed local save after a remote write reports the partial success; refresh instead of blindly repeating the write.

## Safety and recovery

- A cross-process global write lock rejects concurrent mutations; read again/retry on busy or stale revisions. No long-lived session claims.
- Atomic JSON replacement prevents partial manifests. Artifact content revisions are written first: interruption may leave unreferenced files, but not overwrite referenced content.
- Interrupted creates remain as `<id>.creating` directories, ignored until manually inspected/removed.
- Symlinks inside the store and traversal paths are rejected. The root itself may be symlinked and is canonicalized. This is not a sandbox against another malicious local process racing filesystem operations.
- Malformed state is reported and never silently reset. Missing required context aborts the model request; detach with `/todo leave` or repair the item from a blank session. Oversized context warns without blocking the request or omitting saved data.
- After a crash, inspect `<root>/.write-lock/owner.json` and verify the owner is no longer writing before manually removing the lock. Locks are never stolen on a timer.
- No permanent data/artifact deletion or background cleanup. Agent-guided tightening is reversible and preserves replaced mutable context in reference artifacts. Back up the private store yourself if desired.
- Reload all running Pi sessions before using tightening: older versions reject the optional `context_policy` field. New code reads old manifests without rewriting them.

## Checks

```sh
# From the repository root (isolated temporary agent/home):
npm test
```

Uses temporary storage and Pi's actual extension loader/argument validator. Covers schema and stale writes, retry receipts, activity-driven item/parent progress (including unfinished dependencies, artifact-first updates, terminal/explicit status preservation, no-op reads/checkpoints, and no incidental context reload or drift), completed-picker project/child/standalone context loads and back navigation without status/revision writes (including completed-only stores), project containment, artifact scoping and revisions, cross-process locks, traversal/symlinks, session restoration and nonforcing checkpoint guidance, approval/UI, corruption/overflow, and mocked Linear read/write/drift. Boundary-load checks cover reuse without artifact rereads, explicit refresh, external drift notice deduplication, local updates without reload, detachment, and renewed bookkeeping after writes. Compaction checks cover manual/threshold/overflow events, split-turn inputs, success/failure/abort, restored reconciliation, no bookkeeping continuations, and nonblocking character/model-window nudges, deduplication and detach cleanup. Pi's actual SessionManager verifies selection survives compaction even when model projection omits the attachment entry. Tightening checks cover preserved history, restoration, stale/invalid IDs, required-artifact guards, no incidental reloads and compact receipts. Approval checks cover cited existing approval and unchanged fail-closed behavior without it; usage checks cover below/at 70%, unknown usage and warning deduplication. Provider-facing lifecycle checks simulate queued message persistence and use the installed Anthropic serializer, stopping before HTTP. They verify stable content prefixes through warnings/drift acknowledgment, explicit refresh, detached state, reopen and successful/failed compaction; old thinking stays excluded while new thinking survives. Cross-extension checks load the actual task and todo extensions together, cover task snapshots and tool-time changes, reject transient anchor candidates, and verify one-time legacy/missing-anchor recovery without repeated reloads. No real Linear updates, paid model calls, or claims of testing live cache-hit rates or a provider's summarization quality.
