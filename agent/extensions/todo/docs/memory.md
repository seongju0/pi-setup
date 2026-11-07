# Memory contract, formatting and rationale

Todo preserves the minimum sufficient grounding for a fresh or parallel session to understand the goal, the current understanding, why it holds, and what remains uncertain. It also restores that grounding after compaction. It is not a transcript, execution planner, test archive or autonomous scheduler.

The [README](../README.md) owns implementation architecture and API reference. This document defines information ownership, writing conventions and design trade-offs. It is repository documentation, not another saved project memory or always-injected prompt.

## Task entry and workflow ownership

Durable memory belongs to an enduring task/outcome, not to a session, worktree or stage. The global `agent/AGENTS.md` contract establishes the owner before substantial work: use the relevant attachment, or resolve a supplied TODO ID/linked issue URL or search recognizable goals, inspect candidates and resume a clear existing match. `get` alone does not attach. Ask on ambiguity or before switching owners; creation still requires explicit user intent. Trivial questions need no record. An explicit opt-out is respected; unavailable/declined tracking requires a disclosed fallback, not a silent parallel memory system.

Creation-permission requests follow the global standalone **Decision required** Yes/No prompt and waiting rule; an already explicit request/approval needs no repeated confirmation. This is agent guidance, not a new runtime dialog or automatic tool-level approval gate.

Owner resolution and durable curation belong to standalone sessions, orchestrating parents and receiving independent sessions. Parent-owned workers use the supplied owner and relevant context; they do not independently discover/attach an owner, create records or checkpoint shared memory unless assigned. They may read relevant material using available tools. The parent supplies sufficient bounded context when a worker lacks TODO access, without maintaining a second authoritative copy.

The tool's `status` action exposes the attachment as selected summary metadata or null without changing selection, durable files, loaded context or acknowledgement. Inspect at entry/recovery when needed, not on every turn. It reads the current saved revision, not a guarantee that the loaded brief is current. The extension does not choose an owner from cwd or classify user requests automatically.

| Owner | Responsibility |
| --- | --- |
| Originating/current parent | Resolve the durable owner; curate consequential understanding and reusable bodies within the work turn. |
| TODO | Current task grounding and relevant research/design catalog; no execution authority. |
| Handoff | Launch an independent workstream with resolved TODO/artifact IDs and a bounded current assignment; not parent-owned subagent delegation or a project-memory substitute. |
| Receiving independent session | Resume that owner, read relevant bodies, reconcile live state and act only within current permission. |
| Delivery | Orchestrate implementation/review/verification, using task memory even when no TODO ID was explicitly supplied to the skill. |
| Parent-owned subagent | Consume supplied ownership/context and return its complete result; the parent integrates consequential findings, rather than every worker establishing or checkpointing shared memory. |

A temporary launch envelope may live in `/tmp`, and execution reports remain with their native workflow. Neither replaces durable understanding. If future work needs a research/design body that exists only in a temporary file, save the body through `todo_artifact`; a reference cannot preserve a deleted target. A stable existing authoritative document can remain a reference when the concise finding plus that reference is sufficient. Do not copy every worker report or raw log into artifacts. Once TODO owns a design, update that owning artifact rather than maintaining a competing current copy.

Presentation and preservation are independent decisions. A specification may be presented inline and still need its essential body preserved; writing a file does not by itself earn durable memory. Workflow skills specify required outputs and their substantive quality, while the global contract owns saving criteria and TODO owns persistence/retrieval. They ship together in pi-setup but do not require extension-driven orchestration or a particular stage sequence. Explicitly declined/unavailable tracking keeps a disclosed fallback.

For parent-owned subagents, the launcher's saved full final result is the default stage report; its path arrives after settlement, not from the worker before it exists. Read the full result when the delivered summary is insufficient. Request a separate file only for substantive supporting detail or a workflow requirement, such as research's registered file-report transport or QA-native evidence. These execution reports are evidence, not automatically TODO artifacts or new authority.

These are task-entry and semantic-saving rules, not forced per-turn checkpoints, automatic transcript harvesting, migrations or a new storage layer. Existing selection, approval, revision/concurrency, privacy and bounded-retrieval rules remain unchanged. Saved understanding is not guaranteed complete or proof of current external state.

## One home per responsibility

| Information | Home |
| --- | --- |
| Concise goal and scope: what this work owns and excludes | `outcome`, displayed as **Goal and scope** |
| Lifecycle | `status` |
| Actual prerequisites | `depends_on`; readiness is computed, not authored |
| Consequential findings, qualifications and useful supporting pointers | `current_state.evidence` |
| Governing choices and their decisive reasons | `decisions`, including approval state and necessary evidence |
| Delivery-affecting uncertainty | `open_questions`; resolve only with supporting evidence |
| Routes to authoritative material | `references` |
| Substantial understanding that needs its own body | A `research` artifact |
| Substantial implementation contract or plan | A `design` artifact |
| QA, review and execution detail | QA Toolkit or the workflow's native report |
| Current execution assignment and scoped user permission | The conversation, not durable instructions |

There is no authored progress summary or next-action list to maintain. The picker displays structured status, dependencies and project completion counts, not `current_state.summary`. Incomplete todos, relevant designs and unresolved questions let a session propose the next step; they do not authorize it. Project completion remains explicit, not inferred from the child count.

Do not replace the retired fields with a new `context.md`, "Latest status" artifact section or generated-and-saved next-step summary.

### Parent versus child

A parent owns the shared goal/scope, common constraints, consequential cross-child findings/decisions and routing to deliverable owners. A child owns its deliverable's detail. Keep execution progress in the actual status/child records, not a manually synchronized parent paragraph.

Parent records are inherited broadly; artifact `applies_to` scopes documents, not parent decisions/evidence/references. Promote knowledge only when it genuinely governs other children. Parallel sessions must use current revisions and read changed active state before relying on an old brief. Selection, satisfied dependencies and historical approval never authorize new execution.

## What earns durable memory

Save information when omitting it would make a fresh session decide materially wrong, repeat significant investigation or cross an authorization boundary. A substantial completion can establish a lasting fact or limitation; record that implication, not a delivery diary.

| Keep | Leave with its native owner |
| --- | --- |
| Consequential choice, decisive reason and a rejected alternative when it prevents rediscovery | Every proposal, small approval or wording iteration |
| Verified finding or domain nuance that changes future work | Raw output, commands and investigation logs |
| Meaningful outcome with its limitations | Per-test pass counts, reruns, screenshots and publication receipts |
| Scope-changing uncertainty or unresolved constraint | Stage transitions and stale execution instructions |
| Concise pointer to decisive evidence | Copies of QA runs, review reports or external records |

A merge is not deployment; a local test is not production evidence. Preserve uncertainty, attribution, negation, partial external effects and the actual approval scope. For example, an external operation succeeding before a local timeout is useful retry knowledge; a log of each rerun is not.

## Only two authored artifact kinds

An artifact must pass a stronger test than "this output fits a category":

> Future work needs this substantive body, and a concise finding/decision plus a canonical reference is insufficient.

| Kind | Purpose | Suggested shape |
| --- | --- | --- |
| `research` | Mental model, consequential findings, explanation, hypotheses or facts needing further vetting | Model/findings → uncertainty and how to vet it → sources |
| `design` | The implementation specification or plan produced through the design workflow | Goal/scope → governing behavior/boundaries → approach → unresolved choices |

Use the stage skill's requirements when producing a design; detailed interfaces, implementation steps and acceptance checks still belong where needed for a build-ready specification. Omit empty sections and decorative boilerplate.

### Research

Distinguish verified fact from inference, hypothesis and unverified possibility. Keep the source and evidence qualification where they affect interpretation. A document worth revisiting should explain what needs vetting, not silently promote speculation to fact. Do not save each intermediate worker report as a research artifact.

### Design and scope

The todo's `outcome` owns concise goal/scope. The design elaborates the agreed contract; it does not maintain competing progress or scope summaries. Keep one authoritative current design per actual responsibility, not one document per iteration or one mandatory giant document per project. Update the existing artifact for refinements; body revisions remain immutable.

Separate `plan`, `scope`, `requirements` and `implementation_spec` kinds are unnecessary. A small boundary belongs in the outcome or a governing decision; substantial detail belongs in the owning design. `todo_checkpoint` already updates `outcome`; a separate goal/scope tool would duplicate that operation. Changes of scope still require approval, not merely a renamed field.

### No catch-all runbook or report category

General procedures belong in a skill, handbook or native tooling documentation. QA plans, fixture setup, runs and recordings belong in QA Toolkit. Delivery workflows retain reviews and publication reports. Reference their authoritative location; retain only consequential knowledge in todo. Saving a document, completing a stage or invoking a skill does not make its output durable memory.

New artifact upserts accept only `research` or `design`. Historical kind strings remain readable; that compatibility is not permission to keep authoring the retired categories. Migration requires reading content, not blindly relabeling it.

### Lifecycle and precedence

- **Current:** still describes or governs relevant work. Reusable research can remain current after implementation finishes.
- **Reference:** useful historical knowledge, retrieved when needed.
- **Superseded:** replaced; retained for provenance, not competing direction.
- **Required:** read when the focus touches its area, before acting. It neither preloads the body nor elevates task data into instructions.
- **`applies_to`:** direct children needing the document; empty means owner-wide.

Reconcile contradictory current claims with evidence before tightening. A later timestamp or delivered implementation does not supersede an approved policy. Completion is a relevance-review opportunity, not automatic retirement or proof that every open question is resolved.

## Formatting

### Structured items

- **Title:** name the durable, recognizable outcome with natural domain terms; make sibling items distinguishable without opening them.
- **Goal and scope:** what should become true, included responsibility and important exclusions. Include useful domain terms naturally, not keyword stuffing or a current progress report.
- **Finding/evidence:** one consequential fact or qualification with a useful source when needed. Not a list of activity receipts.
- **Decision:** choice and decisive reason; add a rejected alternative only when it prevents rediscovery.
- **Question:** the unresolved issue and why its answer matters. Do not encode a temporary assignment as a question.
- **References:** useful routes, not every source visited.

These are structured fields, not a template to repeat in a second Markdown description. Lists replace obsolete content rather than accumulating dated corrections.

### Titles and goals are the discovery surface

Work discovery (`todo search`) matches the current saved title and goal/scope only. It does not search obsolete wording, findings or artifact contents. The separate `todo_knowledge` tool searches curated findings, decisions, questions, references and currently cataloged artifact bodies; active visibility is the default, with full retained history available explicitly. Its excerpts and owner revisions are leads to read, not a new source of truth. It never searches old body revisions or attaches work. A completed item is searchable without turning its name into a historical closeout receipt.

Keep names recognizable through research, implementation, review and completion. For example, **Make effective-date reassignment release events external** remains useful; **Investigating → Building → PR merged → Done** does not. Lifecycle belongs in `status`, details in the design, and findings in evidence/decisions—not the title or outcome.

Update title/goal when the agreed responsibility changes or a clarification materially improves discoverability. Update them together where needed, but do not rename at every stage, add aliases or require a completion-time bookkeeping ritual. Preserve important exclusions and scope: changing `outcome` or an approved direction retains its existing sign-off requirement. A labeling clarification must not quietly expand authority.

Recall uses flat candidates with type, status, goal and parent ID/title (null for roots). Search includes current and historical statuses by default; list excludes done/canceled unless requested. Parent labels help distinguish similarly named items; they do not contribute words to child matching. Inspect ambiguous candidates, then explicitly `get` or `resume` the selected ID. Resume loads relevant parent grounding without reopening completed work or granting execution permission.

### Recoverable sources, not a receipt archive

Use `session_history` when the original journal evidence matters. Store its emitted `pi-history:v1/<encoded-session-id>/<encoded-entry-id>` reference in an existing evidence/reference string beside the concise finding and qualifications. No schema migration, automatic harvesting or per-tool bookkeeping is required. Default search stays on current ancestry (including pre-compaction entries); exact reference reads can resolve same-project session files. Other-project or deleted sources fail visibly rather than expanding scope.

Historical user text, assistant claims, tool evidence, coordination and derived summaries keep distinct provenance. Reading them does not revive approval or prove live state. Verify actual state before repeating consequential actions. Journal edits/compaction are not deletion; retrieved historical originals may differ from the current conversation projection. Retrieved text enters the selected model/provider context; thinking, system messages, hidden extension state and image bytes are excluded. The history tool does not guarantee recovery of overwritten TODO fields.

Artifact reads use bounded pages in both text and structured output. Follow `next_offset` with `expected_version` for the material needed; restart if the document changed. Required artifacts remain listed and validated during resume, not silently dropped to fit retrieval limits. Fixed page sizes are not a guarantee that a provider request fits. These retrieval tools do not change compaction, approve decisions or automatically update durable understanding.

### Clear to humans, compact internally

Internal findings and reasons may use concise fragments with consistent labels:

```text
Choice: reuse existing writer.
Why: already owns authorization and lifecycle effects.
Rejected: separate writer duplicates policy.
Unknown: downstream notification timing; unverified.
```

User-facing explanations stay natural and readable. Lead with the conclusion; use short headings, bullets or small diagrams when clearer. Preserve exact technical identifiers, attribution, uncertainty, negation and conditions. Do not concatenate words or invent opaque abbreviations. "Appears to be a timing issue" must not become "Timing issue."

## Maintenance without a second planning system

During meaningful updates, preserve new knowledge, replace obsolete findings, consolidate duplication and update the owning design/research document. Do not add periodic compression jobs, extra model calls, cleanup-only turns, hard semantic size caps or automatic hiding.

Visibility changes can be reversed with restore IDs. Replaced mutable text is not automatically archived: `todo_tighten` no longer creates `context-history` artifacts. Ordinary checkpoints were never a complete manifest event log either. The revision counter detects drift; it is not a recovery history. Immutable artifact body revisions remain, but that does not guarantee recovery of overwritten fields.

For an explicitly authorized migration, inspect retired summaries/actions/history for stranded knowledge before removal. Transfer meaningful facts, constraints and uncertainties to their proper homes; discard obsolete execution instructions. Do not mechanically create children or decisions from every action. A one-time private rollback copy outside the working store is not an artifact category or a new ongoing archive mechanism.

Delivery resolves the durable owner under the global task-memory entry policy even when no TODO ID was supplied. Use that owner and relevant specs/reports instead of another comprehensive handoff ledger; stage reports stay with the delivery workflow. A transient execution handoff may route revisions, worktrees, resource leases and reports without duplicating project understanding. Comprehensive file-based grounding is a fallback only when durable tracking is explicitly declined or unavailable; disclose that limitation and the file's persistence limits. A missing TODO parameter is not grounds for this fallback.

## Retention, injection and compaction

Active reads/resume omit resolved questions, superseded/hidden decisions, historical/hidden artifacts and retired summary/action fields. Full reads retain legacy fields until explicitly migrated. Preserve rationale, evidence and unresolved constraints rather than shortening them to counts.

Mutation text normally contains only success/revision and necessary generated IDs/effects; full `details`/`structuredContent` remain available. Writes do not regenerate the attached brief. Stable anchors preserve its provider position; refresh or successful compaction establishes a new boundary.

Before automatic compaction, a completed continuation-capable turn with known physical-model usage can request one bounded preservation response from the ordinary main agent. Live native settings determine an early heuristic window: `min(floor(0.90 * W), W - reserveTokens - min(16384, floor(W / 10)))`, below the native threshold. Disabled auto-compaction, unknown usage, virtual selections and aborted/error boundaries do not trigger it. The margin is not reserved capacity. See the [implementation contract](../README.md#early-preservation-best-effort).

The request asks for significant unsaved findings, decisions/reasons, pivots, implementation/completion evidence and honest verification limits, unresolved constraints and essential research/design bodies or stable references. Read needed material, save document updates, then checkpoint the selected owner; if current, explicitly acknowledge `no_change`. `needs_approval` records a question without granting authority. Only successful selected-owner checkpoints or explicit acknowledgements complete the pass, including nested codemode tools. Artifact-only updates, tightening, reads, assistant claims, failed saves and other-owner saves do not. Code observes tool completion, not semantic completeness.

Committed active-branch requests deduplicate by owner/native-compaction cycle through refresh, reopen, prompts and model/settings changes. Pending awareness survives refresh; requests retain stable first-delivery anchors. Completed instructions may retire on reset; detach/switch removes obsolete instructions. Failure or noncompliance stays pending without repeated bookkeeping turns. No provider call, background writer, forced task deadline, tool gate, automatic hiding or premature task completion is introduced.

This is best effort, not a protected scheduler phase: a finalized tool batch can jump the whole window, and manual/overflow compaction may win before preservation. Native compaction is never cancelled, delayed or replaced. Its existing summary focus and post-compaction reconciliation remain the fallback. Compaction preserves meaningful unsaved discoveries, not execution diaries. Still-active user authorization must survive in the **conversation summary**, with its exact scope, conditions and limits; exclude expired approval chatter, not the current grant. Never promote a compaction summary into saved or approved decisions. The summarizer can still omit unsaved facts.

## Why this design?

| Alternative | Reason not chosen |
| --- | --- |
| Authored status summaries and next-action lists | Duplicate lifecycle, child work, dependencies and designs; drift without independent value. |
| A separate scope artifact/tool | Creates another changing source/interface; outcome plus the detailed design already own it. |
| Artifact for each stage/output | Turns memory into a report archive rather than selected knowledge. |
| Automatic before-images during tightening | Incomplete recovery history with growing catalogs; selectively preserve valuable knowledge instead. |
| Automatic recursive summaries | Extra calls and progressive loss of rationale/uncertainty/permission boundaries. |
| Search/embeddings as the only grounding | Can omit cross-cutting constraints; explicit records and scoped documents fit the supported scale. |
| Always load all sibling conclusions | Inflates default context; shared knowledge belongs on the parent. |
| Mechanically shorten grammar | Reduces text without proving understanding survives. |

[Caveman](https://github.com/juliusbrussee/caveman/tree/9b68f7ed12b05e7efaff18e65c5a3fc2849fd0a4) informed information selection and explicit supersession, not lossy grammar. No Caveman code, compression provider or retrieval database is a runtime dependency.

## Evaluation

Offline tests cover storage/schema compatibility, narrow upsert kinds, retired-field projection, no automatic snapshots, revisions/retries/approvals, scoped artifacts, provider anchors, one-shot preservation requests/receipts and compaction reconciliation. A real in-memory AgentSession exercises proactive continuation, nested codemode checkpoint/readback and native-priority tool-result jumps, with only synthetic model transport (including summaries). Tests do not prove model understanding, empirical compliance, guaranteed preservation before compaction or live cache behavior.

A separately authorized model evaluation should use synthetic or sanitized snapshots and compare fresh/parallel/post-compaction sessions on the goal, conclusion, decisive reason, uncertainty, appropriate next step, authorization and needed artifact. Measure total read/write/brief work alongside fidelity; a smaller brief that triggers repeated investigation is not a win.
