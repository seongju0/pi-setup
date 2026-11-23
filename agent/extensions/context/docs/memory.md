# Memory contract, formatting and rationale

Context preserves the existing TODO memory contract alongside separate [Session tasks](../tasks/README.md). The package combines source loading while keeping task JSON separate from schema2/Project3 project memory and independently versioned reusable knowledge. Session task JSON is not durable project knowledge, and task completion does not update project progress. Optional journal retrieval is described in the [package adoption guide](../README.md#adoption).

Todo preserves the minimum sufficient grounding for a fresh or parallel session to understand the goal, the current understanding, why it holds, and what remains uncertain. It also restores that grounding after compaction. It is not a transcript, execution planner, test archive or autonomous scheduler.

The [README](../README.md) owns implementation architecture and API reference. This document defines information ownership, writing conventions and design trade-offs. It is repository documentation, not another saved project memory or always-injected prompt.

## Persistence and worker access

Canonical state and Markdown document bodies live together in `<root>/todo.sqlite` (built-in Node 26+ SQLite). Owner JSON preserves the domain shape and array order inside SQLite; artifacts are immutable body BLOBs, not separately maintained Markdown files. Transactions commit one project, explicit references and document bytes together; related projects never auto-start or roll up. There is no automatic legacy JSON fallback, import or dual write; the [README migration runbook](../README.md#storage-and-explicit-upgrades) owns explicit cutover and rollback limits.

Use TODO tools to read records and document pages. Returned `directory` strings are deprecated legacy locators, not a physical document-directory promise; artifact paths are opaque version keys. A worker without memory tools needs bounded material supplied by its parent through available tools, not a guessed filesystem path or direct SQL contract. This changes persistence, not context/compaction or approval policy.

## Task entry and workflow ownership

Durable memory belongs to an enduring task/outcome, not to a session, worktree or stage. The global `agent/AGENTS.md` contract establishes the owner before substantial work: use the relevant attachment, or resolve a supplied TODO ID/linked issue URL or search recognizable goals, inspect candidates and resume a clear existing match. `get` alone does not attach. Ask on ambiguity or before switching owners; creation still requires explicit user intent. Trivial questions need no record. An explicit opt-out is respected; unavailable/declined tracking requires a disclosed fallback, not a silent parallel memory system.

Creation-permission requests follow the global standalone **Decision required** Yes/No prompt and waiting rule; an already explicit request/approval needs no repeated confirmation. This is agent guidance, not a new runtime dialog or automatic tool-level approval gate.

Owner resolution and durable curation belong to standalone sessions, orchestrating parents and receiving independent sessions. Parent-owned workers use the supplied owner and relevant context; they do not independently discover/attach an owner, create records or checkpoint shared memory unless assigned. They may read relevant material using available tools. The parent supplies sufficient bounded context when a worker lacks TODO access, without maintaining a second authoritative copy.

The tool's `status` action exposes the attachment as selected summary metadata or null without changing selection, durable memory, loaded context or acknowledgement. Inspect at entry/recovery when needed, not on every turn. It reads the current saved revision, not a guarantee that the loaded brief is current. The extension does not choose an owner from cwd or classify user requests automatically.

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
| Consequential findings, qualifications and useful supporting pointers | Read `current_state.evidence` as `{id,text}` records; write `evidence` edits by ID |
| Governing choices and their decisive reasons | `decisions`, including approval state and necessary evidence |
| Delivery-affecting uncertainty | `open_questions`; resolve only with supporting evidence |
| Routes to authoritative material | `references` |
| Substantial understanding that needs its own body | A `research` artifact |
| Substantial implementation contract or plan | A `design` artifact |
| QA, review and execution detail | QA Toolkit or the workflow's native report |
| Current execution assignment and scoped user permission | The conversation, not durable instructions |

There is no authored progress summary or next-action list to maintain. Chat-first discovery displays structured project status/dependencies, not `current_state.summary` or completion rollups. Relevant designs and unresolved questions let a session propose the next step; they do not authorize it. Project completion remains explicit.

Do not replace the retired fields with a new `context.md`, "Latest status" artifact section or generated-and-saved next-step summary.

### Independent projects, associations and knowledge

Each project owns one responsibility. Use `context_link` associations for navigation, a separate global prerequisite DAG for completion constraints, and explicit direct context references for mandatory grounding. None is ownership, implicit authority or a recursive subscription. Former parent provenance is retained only for historical interpretation; nesting/move is retired.

Grounding references enroll only active source records, not source catalogs, refs or permissions. Artifact references enroll one source-owned document with its current pointer. Source changes cause watch drift, not silent refresh or consumer writes. Ordinary associated project/knowledge bodies stay out. Missing mandatory sources fail visibly.

Reusable knowledge is a separate library, not a renamed project artifact or automatic closeout. Explicitly authorized creation may pin a project/artifact origin, but current attachment alone never invents one. `context_knowledge` create/update/review/supersede require current-request authority or native confirmation, real session identity, retry key and expected revisions where applicable. Saved historical approvals, task reports and worker assignments are not grants; never fabricate `approval_evidence`. The API records asserted provenance/review, not semantic truth certification.

Knowledge has its own summary/scope/explanation/limits and stable sources. Update only read/understood fields; exact targeted explanation edits preserve unread tails. Sources update/remove by ID, omissions preserve data, and ordinary wording edits do not reset review/verification dates. Immutable knowledge/link history is distinct from mutable project evidence, whose overwritten/removed text has no general recovery guarantee. Supersession exposes a current replacement without rewriting incoming links. Reads/search/history do not attach, acknowledge or create authority.

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
- **Required reference:** the consumer explicitly names direct source grounding or one source-owned artifact. Own catalog entries also need refs for brief inclusion. Imported `applies_to` is immutable provenance; new artifacts require `[]` and atomically add an owner reference.

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

Recall uses independent candidates with status and goal (deprecated parent locators are null). Search includes completed projects; list excludes closed entities unless requested. Inspect ambiguity, then explicitly attach/resume a project. Knowledge reads never attach. Resume loads only direct required grounding without reopening completed work or granting permission.

### Recoverable sources, not a receipt archive

Use `session_history`, when that optional tool is loaded, if the original journal evidence matters. Without it, Context recap still provides bounded active-branch evidence and stable references, but does not advertise executable history read targets. Store its emitted `pi-history:v1/<encoded-session-id>/<encoded-entry-id>` reference in evidence record text or a reference string beside the concise finding and qualifications. Journal pointers need no additional schema fields, automatic harvesting or per-tool bookkeeping. Default search stays on current ancestry (including pre-compaction entries); exact reference reads can resolve same-project session files. Other-project or deleted sources fail visibly rather than expanding scope.

Historical user text, assistant claims, tool evidence, coordination and derived summaries keep distinct provenance. Reading them does not revive approval or prove live state. Verify actual state before repeating consequential actions. Journal edits/compaction are not deletion; retrieved historical originals may differ from the current conversation projection. Retrieved text enters the selected model/provider context; thinking, system messages, hidden extension state and image bytes are excluded. The history tool does not guarantee recovery of overwritten TODO fields.

Knowledge hits lead to positioned bounded reads, not an owner-wide get. `todo_record` reads evidence/reference by index or decisions/questions by record ID, with mandatory `expected_revision` on every page including page 0. This pins shifting indexed lists and content across pages; if the owner changes, search again or restart with the current revision. Its body is exactly the literal text searched (decision summary/rationale/evidence or question text/resolution joined with newlines). Default active view refuses hidden/superseded/resolved records; full explicitly reads retained content. `in_active_context`, `inactive_reasons` and relevant visibility/approval/supersession/resolution metadata explain the policy: hidden is not obsolete and approved is not necessarily current. Pages contain only the same bounded body in native text, details and structured output, with a complete continuation read target. Offset 0 supplies earlier context. Knowledge record targets start up to 80 UTF-16 characters before the match. Artifact targets prefer body matches with body-relative `match_offset` and `match_field:body`; metadata-only/boundary matches use `match_field:metadata` and page 0. Artifact lifecycle remains explicit, including reference/superseded reasons.

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

## Read-only recap: evidence versus synthesis

Conversational requests for the attached TODO's status / what has been done use `todo_recap`; `/todo recap` sends one ordinary main-agent request to call the same tool and present the same format:

```markdown
## Status — <TODO title>
<one-sentence current state>
### This session
- Work supported by this conversation and session evidence.
### Preserved understanding
- Saved facts, decisions and uncertainty, with draft/approval state explicit.
### Artifacts to know
- Document title/purpose plus todo_artifact read target or stable reference.
### Remaining
- Pending work/decisions, not execution permission.
```

Use one or two high-signal bullets per nonempty section, omit empty sections and deduplicate. The [README example](../README.md#session-context-drift-and-recap) illustrates presentation, not verified project state. This is ephemeral agent synthesis, not another authored status field or saved recap artifact.

The tool supplies live model2 project/direct-source grounding, source-qualified artifact catalog/read targets, bounded association and prerequisite summaries and bounded recent active-branch evidence. It does not generate semantic session-progress prose or eagerly load artifact bodies. Native journal excerpts retain IDs/history refs, provenance and tool failure identity; thinking and hidden injected notes are excluded. A bounded sample is not full-session coverage: compaction summaries are derived and branch ancestry may be partial/inherited. Use existing `session_history` search/read when evidence is missing. Do not infer completion from tool success, attribute all ancestry to this session or present historical test/publication/status evidence as freshly verified external state. No automatic archived-session or external-service inspection occurs.

Recap reads do not save, attach, refresh, acknowledge or observe state, so drift and pending checkpoint/leave behavior remain intact. No attachment yields an explicit unattached result; there is no owner search/inference. The manual command waits for idle and invokes the current main model, not a background summarizer or zero-model renderer. The agent combines evidence with relevant conversation and admits consequential coverage limits. `todo` action `status` remains lightweight attachment metadata, `/todo status` still changes local progress, and generic service/Git status requests are not redirected.

## Safe evidence curation and schema cutover

Canonical stored/get/resume/recap evidence is schema 2 `{id,text}[]`, not a
string-array projection. Write with checkpoint `changes.evidence` or tightening
`evidence`: `{add:["New qualification"], update:[{id,text}], remove:[id]}`.
Unmentioned records remain exact, updates keep position/identity and adds append.
Empty edits never clear. Bulk replacement/clear enumerates every deliberately
removed ID; no destructive switch or automatic curation exists.

At most 30 records, nonempty verbatim text up to 2000 characters, checked after
all edits and automatic outcome-approval attribution. Explicitly consolidate or
remove IDs in the same change to make room. Unknown/conflicting IDs fail without
manifest effects. References and nested decision evidence retain string-array
semantics. Approval receipt records are editable/removable like other evidence;
exact-text attribution dedupe remains. Edits/removals have no recovery history.
Evidence IDs appear as metadata on knowledge hits and revision-pinned indexed
record pages; search matches factual text, not JSON or IDs.

Explicit additions have owner/accepted-base-revision/ordinal identities;
approval attribution has a separate namespace. Checkpoint's compact and full
structured `evidence_ids` report the original explicit additions from saved
`last_checkpoint.base_revision`, even on refreshed-revision retries after
tightening removed one. Full state/effects remain current. Old receipts without
a base omit IDs; existing digest/key/session/revision semantics remain.
Tightening reports from its checked revision; read after uncertain effects before
retrying. Do not print a full successful write merely to retrieve generated IDs.

Whole-list `current_state` writes are always rejected, including null/empty
values and old successful-key retries, before approval or mutation. The schemas'
unknown-valued slot exists only to deliver actionable rejection instructions;
it does not accept legacy writes.

Runtime accepts exact SQLite schema2/Project3 only: no lazy conversion, archival JSON read fallback or automatic migration. Frozen legacy decoders are used only by explicit import/upgrade and historical fixtures. The SQLite1→2 upgrade and retained JSON importer are separate CLIs; both preserve identity, bytes and materialized reference audiences. See the [runbooks](../README.md#storage-and-explicit-upgrades). Stop all old/new writers and separately authorize the exact target before apply/cutover. Preserve permanent JSON-import fences; never reimport archives or restore a stale backup over new writes. Copying source is not data migration or reload permission. Old sessions keep selection/receipts and cross one intentional model1→model2 prompt boundary without journal rewrites.

## Maintenance without a second planning system

During meaningful updates, preserve new knowledge, replace obsolete findings, consolidate duplication and update the owning design/research document. Do not add periodic compression jobs, extra model calls, cleanup-only turns, hard semantic size caps or automatic hiding. The status bar estimates the full loaded starting brief (guidance/boundary text and bundle metadata included) and its share of a known physical model's total window; it does not account for supplemental notes, artifact reads, ordinary tool history or billing. Checkpoints do not replace this immutable brief. Unknown/virtual windows omit the percentage, and a not-yet-loaded brief is pending. See the [loaded-brief diagnostic contract](../README.md#session-context-drift-and-recap). No new size popup or injected tightening nudge is emitted; a large estimate does not require shrinking still-relevant context. Legacy delivered notices remain anchored until a normal reset.

Visibility changes can be reversed with restore IDs. Replaced mutable text is not automatically archived: `todo_tighten` no longer creates `context-history` artifacts. Ordinary checkpoints were never a complete manifest event log either. The revision counter detects drift; it is not a recovery history. Immutable artifact body revisions remain, but that does not guarantee recovery of overwritten fields.

For an explicitly authorized migration, inspect retired summaries/actions/history for stranded knowledge before removal. Transfer meaningful facts, constraints and uncertainties to their proper homes; discard obsolete execution instructions. Do not mechanically create children or decisions from every action. A one-time private rollback copy outside the working store is not an artifact category or a new ongoing archive mechanism.

Delivery resolves the durable owner under the global task-memory entry policy even when no TODO ID was supplied. Use that owner and relevant specs/reports instead of another comprehensive handoff ledger; stage reports stay with the delivery workflow. A transient execution handoff may route revisions, worktrees, resource leases and reports without duplicating project understanding. Comprehensive file-based grounding is a fallback only when durable tracking is explicitly declined or unavailable; disclose that limitation and the file's persistence limits. A missing TODO parameter is not grounds for this fallback.

## Retention, injection and compaction

Active reads/resume omit resolved questions, superseded/hidden decisions, historical/hidden artifacts and retired summary/action fields. Full reads retain legacy fields until explicitly migrated. Preserve rationale, evidence and unresolved constraints rather than shortening them to counts.

Mutation text normally contains only success/revision and necessary generated IDs/effects; full `details`/`structuredContent` remain available. Await known successful writes in codemode without printing the full returned value (`text(result)`); retain programmatic access for IDs, revisions and effects and print only needed new information. This does not suppress errors. Linear refresh displays a compact saved/id/revision/new snapshot receipt rather than the native manifest, retaining the full structured result and unchanged local progress. Writes do not regenerate the attached brief. Stable anchors preserve its provider position; refresh or successful compaction establishes a new boundary.

Before automatic compaction, a completed continuation-capable turn with known physical-model usage can request one bounded preservation response from the ordinary main agent. Live native settings determine an early heuristic window: `min(floor(0.90 * W), W - reserveTokens - min(16384, floor(W / 10)))`, below the native threshold. Disabled auto-compaction, unknown usage, virtual selections and aborted/error boundaries do not trigger it. The margin is not reserved capacity. See the [implementation contract](../README.md#session-context-drift-and-recap).

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
| Always load all associated bodies | Inflates default context and conflates navigation with authority; explicit one-hop references select required grounding. |
| Mechanically shorten grammar | Reduces text without proving understanding survives. |

[Caveman](https://github.com/juliusbrussee/caveman/tree/9b68f7ed12b05e7efaff18e65c5a3fc2849fd0a4) informed information selection and explicit supersession, not lossy grammar. No Caveman code, compression provider or retrieval database is a runtime dependency.

## Evaluation

Offline tests cover storage/schema compatibility, narrow upsert kinds, retired-field projection, no automatic snapshots, revisions/retries/approvals, scoped artifacts, provider anchors, one-shot preservation requests/receipts and compaction reconciliation. A real in-memory AgentSession exercises proactive continuation, nested codemode checkpoint/readback and native-priority tool-result jumps, with only synthetic model transport (including summaries). Tests do not prove model understanding, empirical compliance, guaranteed preservation before compaction or live cache behavior.

A separately authorized model evaluation should use synthetic or sanitized snapshots and compare fresh/parallel/post-compaction sessions on the goal, conclusion, decisive reason, uncertainty, appropriate next step, authorization and needed artifact. Measure total read/write/brief work alongside fidelity; a smaller brief that triggers repeated investigation is not a win.
