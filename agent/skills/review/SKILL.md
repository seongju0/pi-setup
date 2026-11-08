---
name: review
description: Review a code change for correctness, regressions, conventions, maintainability, and relevant performance issues. Use when asked to review a diff or implementation.
---

# Code Review

Review the requested change. If none is specified, review staged and unstaged changes against `HEAD`. Do not edit files.

## Establish intent and scope

- Read the diff, relevant surrounding code, implementation plan/spec and primary references named in the request. Find repository guidance in the changed files' directory ancestry; follow relevant references, not unrelated documentation broadly.
- Establish supported behavior, exclusions and accepted trade-offs before judging. Trace affected callers and outcomes; a spec describes intent but does not prove its mechanism is necessary.
- For relevant React/Next changes, apply `/skill:vercel-react-best-practices`; also read `/skill:vercel-composition-patterns` for component API or composition design. Follow the global AGENTS.md memory and delegation contract; worker confidence or severity is not evidence for added behavior.

## Inspect the changed flow

Review the whole affected flow on the first pass: correctness, conventions, relevant performance, responsibility owners, data transformations and consequential effects. Check parallel workflows, scattered mode checks, misleading names and obscuring indirection within the change.

For consequential structural changes, read [Codebase Design](../codebase-design/SKILL.md). Assess caller burden, scattered policy, change locality and honest effect contracts—not conformity to a preferred pattern. A readability finding must identify a concrete reasoning burden, maintenance impact and smaller clear alternative.

Challenge unnecessary mechanisms even when prescribed by the spec: guards, locks, re-checks, recovery paths and abstractions must serve a real supported flow rather than duplicate an existing owner's protection. Preserve approved outcomes and surface conflicts; do not silently redefine requirements or demand an unrelated redesign. If a proposed fix creates more edge cases, reconsider its mechanism before requesting exceptions.

A missing-guard concern must name the triggering caller sequence, consequence and why existing validation, policy ownership or retained coverage is insufficient. Hypothetical callers, artificial test states, rare user-action races, brief staleness and upstream re-checks are non-requirements unless requested.

**These defaults do not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity.** UI behavior is not enforcement. A security label does not expand scope or permissions; surface material conflicts with accepted behavior or trade-offs.

## Test review

Audit every changed test on the first pass, not just missing coverage. Apply [Codebase Design's interface-testing principles](../codebase-design/SKILL.md#test-the-meaningful-interface) and judge distinct regression protection rather than test volume.

- **Trace caller to outcome.** Check realistic inputs, real internal collaborators and assertions on results, persisted readback or consequential effects. For substantial browser-facing workflows, favor one representative existing Playwright/system scenario spanning navigation, actions and persisted outcome; keep backend contracts and detailed permutations in focused integration tests. Do not demand browser coverage without a browser-facing contract.
- **Audit meaningful mocks.** External HTTP/vendor boundaries can be stubbed. For internal decision, writer or orchestration stubs, name the wrong behavior that still passes because the stub bypasses the claimed guarantee. Mock use alone does not make a test tautological.
- **Select by risk.** Look for representative success and distinct failure, authorization, transaction or retry protection where applicable—not every constructible permutation. Focused tests for complex logic are justified by protection caller-level scenarios do not adequately provide, not purity. Do not request a file per class.
- **Keep one contract owner.** Identify duplicate guarantees and name retained coverage before recommending merges or deletions. Preserve distinct rollback, security/privacy, partial-effect, compatibility and wrong-actor protection. A redundant test is not necessarily tautological.
- **Reject incidental observability testing.** Logger wording, metric tags and payload shapes need an explicit acceptance criterion or consequential consumer, such as an alert, audit record or functional payload contract. Even for observability work, prefer a few contract assertions in real scenarios over mock-only shape matrices.
- **Make missing coverage earn its place.** Name the plausible regression, affected consumer, why retained tests miss it and the smallest catching scenario/assertion. Calibrate severity to consequence and likelihood; absent coverage alone is not a major defect.
- **Recommend the smallest correction.** Extend a scenario, repair a bypassing stub or consolidate coverage before requesting files, fixtures or harnesses. Coverage percentages, test-to-code ratios, convention and “new code needs tests” do not justify additions. Honor explicit project checks and constraints; surface conflicts.
- **Separate evidence from confidence.** Passing suites, schema validation and fault injection prove different things. State remaining verification gaps without automatically requesting manual end-to-end testing.

## Report

- Report only confirmed, actionable findings, with severity, `file:line`, impact and minimal correction. No taste-based findings or unsupported blockers; no findings is a valid result.
- Put unresolved flow questions separately, naming the sequence that needs confirmation and why it matters. An unconfirmed concern is not a required fix or a blocker.
- Include a short **Test review**: actionable merge/delete/repair recommendations with retained protection, justified missing tests and proposed net delta in files/scenarios. Otherwise say “no test changes recommended” or “no test changes to review,” as appropriate; do not list routine keep receipts.
- Name the reviewed scope, checks actually performed and material unreviewed risks. Do not equate spec conformance or a worker's confidence with verification.
