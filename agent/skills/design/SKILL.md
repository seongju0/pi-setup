---
name: design
description: Settle direction and turn it into a detailed, codebase-verified implementation specification that a fresh build session can execute with minimal inference. Use after research or whenever an outcome needs an approach and spec before implementation.
---

# Design

Settle what to build, then define exactly how to build it. Produce an implementation specification that a smaller model in a fresh session can execute without rediscovering architecture, making product decisions, or guessing core behavior. Detail should remove ambiguity, not add speculative scope.

The usual sequence is research → design → build, but no prior skill invocation or particular document is required. Work from research reports, a direct user request, or the current conversation. Preserve settled decisions; do not reopen what the product should do. Do not automatically implement or start another session. Delegate bounded research or specification work when useful under the global delegation contract; retain ownership of the final design.

## Direction checkpoint

Before specifying, state direction in a few lines:
- **Outcome and success criteria:** what changes for the user, and how we know it works.
- **Approach:** the smallest approach that achieves it, reusing existing behavior. Compare alternatives only for a real unresolved trade-off, and recommend one.
- **Scope, non-goals and non-requirements:** what this change will deliberately not handle.
- **Flow questions:** at most 3, each with a default.
- **Slices:** for larger work, small reviewable segments in dependency order, each with what it delivers.

Read research reports and primary references, not just summaries; separate facts from assumptions. If direction is already settled in the conversation, restate it briefly and continue. If a choice would materially change behavior, scope or safety, stop after the checkpoint and ask; do not write a full spec on a guessed direction or invent approval.

## Requirements you don't have

You lack the product context to decide which edge cases matter; the user has it. Knowing what the change does **not** need to handle is part of the job.

- **Build for the real flow.** Name the actual caller, UI or job that produces each input or state. Not requirements: inputs no current client sends, flows behind an off flag or UI hold, flows a later slice owns, states only a test can construct, hypothetical future callers.
- **Default non-requirements** unless the user or spec says otherwise: rare races between near-simultaneous user actions, brief staleness, re-checking data already checked upstream.
- **Smells — stop before adding:** locks, snapshots or fingerprints, mid-request re-checks, after-commit plumbing, uniqueness-error recovery, queue/worker fencing, a policy check outside the component that owns it, new wrapper/finder/registry classes, storage kept "in case".
- **Ask; don't encode.** If you believe one is needed, ask with one concrete scenario: how it arises in the real workflow, its consequence, its cost (lines/files) and your recommendation. Batch at most 3 such questions, each with a default. Until answered, leave it out.
- **Non-negotiable:** authorization, rejecting malformed input at a trust boundary, data loss, money and PHI exposure. Boundary validation rejects bad input; it does not handle every well-formed combination.
- **Small relevant simplifications are fine** when they directly serve the affected path and preserve behavior. Defer unrelated cleanup.

## Necessity gate

Before adding or requesting a guard, fallback, recovery path, compatibility behavior, abstraction, or test, establish the supported caller, the realistic sequence that reaches the failure, its consequential outcome, and why the existing owner does not already cover it. A constructible state or code citation alone does not establish a requirement. Respect explicit requirements and settled non-requirements; surface conflicts rather than silently expanding scope. Apply this reasoning internally; explain it for disputed or consequential additions, not as a mandatory report template.

If a proposed fix creates another edge case, first reconsider the original mechanism rather than adding exceptions around it. "The UI never sends it" does not dismiss authorization, privacy, money, or data-integrity risks at a trust boundary.

**Apply this gate on every revision**, including your own second pass, new research, subagent output, and review feedback. Do not promote a technically possible failure into a requirement. After revising, remove additions that conflict with settled non-requirements or exist only to support unnecessary complexity; ask before changing an explicit approved requirement.

Preserving existing behavior during extraction does not automatically require transplanting its defensive mechanisms into a new flow or source.

## Delegation contract

Use the global AGENTS.md delegation contract: assign a bounded outcome with the supported flow, settled decisions, non-requirements, accepted trade-offs and permissions. Identify required stage skills and require full reads per the global delegation contract. This does not authorize work beyond the request or override workflow-required stage separation.

The delegating agent remains responsible for checking returned work against those constraints before incorporating it. A child's confidence, severity label, or code citation does not establish that additional behavior is required. No findings or no additional changes is a valid outcome.

## Ground the specification

1. Read project instructions and the actual code/tests affected. Trace entry points, shared functions and their callers, data flow, persistence, permissions, and existing patterns. Validate research assumptions against the live code; reports are starting evidence, not a substitute for inspection. Carry forward non-requirements and accepted trade-offs from the checkpoint, the conversation and any durable todo decisions; do not silently reinstate them.
2. Prefer existing helpers, stdlib, native platform features, and installed dependencies. Choose the smallest complete change; avoid speculative abstractions and unrelated cleanup.
3. For React work, read and apply `../vercel-react-best-practices/SKILL.md` relative to this skill directory. For component API/architecture work, also apply `../vercel-composition-patterns/SKILL.md`. Follow the project's domain model and conventions rather than introducing a parallel architecture.
4. Resolve implementation-critical uncertainties before declaring the spec ready. Verify existing file paths, symbols, interfaces, and test commands. Explicitly mark new files/symbols as proposed. Do not leave core implementation locations as candidates for the builder to discover.

## Specify the change

Make the spec self-contained: repository/worktree, objective, current behavior, intended behavior, scope, non-goals, settled decisions, relevant references, and permissions. Never rely on “as discussed” or an unstated conversation dependency.

Give ordered, actionable steps. For each substantial step, specify:
- Exact existing or proposed files and symbols; what to add, change, remove, or reuse, and what must remain unchanged.
- Inputs/outputs, type or interface shapes, state transitions, and how callers and components connect. Use small code-shape sketches, pseudocode, or diagrams where they clarify more than prose; do not dump a speculative full implementation.
- Required branches, invariants, boundary validation, error handling, and relevant edge cases. Each guard, fallback or recovery path names the real flow that triggers it. Cover concurrency, cancellation, retries, compatibility, or migrations only when the actual change needs them.
- Which **Test plan** scenario proves the step. Do not plan a spec file per step or per new class.
- Dependencies on earlier steps and a clear completion condition.

## Test plan: few flow-level specs

Plan tests once for the whole change, from the user-visible flow inward. Build follows this plan and adds nothing beyond it.

- **Scenarios, not files.** List the few caller-level scenarios (request/system/job/integration spec) that prove the outcome end to end with real internal collaborators. Stub only external HTTP/vendor boundaries. For each: spec file (extend an existing one first), setup, trigger, asserted outcome or readback, and the regression it catches.
- **Default budget:** new classes covered by a scenario get no spec file of their own. A unit spec is allowed only for complex pure logic, named with its reason.
- **Deliberately not tested:** list what stays out (log/metric shape, permutation matrices, guarantees another layer already owns) so build does not add it.
- **Consolidate:** name existing specs the new scenarios make redundant, and whether to merge or delete them.
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

Unanswered flow questions block only when the answer changes the core design; otherwise state the default and leave the extra handling out. The build handoff lists the approved direction, execution order, commands, expected results, prohibited changes (including omitted safeguards and tests outside the test plan), and final report requirements. Return the spec in the conversation unless the user requests a saved artifact or an existing workflow specifies its location. Do not implement or automatically invoke `/skill:build`; stop after the spec.
