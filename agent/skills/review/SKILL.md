---
name: review
description: Review a code change for correctness, regressions, conventions, maintainability, and relevant performance issues. Use when asked to review a diff or implementation.
---

# Code Review

Review the requested change. If none is specified, review staged and unstaged changes against `HEAD`.

- Establish intended behavior before judging: read the diff and relevant surrounding code, then consult the implementation plan/spec and docs explicitly referenced in the request or session. Find applicable repository guidance in the changed files' directory ancestry. Follow relevant references only; don't read unrelated docs broadly. Trace affected callers and behavior, and check tests against the intended requirements.
- Report only confirmed, actionable findings. For each, include severity, `file:line`, impact, and a minimal fix. Do not invent stylistic findings. If none, say so and name any material unreviewed risk.
- Focus on correctness, regressions, missing behavior-protecting tests, conventions, and complexity that materially obscures the main path.
- **Unjustified complexity is a finding.** Flag added guards, locks, re-checks, recovery paths, duplicate policy checks and abstractions that no real flow triggers, or that an owning component already covers. Treat the spec's non-requirements as settled.
- **A missing-guard finding must name the supported sequence**, not merely a caller name, and explain why existing validation, policy ownership, or retained coverage is insufficient. If unconfirmed, label it *needs flow confirmation* with a concrete scenario question, not a blocker or required change.
- **Challenge the mechanism before repairing it.** When a safeguard causes another failure, first ask whether that safeguard is required. Recommend removing unnecessary complexity rather than adding exceptions around it; do not remove explicit requirements or necessary trust-boundary protections.
- **Always run the required spec review below** on any change that adds or edits tests, in the first pass, unasked. Hunt bloat as hard as gaps: per-class spec files, internal stubs, duplicated guarantees, permutation matrices. Missing direct assertions are not automatically a defect; new tests are not automatically useful.
- **Output a "Spec review" section**: for each added or changed spec file, *keep* / *merge into X* / *delete (covered by Y)* / *repair stub*, with one-line reason, then the proposed net delta (files, scenarios). Say "no test changes" if none.
- Identify unnecessary abstraction or scope; prefer the smallest complete change that meets the requirements. For relevant React/Next changes, apply `/skill:vercel-react-best-practices` and read `/skill:vercel-composition-patterns` when component API or composition design is involved.
- Do not edit files.

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

When delegation is authorized, include the supported user flow, settled decisions, explicit non-requirements, accepted trade-offs, and permission boundaries in the assignment itself. Do not rely on inherited conversation context or a skill-path reference alone. Require the child to read the applicable skill before working; for review work, that includes `../review/SKILL.md`. These constraints apply equally to research, design, implementation, and review. This contract does not authorize delegation.

The delegating agent remains responsible for checking returned work against those constraints before incorporating it. A child's confidence, severity label, or code citation does not establish that additional behavior is required. No findings or no additional changes is a valid outcome.

## Required spec review: smallest useful correction

**Judge confidence in the changed behavior, not the amount of test code.** Review every added or updated scenario for unique regression signal and inspect retained coverage before requesting more.

- **Trace caller to outcome.** Prefer realistic caller-level scenarios with real internal collaborators and assertions on results, persisted readback, or external effects. A focused integration test can replace repetitive manual checks without paying for a full browser E2E suite.
- **Audit every meaningful mock.** External HTTP/vendor boundaries are appropriate to stub. Flag internal decision/writer/orchestration stubs when they bypass what the test claims to prove. Identify the concrete wrong behavior that still passes; do not call a test tautological merely because it uses a mock.
- **Select scenarios by risk.** Require representative success and meaningful failure/authorization/transaction/retry coverage where applicable, not a matrix of every branch or malformed artificial object. Focused unit permutations are justified only for complex logic not adequately protected by caller scenarios.
- **Prefer fewer, flow-level files.** Flag a new spec file per new class when a caller-level scenario already exercises it; propose merging into the flow spec.
- **Keep one contract owner.** Identify duplicate guarantees across layers and name the retained test that protects them. Preserve genuinely distinct rollback, security/privacy, external partial-effect, compatibility, and wrong-actor boundaries. A real but redundant test is not tautological.
- **Reject incidental logger/metric shape testing.** Do not request assertions on log calls, wording, metric tags, or payload fields merely because those lines changed or neighboring specs do so. Require an explicit acceptance criterion or consequential consumer, such as a metric-backed alert, security audit record, or functional payload contract. Even for an observability deliverable, prefer a few contract assertions in existing real scenarios over exhaustive mock-only shape tests.
- **Make a missing-test finding earn its place.** Name the plausible regression, affected caller/consumer, why retained tests miss it, and the smallest scenario/assertion that catches it. Calibrate severity to the consequence and likelihood; absent coverage alone does not establish a major production defect.
- **Propose the smallest useful correction.** Prefer extending an existing scenario, repairing a bypassing stub, or consolidating duplicate coverage over adding files, fixtures, harnesses, or branch-by-branch suites. Recommend deletion only with retained regression protection; do not remove coverage just to shrink the diff.
- **Separate evidence from confidence claims.** Passing suites, API/schema validation, and fault injection prove different things; none guarantees end-to-end correctness. State the remaining verification gap without defaulting to manual E2E testing. Coverage percentages, test-to-code ratios, “standard practice,” and “new code needs tests” are not sufficient justification. Honor explicit project checks and test constraints; surface conflicts.
