---
name: build
description: Implement and verify an approved specification or sufficiently explicit change request. Use when asked to build a change, implement the plan, or implement a feature with settled behavior and approach. Does not automatically run the full delivery workflow or authorize publication.
---

# Build

Implement the approved change and verify the result. Preserve settled product and design decisions; do not silently redesign the work.

Start from a specification, an explicit request or sufficiently settled conversation context. No earlier workflow or separate planning stage is required for straightforward work. A spec marked ready for build is not user approval. Do not automatically start another session.

## 1. Check the scope and real flow

Read project instructions, the supplied context and relevant code/tests. Establish the repository/worktree, intended behavior, constraints, permissions, checks and stop condition. Before editing, trace the actual flow through live callers from entry to outcome.

For stacked work, read [Stack foundations](references/stack-foundations.md) and the upstream `gh-stack` skill before changing layers or history. Establish tracking and worktree ownership first.

## 2. Implement within the agreed scope

Follow the spec's order and file-level guidance. Use local conventions for minor details. Keep the smallest complete change; avoid speculative abstractions and unrelated cleanup.

**Pause and report a specific gap when:**
- The spec conflicts with live code or leaves an implementation-critical decision open.
- A material constraint makes the spec unsafe or incomplete.
- A specified write breaks an existing consumer's invariant, or a changed shared-helper contract breaks a caller.
- A mechanism contradicts settled non-requirements or exists only to support another apparently unnecessary mechanism. Flag this before implementing that portion.

Do not silently remove approved behavior or add scaffolding just because the spec names it. Describe gaps using their supported caller sequence, not an inventory of hypothetical failures.

Behavior-preserving clarity improvements and confirmed fixes to specified behavior belong at the existing owner and are in scope. New guarantees, policies, recovery behavior, storage or architectural contracts need a scope decision; they are not routine corrections.

For consequential structural changes, read [Codebase Design](../codebase-design/SKILL.md). Keep the accepted caller contract and ownership; report material discoveries rather than redesigning silently.

Before adding a mechanism, establish the real caller sequence, consequence and why the existing owner is insufficient. If a fix creates another edge case, reconsider it before adding exceptions. Do not add handling for hypothetical callers, artificial test states, race/staleness recovery, upstream re-checks or security hardening merely because a failure can be imagined.

**These defaults do not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity on a real path, however uncommon.** UI behavior is not enforcement. Preserve these protections and escalate conflicts with approved scope or accepted trade-offs; a security label grants no extra authority.

## 3. Check the implementation and tests

Read the [shared testing policy](references/testing.md) before adding, changing, deleting or auditing tests, and whenever there is no agreed test plan.

Follow the agreed test plan. If implementation reveals a concrete coverage gap, surface the regression and smallest correction before expanding the plan. No new test is a valid outcome when retained coverage protects the change.

Read the implementation diff for clarity: main path, names, nesting, data reshaping, duplicate rules and unnecessary indirection. Recheck mechanisms in the diff against the need established in section 2. Improve the touched path without changing behavior or expanding scope. Apply the same standard to delegated code; no extra report template is required.

Audit every changed test for its named behavior and unique regression signal. Consolidate duplicate coverage and repair stubs that bypass the behavior. Keep a short test delta: files/scenarios added or removed, and internal stubs left with reasons—not a per-scenario inventory.

Run relevant checks and inspect delegated results. Distinguish what was verified from assumptions.

## 4. Report the result

Return what changed, commands/results, the test delta and confirmed gaps, conflicts or blockers.

When delegated through deliver, the subagent tool saves your complete final answer as the stage report. Do not create a duplicate summary file. If the parent performs the work itself, report directly without claiming a native child result.
