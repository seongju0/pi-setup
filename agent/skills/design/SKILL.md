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
- **Approach and ownership:** identify the ordinary operation, what actually varies, and who owns decisions, data and side effects before prescribing files or classes. Reuse existing behavior; compare alternatives only for a real unresolved trade-off and recommend one.
- **Scope, non-goals and non-requirements:** what this change will deliberately not handle.
- **Flow questions:** at most 3 material questions, each with a default; omit hypothetical gap inventories.
- **Slices:** for larger work, small reviewable segments in dependency order, each with what it delivers.

Read research reports and primary references, not just summaries; separate facts from assumptions. If direction is already settled in the conversation, restate it briefly and continue. If a choice would materially change behavior, scope or safety, stop after the checkpoint and ask; do not write a full spec on a guessed direction or invent approval.

## Necessity and design

**Build for supported behavior, not constructible states.** Before adding or requesting a guard, fallback, recovery path, compatibility behavior, storage or abstraction, establish the real caller sequence, consequential outcome, and why the existing owner does not already protect it. A code citation, spec prescription or reviewer recommendation alone does not establish necessity. If a fix creates another edge case, reconsider the original mechanism before adding exceptions.

Hypothetical callers, states only tests construct, rare user-action races, brief staleness and upstream re-checks are non-requirements unless the task says otherwise. Leave speculative extras out; ask one concrete question with a recommended default only when the answer materially changes behavior, scope or safety. Respect settled non-requirements and surface conflicts with approved requirements rather than silently changing them.

**Non-negotiable:** authorization, rejecting malformed input at a trust boundary, data loss, money and PHI exposure. Default non-requirements do not waive these consequences. "The UI never sends it" does not dismiss authorization, privacy, money or data-integrity risks at a trust boundary. Boundary validation rejects bad input; it need not handle every well-formed combination.

**Optimize for comprehension, not minimum lines or maximum abstraction.** On the changed flow:
- Give each rule one owner; consume its decision at every real enforcement boundary. Central navigation is not command authorization.
- Make the main path, domain names, inputs/outputs and side effects explicit; avoid hidden mutation and ordering dependencies.
- Compose actual variation at its owning boundary. Shared components should not enumerate consuming workflows or duplicate their policy.
- Extract when a coherent responsibility or simpler reasoning outweighs indirection, not to meet size metrics. Share the same rule or operation, not merely similar syntax with different lifecycle semantics.

Use SOLID to diagnose current responsibility, contract and dependency problems, not to demand interfaces or future extension points. This guidance does not authorize unrelated refactoring, new requirements or reopening settled architecture. Report broader changes separately.

Apply the necessity decision on every revision, including research and review feedback. Remove mechanisms that only support unnecessary complexity; ask before changing an explicit approved requirement. Reusing behavior does not require transplanting its defensive mechanisms into a different flow.

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

Plan tests once for the whole change, from the user-visible flow inward. Build follows this plan and adds nothing beyond it.

- **Scenarios, not files.** List the few caller-level scenarios (request/system/job/integration spec) that prove the outcome end to end with real internal collaborators. Stub only external HTTP/vendor boundaries. For each: spec file (extend an existing one first), setup, trigger, asserted outcome or readback, and the regression it catches.
- **Choose the workflow owner.** For substantial browser-facing features, prefer one representative existing Playwright/system scenario spanning navigation, actions and persisted outcome; keep backend-only contracts and detailed permutations in focused integration tests. Name real/stubbed boundaries and optional same-run capture.
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
