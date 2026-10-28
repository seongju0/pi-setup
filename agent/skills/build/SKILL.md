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
   Do not add a guard, fallback, recovery path, lock or abstraction the spec does not call for, however small. If you spot a possible gap, list it under "possible gaps not handled" in the report with its scenario; do not code it. Items the spec lists as non-requirements or considered-but-omitted stay out.
4. Follow the spec's test plan; without one, apply the **required spec policy** below. Do not add spec files or scenarios beyond the plan; if one seems needed, list it under "possible gaps not handled". No new test is a valid outcome when retained coverage already protects the change.
5. **Audit your test diff before reporting.** For each added or changed spec file and scenario, name the behavior and the regression it catches. Merge per-class files into the flow-level spec, delete scenarios a retained test already covers, and replace stubs of internal code with the real collaborator. Report the test delta: spec files added/changed/removed, scenarios added, internal stubs left (expected: none) with reasons.
6. Run the smallest relevant checks, plus broader checks when warranted. Report what changed, files touched, verification and results, possible gaps not handled, and any blocker/follow-up. Do not claim checks passed unless run.

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

## Delegation contract

Use the global AGENTS.md delegation contract: assign a bounded outcome with the supported flow, settled decisions, non-requirements, accepted trade-offs and permissions. Identify required stage skills and require full reads per the global delegation contract. This does not authorize work beyond the request or override workflow-required stage separation.

The delegating agent remains responsible for checking returned work against those constraints before incorporating it. A child's confidence, severity label, or code citation does not establish that additional behavior is required. No findings or no additional changes is a valid outcome.

## Required spec policy: smallest useful correction

**Maximize confidence per scenario, not test count.** Every added or updated spec must protect a named behavior and catch a plausible regression that no cheaper retained test catches. Tests are part of the diff budget, not proof of diligence.

- **Start at the caller.** Exercise the entry point the caller actually uses with realistic inputs and real internal collaborators. Assert returned results, persisted state/readback, or externally observable effects. Prefer a focused integration scenario over a browser test when it proves the same contract.
- **Mock external boundaries, not the behavior under test.** Stub third-party HTTP, vendor SDKs, and other genuinely external effects. Do not stub internal decisions, writers, or orchestration whose correctness the scenario claims to establish. Avoid negative assertions made inevitable by a stub, vacuous records, and copied implementations.
- **Cover distinct outcomes, not every permutation.** Select representative success, meaningful failure, and applicable authorization/transaction/retry scenarios. Keep exhaustive permutations in focused unit tests only when complex logic genuinely needs them; use real inputs and outputs there too.
- **Fewer, flow-level files.** One caller-level spec per behavior beats a spec file per new class. A class exercised by a flow scenario does not get its own spec file unless it holds complex logic.
- **One owner per contract.** Extend an existing scenario before adding a file or fixture-heavy setup. Do not repeat the same guarantee at every layer. Preserve distinct rollback, security/privacy, external partial-effect, compatibility, and wrong-actor protections.
- **Do not test incidental observability.** Logger calls, message wording, metric names/tags, and payload shapes do not earn specs merely because they were added. A narrow exception requires an explicit acceptance criterion or consequential consumer, such as an alert powered by the metric, a security audit record, or a functional payload contract. Assert that contract in an existing real scenario; do not build a mock-only shape matrix. An observability-only deliverable can qualify, but not every emitted field needs a test.
- **Prove the changed path.** Before keeping an assertion, name the realistic wrong behavior that would make it fail and check that setup/mocks do not bypass that behavior. Avoid assertions tied to harmless refactoring; use controlled clocks.
- **Automate what can be proved reliably.** Aim to replace repetitive local manual checks with repeatable caller-to-outcome coverage. Do not claim absolute confidence or skip necessary browser, integration, or production-specific verification; report the remaining gap.
- **Choose the smallest useful correction.** Add a few assertions to retained scenarios before introducing a new suite, shared harness, or exhaustive matrix. Never justify tests by coverage percentages, test-to-code ratios, convention alone, or “new code needs tests.” Honor explicit project checks and test constraints; surface conflicts rather than ignoring them. Do not automatically delete existing coverage.
