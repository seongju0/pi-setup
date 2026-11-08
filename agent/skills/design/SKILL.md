---
name: design
description: Settle an approach and produce a codebase-verified, build-ready implementation specification. Use when asked to design a change, flesh out a plan, finalize the design, or make it ready for implementation. Stops at the specification; does not automatically build or deliver.
---

# Design

Settle what to build, then define exactly how to build it. Produce an implementation specification that a smaller model in a fresh session can execute without rediscovering architecture, making product decisions, or guessing core behavior. Detail should remove ambiguity, not add speculative scope.

The usual sequence is research → design → build, but no prior skill invocation or particular document is required. Work from research reports, a direct user request, or the current conversation. Preserve settled decisions; do not reopen what the product should do. Do not automatically implement or start another session. Delegate bounded research or specification work when useful under the global delegation contract; retain ownership of the final design.

Follow the global AGENTS.md task-memory and delegation contract. Standalone parents resolve ownership; workers use supplied context and request missing material from the parent. Honor tracking opt-out and disclose fallback limits; it does not prevent design.

## Direction checkpoint

Before specifying, state direction in a few lines:
- **Outcome and success criteria:** what changes for the user, and how we know it works.
- **Approach and ownership:** identify the ordinary operation, what actually varies, and who owns decisions, data and side effects before prescribing files or classes. Reuse existing behavior; compare alternatives only for a real unresolved trade-off and recommend one.
- **Scope, non-goals and non-requirements:** what this change will deliberately not handle.
- **Flow questions:** at most 3 material questions, each with a default; omit hypothetical gap inventories.
- **Slices:** for larger work, small reviewable segments in dependency order, each with what it delivers.

Read research reports and primary references, not just summaries; separate facts from assumptions. If direction is already settled in the conversation, restate it briefly and continue. If a choice would materially change behavior, scope or safety, stop after the checkpoint and ask; do not write a full spec on a guessed direction or invent approval.

## Necessity and design

For consequential structural choices, read [Codebase Design](../codebase-design/SKILL.md). Settle the caller contract, responsibility owners and consequential effects; compare alternatives only for a real unresolved choice and carry the decision into the specification.

Justify each proposed mechanism with its supported caller sequence, consequence and why the existing owner is insufficient. A code citation, pattern or spec prescription alone does not establish need. If a mechanism creates another edge case, reconsider it before layering exceptions. Reapply this check when revising from research or review; reusing behavior does not require transplanting its defensive machinery.

Treat hypothetical callers, artificial test states, rare user-action races, brief staleness and upstream re-checks as non-requirements unless requested. **This does not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity.** UI behavior is not enforcement. Ask before changing approved requirements or adding guarantees; surface conflicts rather than silently restoring excluded behavior.

## Ground the specification

1. Read project instructions and the actual code/tests affected. Trace entry points, shared functions and their callers, data flow, persistence, permissions, and existing patterns. Validate research assumptions against the live code; reports are starting evidence, not a substitute for inspection. Carry forward non-requirements and accepted trade-offs from the checkpoint, the conversation and any durable todo decisions; do not silently reinstate them.
2. Prefer existing helpers, stdlib, native platform features, and installed dependencies. Choose the smallest complete change; avoid speculative abstractions and unrelated cleanup.
3. For React work, read and apply `../vercel-react-best-practices/SKILL.md` relative to this skill directory. For component API/architecture work, also apply `../vercel-composition-patterns/SKILL.md`. Follow the project's domain model and conventions rather than introducing a parallel architecture.
4. Resolve implementation-critical uncertainties before declaring the spec ready. Verify existing file paths, symbols, interfaces, and test commands. Explicitly mark new files/symbols as proposed. Do not leave core implementation locations as candidates for the builder to discover.

## Specify the change

Make the spec self-contained: repository/worktree, objective, current behavior, intended behavior, scope, non-goals, settled decisions, relevant references, and permissions. Never rely on “as discussed” or an unstated conversation dependency.

Give ordered, actionable steps. For each substantial step, specify:
- Exact existing or proposed files and symbols; what to add, change, remove, or reuse, and what must remain unchanged.
- Inputs/outputs, type or interface shapes, state transitions, and how callers and components connect. For consequential structural choices, name responsibility owners, distinguish what genuinely varies from the ordinary flow, and show a small code-shape sketch or diagram. Resolve the structure without prescribing every local helper or dumping a speculative full implementation.
- Required branches, invariants, boundary validation and error handling. Each guard, fallback, recovery path or new storage mechanism names its real triggering flow and consequence not already covered by the existing owner. Cover concurrency, cancellation, retries, compatibility or migrations only when the actual change needs them.
- Which **Test plan** scenario proves the step. Do not plan a spec file per step or per new class.
- Dependencies on earlier steps and a clear completion condition.

## Test plan: few flow-level specs

Plan tests once for the whole change, from the user-visible flow inward, using [Codebase Design's interface-testing principles](../codebase-design/SKILL.md#test-the-meaningful-interface). Retained coverage may suffice. Build follows the agreed plan; if implementation reveals a concrete coverage gap, it surfaces the regression and smallest correction before expanding the plan.

- **Scenarios, not files.** List the few caller-level scenarios (request/system/job/integration spec) that prove the outcome end to end with real internal collaborators. Stub only external HTTP/vendor boundaries. For each: spec file (extend an existing one first), setup, trigger, asserted outcome or readback, and the regression it catches.
- **Choose the workflow owner.** For substantial browser-facing features, prefer one representative existing Playwright/system scenario spanning navigation, actions and persisted outcome; keep backend-only contracts and detailed permutations in focused integration tests. Name real/stubbed boundaries and optional same-run capture.
- **Focused tests:** do not plan a file per class. Justify focused tests for complex logic by the distinct regression protection that caller-level scenarios do not adequately provide—not by whether the logic is pure.
- **Deliberately not tested:** list what stays out (log/metric shape, permutation matrices, guarantees another layer already owns) so build does not add it.
- **Consolidate:** name redundant specs and retained or replacement coverage before proposing merges or deletions.
- Commands, environmental prerequisites and remaining manual checks, stated separately.

Avoid vague instructions such as “handle errors,” “add tests,” or “update callers” without naming which behavior, failures, or callers matter. A builder may choose routine syntax and formatting, but should not need to choose architecture or infer intended semantics.

## Deliverable and readiness

Scale the spec to the task, but do not sacrifice implementation-critical detail for brevity. Use these sections as needed:

```md
# Direction checkpoint (outcome, approach, slices)
# Objective, scope, and starting point
# Verified current behavior and proposed changes
# Interfaces, data flow, and invariants
# Non-requirements and considered-but-omitted (one line each, so build does not add them)
# Ordered file-level implementation steps
# Test plan (scenarios, spec files, deliberately not tested, consolidation) and acceptance checklist
# Risks, prerequisites, and unresolved decisions
# Build handoff and stop condition
```

Mark the spec **ready for build** only when implementation-critical decisions and locations are resolved. Otherwise mark it **blocked** and state exactly what must be decided or verified. This readiness label is not permission to implement or user approval.

Unanswered flow questions block only when the answer changes the core design; otherwise state the default and leave the extra handling out. The build handoff lists the approved direction, execution order, commands, expected results, prohibited changes (including omitted safeguards and tests outside the test plan), and final report requirements.

**Presentation and preservation are independent choices.** Present the spec in the conversation unless the user or workflow requests another output. Under delegation, return the specification body and relevant context to the parent; follow deliver's default final-answer report policy when applicable, without a duplicate report file.

The standalone owner or parent preserves reusable design under the global task-memory contract, with one authoritative body rather than competing copies; inline presentation alone is not preservation. Workers return the specification for the parent to curate. Saving or labeling a spec ready does not approve implementation. Stop after the spec; do not automatically invoke `/skill:build`.
