# Memory contract, formatting and rationale

Todo preserves the minimum sufficient grounding for a fresh or parallel session to understand the goal, the current understanding, why it holds, and what remains uncertain. It also restores that grounding after compaction. It is not a transcript, execution planner, test archive or autonomous scheduler.

The [README](../README.md) owns implementation architecture and API reference. This document defines information ownership, writing conventions and design trade-offs. It is repository documentation, not another saved project memory or always-injected prompt.

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

- **Title:** name the outcome; make sibling items distinguishable without opening them.
- **Goal and scope:** what should become true, included responsibility and important exclusions. No current progress report.
- **Finding/evidence:** one consequential fact or qualification with a useful source when needed. Not a list of activity receipts.
- **Decision:** choice and decisive reason; add a rejected alternative only when it prevents rediscovery.
- **Question:** the unresolved issue and why its answer matters. Do not encode a temporary assignment as a question.
- **References:** useful routes, not every source visited.

These are structured fields, not a template to repeat in a second Markdown description. Lists replace obsolete content rather than accumulating dated corrections.

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

When delivery has a supplied durable todo, use it and relevant specs/reports instead of another comprehensive handoff ledger. Stage reports stay with the delivery workflow. Without suitable durable grounding, a temporary handoff can still serve the workflow; it is not automatically long-term memory.

## Retention, injection and compaction

Active reads/resume omit resolved questions, superseded/hidden decisions, historical/hidden artifacts and retired summary/action fields. Full reads retain legacy fields until explicitly migrated. Preserve rationale, evidence and unresolved constraints rather than shortening them to counts.

Mutation text normally contains only success/revision and necessary generated IDs/effects; full `details`/`structuredContent` remain available. Writes do not regenerate the attached brief. Stable anchors preserve its provider position; refresh or successful compaction establishes a new boundary.

Compaction preserves meaningful unsaved discoveries, not execution diaries. Still-active user authorization must survive in the **conversation summary**, with its exact scope, conditions and limits; exclude expired approval chatter, not the current grant. Never promote a compaction summary into saved or approved decisions. The summarizer can still omit unsaved facts.

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

Offline tests cover storage/schema compatibility, narrow upsert kinds, retired-field projection, no automatic snapshots, revisions/retries/approvals, scoped artifacts, provider anchors and compaction reconciliation. They do not prove model understanding or live cache behavior.

A separately authorized model evaluation should use synthetic or sanitized snapshots and compare fresh/parallel/post-compaction sessions on the goal, conclusion, decisive reason, uncertainty, appropriate next step, authorization and needed artifact. Measure total read/write/brief work alongside fidelity; a smaller brief that triggers repeated investigation is not a win.
