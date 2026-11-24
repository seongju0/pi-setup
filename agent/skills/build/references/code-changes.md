# Shared code-change guidance

Use this guidance when planning, implementing, reviewing or delivering code changes. Reading it does not start Build or another workflow. The active stage retains its scope, permissions, decisions and output requirements; these are reasoning tools, not mandatory report headings or a checklist for every helper.

## Trace the supported outcome

Understand the user’s goal before choosing a mechanism. Follow a representative action through live callers, decision owners, state changes and consequential effects/failures. Read code in caller context, not every possible caller; check affected existing callers when a shared contract changes. Use project domain names and conventions.

When adding a writer, actor, client type, version or other variant, inspect existing readers and effects that consume its output. A new operation succeeding is insufficient if a consumer then makes the wrong decision. A supported uncommon path is real, not speculative.

## Make mechanisms earn their place

Choose the smallest complete change. Extend existing domain models and owners; avoid unrelated cleanup and parallel architectures. Before adding or recommending a guard, lock, re-check, recovery path, storage mechanism or abstraction, establish the triggering caller sequence, its plausibility and uncertainty, the consequence, and why the existing owner’s protection is insufficient. Do not duplicate another owner’s rule or machinery merely because it exists elsewhere.

A conceivable failure, artificial test state, code citation or prescribed mechanism does not establish a requirement. Leave speculative extras out. If material hardening is worth recommending, explain implementation and maintenance cost and get agreement before expanding scope. If a fix creates more edge cases, reconsider it before adding exceptions.

## Preserve contracts and agreed boundaries

Preserve approved outcomes, exclusions and accepted trade-offs; do not silently add guarantees or drop required behavior. A spec or exclusion does not approve breaking an existing consumer invariant. Surface concrete conflicts instead of blindly following the spec or redesigning it. New guarantees, policies, recovery behavior, storage or architectural contracts need a scope decision; they are not routine corrections. Routine syntax, behavior-preserving clarity and confirmed fixes to specified behavior at the existing owner are routine. Honor decisions already settled; do not ask again for an approved part of the change.

Authorization, malformed-input rejection at a trust boundary, privacy/PHI, money and data integrity remain required on real paths, however uncommon. UI behavior is not enforcement. Neither a safety label nor a principle expands authority: preserve required protections and escalate conflicts with accepted behavior or scope.

## Use principles as diagnostics

Name a principle only alongside the concrete burden, consequence and useful alternative it explains—not as a goal, score or finding by itself.

- **KISS:** prefer the simplest complete solution callers and maintainers can understand, not merely the fewest lines.
- **YAGNI:** omit speculative options, abstractions and guarantees; do not use it to dismiss existing consumers, required protections or meaningful verification.
- **DRY:** give one owner to the same rule or knowledge that must change together. Similar syntax with different responsibilities or reasons to change is not enough to justify coupling it behind modes or flags.
- **SOLID:** diagnose a present responsibility, contract or dependency problem, not a demand for interfaces, injection or extension points. Use [Codebase Design](../../codebase-design/SKILL.md) for consequential structural choices.
- **Pragmatism:** weigh supported user value, consequence, likelihood, implementation and maintenance cost. Follow existing conventions without treating them as proof; do not trade away correctness or safety for convenience.

## Match claims to evidence

Separate inspected behavior, reported results, executed checks and assumptions. Name meaningful uncertainty and the boundary a check proves; neither spec conformance nor worker confidence is verification. Use the [shared testing policy](testing.md) for test selection, collaborators and coverage; stage skills own their planning, audit and reporting duties.
