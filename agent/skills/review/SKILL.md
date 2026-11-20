---
name: review
description: Review code changes for correctness, regressions, conventions, maintainability and relevant performance issues. Use when asked to review a diff, review the implementation, or check code changes. Read-only; does not automatically fix findings or publish.
---

# Code Review

Review the requested change without editing files. If no scope is given, review staged and unstaged changes against `HEAD`.

## 1. Establish intent and scope

Read the diff, surrounding code, supplied plan/spec and primary references. Find repository guidance along the changed files' directory ancestry; follow relevant references, not unrelated documentation.

Establish supported behavior, exclusions and accepted trade-offs before judging. Trace affected callers through to their outcomes. A spec describes intent; it does not prove a mechanism is needed or the outcome is correct.

For a new writer or newly admitted actor, client or variant, check the existing readers and effects that consume its output. A prescribed mechanism or exclusion does not approve changing an existing invariant. If it conflicts with a business contract, escalate rather than silently reopening or fixing it.

For React/Next changes, apply `/skill:vercel-react-best-practices`; also read `/skill:vercel-composition-patterns` for component APIs or composition design.

## 2. Inspect the whole affected flow

Cover the affected flow on the first pass. Use the relevant dimensions below; these are reasoning prompts, not scores or mandatory report sections. Strength in one dimension does not compensate for a defect in another.

| Dimension | Establish |
| --- | --- |
| **Business correctness** | The supported user sequence produces the intended business outcome and preserves established invariants—not merely spec conformance. |
| **State, consumers and effects** | Existing consumers interpret new records/events correctly; required downstream decisions and effects are preserved or intentionally changed. |
| **Actors, variants and trust boundaries** | Admitted actors, client types and versions with materially different paths have correct authorization, context, privacy and evidence semantics. |
| **Compatibility and failure contracts** | Existing callers retain intended inputs, results, errors and partial-effect behavior when shared helpers or interfaces change. |
| **Necessity and code quality** | Mechanisms serve supported needs; responsibilities are coherent, code is understandable and follows conventions, and performance concerns have concrete consequences. Check parallel workflows, scattered mode checks, misleading names and obscuring indirection within the change. |
| **Verification and assurance** | Tests protect the meaningful caller-to-outcome and consumer contracts; the review's scope, checks and remaining gaps support its conclusion. Apply **Test review** below. |

For consequential structural changes, read [Codebase Design](../codebase-design/SKILL.md). Assess caller burden, scattered policy, change locality and contracts that make consequential effects explicit—not conformity to a preferred pattern. A readability finding must name a concrete reasoning burden, maintenance impact and smaller clear alternative.

## 3. Separate defects from speculative extras

Challenge unnecessary mechanisms even when the spec prescribes them. Guards, locks, re-checks, recovery paths and abstractions must serve a supported flow, not duplicate another owner's protection. Preserve approved outcomes; surface conflicts without redefining requirements or demanding an unrelated redesign. If a fix creates more edge cases, reconsider it before adding exceptions.

A missing-guard concern must name:
- The triggering caller sequence.
- Its plausibility and uncertainty.
- The consequence.
- Why existing validation, policy ownership or retained coverage is insufficient.

A constructible race, failure or attack is not by itself a required fix. Decline speculative extras instead of making them findings or questions. If material hardening is worth recommending, explain its implementation and maintenance cost and distinguish it from a confirmed defect in required behavior.

Do not revive accepted non-requirements without a concrete conflict. A supported actor, version or existing consumer reached by the change is a real path, not speculation.

**These defaults do not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity on a real path, however uncommon.** UI behavior is not enforcement. A security label grants no extra scope or permissions; surface material conflicts with accepted behavior or trade-offs.

## 4. Test review

For every Test review, read the [shared testing policy](../build/references/testing.md), including when no tests changed. Audit every changed test on the first pass, not just missing coverage; judge distinct regression protection rather than test volume.

- **Trace the claimed guarantee.** Check caller-to-outcome and consumer contracts against the actual setup and assertions. Do not demand browser coverage without a browser-facing contract.
- **Audit meaningful mocks.** For internal decision, writer or orchestration stubs, name the wrong behavior that still passes because the stub bypasses the claimed guarantee. Mock use alone does not make a test tautological.
- **Identify retained protection.** Name retained coverage before recommending merges or deletions; preserve distinct protections required by the shared policy. A redundant test is not necessarily tautological.
- **Make missing coverage earn its place.** Name the plausible regression, affected consumer, why retained tests miss it and the smallest catching scenario/assertion. Calibrate severity to consequence and likelihood; absent coverage alone is not a major defect.
- **Separate evidence from confidence.** Passing suites, schema validation and fault injection prove different things. State remaining verification gaps without automatically requesting manual end-to-end testing.

## 5. Report findings, questions and limits

Use the repository's severity scale. If none is defined:
- **Critical:** severe security, privacy, integrity or availability harm.
- **Major:** material breakage of a supported workflow or business invariant.
- **Minor:** bounded lower-impact correctness, usability or maintainability issues.

Judge severity by consequence, realistic triggering conditions and existing mitigation—not diff size, missing tests alone, a security label or uncertainty about the remedy. Optional suggestions need a demonstrated benefit and remain optional.

Report:
- **Confirmed, actionable findings:** severity, `file:line`, impact and the smallest justified correction or decision needed. A defect can be confirmed even if its fix needs a product or scope decision. No taste-based findings or unsupported blockers; no findings is valid.
- **Flow questions, separately:** the sequence needing confirmation and why it matters. An unconfirmed concern is not automatically a required fix or blocker. If its answer could change the correctness verdict on a consequential path, resolve it from code where practical; otherwise qualify the verdict instead of reporting that flow clean.
- **Test review:** actionable merge/delete/repair recommendations with retained protection, justified missing tests and proposed net delta in files/scenarios. Otherwise say “no test changes recommended” or “no test changes to review,” as appropriate. Skip routine keep receipts.
- **Scope and limits:** what was reviewed, checks actually performed and material unreviewed risks.

Spec conformance or a worker's confidence is not verification. A clean patch review is not whole-feature approval.
