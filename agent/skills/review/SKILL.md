---
name: review
description: Review a code change for correctness, regressions, conventions, maintainability, and relevant performance issues. Use when asked to review a diff or implementation.
---

# Code Review

Review the requested change. If none is specified, review staged and unstaged changes against `HEAD`.

- Establish intended behavior before judging: read the diff and relevant surrounding code, then consult the implementation plan/spec and docs explicitly referenced in the request or session. Find applicable repository guidance in the changed files' directory ancestry. Follow relevant references only; don't read unrelated docs broadly. Trace affected callers and behavior, and check tests against the intended requirements.
- Report only confirmed, actionable findings. For each, include severity, `file:line`, impact, and a minimal fix. Do not invent taste-based stylistic findings. Readability findings must identify a concrete reasoning burden, its maintenance impact, and a smaller clear alternative—not merely invoke clean code or SOLID. Calibrate severity to the impact; no readability findings is a valid outcome. If none, say so and name any material unreviewed risk.
- **Inspect the whole changed flow in the first pass, unasked.** Apply **Necessity and design** below: trace the ordinary operation, rule owners, data transformations and side effects. Check correctness and conventions alongside parallel workflows, scattered mode checks, misleading names and obscuring indirection. Keep findings within the change.
- **Review the mechanism, not just spec conformance.** Preserve approved outcomes, but challenge prescribed mechanisms that contradict non-requirements or only support unnecessary machinery. Being specified does not justify complexity; identify the conflict rather than silently changing the requirement.
- **Unjustified complexity is a finding.** Flag added guards, locks, re-checks, recovery paths, duplicate policy checks and abstractions that no real flow triggers, or that an owning component already covers. Treat the spec's non-requirements as settled.
- **A missing-guard finding must name the supported sequence**, not merely a caller name, and explain why existing validation, policy ownership, or retained coverage is insufficient. If unconfirmed, label it *needs flow confirmation* with a concrete scenario question, not a blocker or required change.
- **Always audit changed tests in the first pass, unasked**, using the required spec review below. Hunt duplicate guarantees, bypassing stubs, non-discriminating assertions and permutation matrices as hard as missing coverage.
- **Output a short "Test review" section:** list only actionable merge/delete/repair recommendations, naming retained coverage for deletions, and justified missing-test findings. State the proposed net delta (files/scenarios); if none, say no test changes recommended. Do not produce rows merely saying "keep". Say "no test changes to review" when applicable.
- For relevant React/Next changes, apply `/skill:vercel-react-best-practices` and read `/skill:vercel-composition-patterns` when component API or composition design is involved. Follow the global AGENTS.md contract for delegated work; a worker's severity or confidence is not justification for added behavior.
- Do not edit files.

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

## Required spec review: smallest useful correction

**Judge confidence in the changed behavior, not the amount of test code.** Review every added or updated scenario for unique regression signal and inspect retained coverage before requesting more.

- **Trace caller to outcome.** Prefer realistic caller-level scenarios with real internal collaborators and assertions on results, persisted readback, or external effects. For substantial browser-facing workflows, favor one representative existing Playwright/system scenario spanning navigation, actions and persisted outcome. Keep backend-only contracts and detailed permutations in focused integration tests; do not demand browser coverage for changes without a browser-facing contract.
- **Audit every meaningful mock.** External HTTP/vendor boundaries are appropriate to stub. Flag internal decision/writer/orchestration stubs when they bypass what the test claims to prove. Identify the concrete wrong behavior that still passes; do not call a test tautological merely because it uses a mock.
- **Select scenarios by risk.** Require representative success and meaningful failure/authorization/transaction/retry coverage where applicable, not a matrix of every branch or malformed artificial object. Focused unit permutations are justified only for complex logic not adequately protected by caller scenarios.
- **Prefer fewer, flow-level files.** Flag a new spec file per new class when a caller-level scenario already exercises it; propose merging into the flow spec.
- **Keep one contract owner.** Identify duplicate guarantees across layers and name the retained test that protects them. Preserve genuinely distinct rollback, security/privacy, external partial-effect, compatibility, and wrong-actor boundaries. A real but redundant test is not tautological.
- **Reject incidental logger/metric shape testing.** Do not request assertions on log calls, wording, metric tags, or payload fields merely because those lines changed or neighboring specs do so. Require an explicit acceptance criterion or consequential consumer, such as a metric-backed alert, security audit record, or functional payload contract. Even for an observability deliverable, prefer a few contract assertions in existing real scenarios over exhaustive mock-only shape tests.
- **Make a missing-test finding earn its place.** Name the plausible regression, affected caller/consumer, why retained tests miss it, and the smallest scenario/assertion that catches it. Calibrate severity to the consequence and likelihood; absent coverage alone does not establish a major production defect.
- **Propose the smallest useful correction.** Prefer extending an existing scenario, repairing a bypassing stub, or consolidating duplicate coverage over adding files, fixtures, harnesses, or branch-by-branch suites. Recommend deletion only with retained regression protection; do not remove coverage just to shrink the diff.
- **Separate evidence from confidence claims.** Passing suites, API/schema validation, and fault injection prove different things; none guarantees end-to-end correctness. State the remaining verification gap without defaulting to manual E2E testing. Coverage percentages, test-to-code ratios, “standard practice,” and “new code needs tests” are not sufficient justification. Honor explicit project checks and test constraints; surface conflicts.
