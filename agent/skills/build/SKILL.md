---
name: build
description: Implement and verify an approved specification or sufficiently explicit change request. Use when asked to build a change, implement the plan, or implement a feature with settled behavior and approach. Does not automatically run the full delivery workflow or authorize publication.
---

# Build

Carry out the approved implementation specification; do not reopen settled product or design decisions.

The usual sequence is research → design → build, but no prior skill invocation or particular artifact is required. Use the provided design, an explicit user request, or sufficiently settled conversation context. A spec labeled ready for build is not user approval by itself. Do not require a separate planning/design ceremony for straightforward work, and do not automatically start another session.

1. Read project instructions, the supplied specification/context, and relevant code/tests. Resolve the repository/worktree, intended flow, constraints, permissions, checks and stop condition. Trace the specified flow through live callers from entry to resolution before editing.
   For stacked work, read [Stack foundations](references/stack-foundations.md) and the upstream `gh-stack` skill before changing layers or history. Establish tracking and worktree ownership first.
2. Follow the specification's execution order and file-level guidance. Keep the diff focused; prefer the simplest implementation that meets the requirements and codebase conventions. Avoid speculative abstractions and unrelated cleanup.
3. If the specification conflicts with the live code, lacks an implementation-critical decision, or a material constraint makes it unsafe/incomplete, pause and report the specific gap instead of silently redesigning. This includes a specified write that violates an established consumer invariant or a changed shared-helper contract that breaks an existing caller. Resolve minor implementation details using local conventions.
   If a specified mechanism conflicts with settled non-requirements or exists solely to support another apparently unnecessary mechanism, flag the contradiction before implementing that portion. Do not silently remove approved behavior or implement speculative scaffolding merely because it appears in the spec.
   Behavior-preserving clarity improvements and confirmed fixes to specified behavior at its existing owner are in scope. New guarantees, policies, recovery behavior, storage or architectural contracts require a scope decision; do not add them as routine corrections. Report supported-flow gaps with their triggering sequence, not hypothetical gap inventories.
4. Follow the agreed test plan; without one, apply **Testing** below. If implementation reveals a concrete coverage gap, surface the regression and smallest correction before expanding the plan. No new test is a valid outcome when retained coverage already protects the change.
5. **Read the implementation diff for clarity before reporting.** Check the main path, names, nesting, data reshaping, duplicate rules, and unnecessary indirection against **Necessity and design** below. Improve the touched path without expanding scope or changing behavior. Apply the same standard to delegated code; no extra report template is required.
6. **Audit every changed test.** Internally identify its behavior and unique regression signal; consolidate duplicate coverage and repair stubs that bypass that behavior. Report a short test delta (files/scenarios added or removed and internal stubs left with reasons), not a per-scenario inventory.
7. Run relevant checks and inspect delegated results before reporting. Return the change, commands/results, test delta and confirmed gaps, conflicts or blockers; distinguish verification from assumptions. Under deliver, the complete final answer is the default saved stage report; do not create a duplicate summary file or claim a native result in parent-only execution.

## Necessity and design

When implementing consequential structural changes, read [Codebase Design](../codebase-design/SKILL.md). Preserve the accepted caller contract and ownership; report material discoveries rather than silently redesigning.

Before adding a mechanism, establish the real caller sequence, consequence and why the existing owner is insufficient. If a fix creates another edge case, reconsider the mechanism before layering exceptions. Do not add hypothetical-caller support, artificial-test-state handling, race or staleness recovery, upstream re-checks or security hardening merely because a failure can be imagined.

**These defaults do not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity on a real path, however uncommon.** UI behavior is not enforcement. Preserve those protections and escalate conflicts with approved scope or accepted trade-offs; a security label does not grant extra authority.

## Testing

Read the [shared testing policy](references/testing.md) before adding, changing, deleting or auditing tests, and whenever there is no agreed test plan.
