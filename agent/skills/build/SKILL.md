---
name: build
description: Execute an approved implementation specification or sufficiently explicit user request efficiently and cleanly. Use when the intended behavior and approach are settled and implementation is requested.
---

# Build

Carry out the approved implementation specification; do not reopen settled product or design decisions.

The usual sequence is research → design → build, but no prior skill invocation or particular artifact is required. Use the provided design, an explicit user request, or sufficiently settled conversation context. A spec labeled ready for build is not user approval by itself. Do not require a separate planning/design ceremony for straightforward work, and do not automatically start another session.

1. Read project instructions, the supplied specification/context, and the relevant code/tests before editing. Resolve the repository/worktree, intended behavior, constraints, permissions, acceptance checks, and stop condition. Trace the affected flow and reuse existing patterns.
2. Follow the specification's execution order and file-level guidance. Keep the diff focused; prefer the simplest implementation that meets the requirements and codebase conventions. Avoid speculative abstractions and unrelated cleanup.
3. If the specification conflicts with the live code, lacks an implementation-critical decision, or a material constraint makes it unsafe/incomplete, pause and report the specific gap instead of silently redesigning. Resolve minor implementation details using local conventions.
   If a specified mechanism conflicts with settled non-requirements or exists solely to support another apparently unnecessary mechanism, flag the contradiction before implementing that portion. Do not silently remove approved behavior or implement speculative scaffolding merely because it appears in the spec.
   Behavior-preserving clarity improvements and confirmed fixes to specified behavior at its existing owner are in scope. New guarantees, policies, recovery behavior, storage or architectural contracts require a scope decision, including guards, locks or fallbacks beyond specified behavior. Do not add them as routine corrections. Report confirmed supported-flow gaps or spec conflicts with the triggering sequence, not hypothetical gap inventories. Settled non-requirements stay out. A security label does not expand authorization: escalate changes that materially alter approved behavior or conflict with an accepted trade-off.
4. Follow the spec's test plan; without one, apply the **required spec policy** below. If a confirmed gap needs coverage beyond the plan, report the regression and smallest correction rather than silently expanding the plan. No new test is a valid outcome when retained coverage already protects the change.
5. **Read the implementation diff for clarity before reporting.** Check the main path, names, nesting, data reshaping, duplicate rules, and unnecessary indirection against **Necessity and design** below. Improve the touched path without expanding scope or changing behavior. Apply the same standard to delegated code; no extra report template is required.
6. **Audit every changed test.** Internally identify its behavior and unique regression signal; consolidate duplicate coverage and repair stubs that bypass that behavior. Report a short test delta (files/scenarios added or removed and internal stubs left with reasons), not a per-scenario inventory.
7. Run the smallest relevant checks, plus broader checks when warranted. Report the change, verification/results, and any confirmed gaps, spec conflicts or blockers. Do not claim checks passed unless run. For delegated work, follow the global AGENTS.md contract; inspect returned code and findings against the same scope and necessity decisions.

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

## Required spec policy: smallest useful correction

**Maximize confidence per scenario, not test count.** Every added or updated spec must protect a named behavior and catch a plausible regression that no cheaper retained test catches. Tests are part of the diff budget, not proof of diligence.

- **Start at the caller.** Exercise the entry point the caller actually uses with realistic inputs and real internal collaborators. Assert returned results, persisted state/readback, or externally observable effects. For substantial browser-facing workflows, prefer one representative existing Playwright/system scenario spanning navigation, actions and persisted outcome. Keep backend-only contracts and detailed permutations in focused integration tests; do not duplicate them across layers.
- **Mock external boundaries, not the behavior under test.** Stub third-party HTTP, vendor SDKs, and other genuinely external effects. Do not stub internal decisions, writers, or orchestration whose correctness the scenario claims to establish. Avoid negative assertions made inevitable by a stub, vacuous records, and copied implementations.
- **Cover distinct outcomes, not every permutation.** Select representative success, meaningful failure, and applicable authorization/transaction/retry scenarios. Keep exhaustive permutations in focused unit tests only when complex logic genuinely needs them; use real inputs and outputs there too.
- **Fewer, flow-level files.** One caller-level spec per behavior beats a spec file per new class. A class exercised by a flow scenario does not get its own spec file unless it holds complex logic.
- **One owner per contract.** Extend an existing scenario before adding a file or fixture-heavy setup. Do not repeat the same guarantee at every layer. Preserve distinct rollback, security/privacy, external partial-effect, compatibility, and wrong-actor protections.
- **Do not test incidental observability.** Logger calls, message wording, metric names/tags, and payload shapes do not earn specs merely because they were added. A narrow exception requires an explicit acceptance criterion or consequential consumer, such as an alert powered by the metric, a security audit record, or a functional payload contract. Assert that contract in an existing real scenario; do not build a mock-only shape matrix. An observability-only deliverable can qualify, but not every emitted field needs a test.
- **Prove the changed path.** Before keeping an assertion, name the realistic wrong behavior that would make it fail and check that setup/mocks do not bypass that behavior. Avoid assertions tied to harmless refactoring; use controlled clocks.
- **Automate what can be proved reliably.** Aim to replace repetitive local manual checks with repeatable caller-to-outcome coverage. Do not claim absolute confidence or skip necessary browser, integration, or production-specific verification; report the remaining gap.
- **Choose the smallest useful correction.** Add a few assertions to retained scenarios before introducing a new suite, shared harness, or exhaustive matrix. Never justify tests by coverage percentages, test-to-code ratios, convention alone, or “new code needs tests.” Honor explicit project checks and test constraints; surface conflicts rather than ignoring them. Do not automatically delete existing coverage.
