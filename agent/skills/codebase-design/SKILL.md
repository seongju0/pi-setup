---
name: codebase-design
description: Design and assess module boundaries, caller contracts, ownership and testability. Use for consequential structural choices during design, build or review, or when simplifying scattered orchestration and evaluating alternative interfaces.
---

# Codebase Design

Make the real flow easier to use, understand and change. Put coherent behavior behind a small, honest caller contract; concentrate decisions with their owner instead of making every caller reconstruct them. Add structure only when it reduces demonstrated complexity.

Apply this within the approved scope and the stage skill's necessity, safety and test policies. It does not authorize refactoring, new requirements or reopening settled decisions. Use the project's domain names and conventions, not a mandatory architecture vocabulary.

## Reduce the caller's burden

A module can be a function, class, package or coherent slice of behavior. Its interface is everything a caller must know: inputs and results, invariants, ordering, configuration, failure behavior, and consequential persistence, authorization or performance constraints—not just a type signature.

A **deep module** provides useful behavior behind a comparatively simple interface. Judge depth by the knowledge and coordination it removes from callers, not implementation size, method counts or lines of code. Ask what the ordinary caller must understand to use it correctly.

## Own a coherent operation

Prefer an operation that owns shared decisions and their ordering over callers repeatedly coordinating low-level steps:

```text
Before: callers each choose policy → coordinate steps → interpret failures
After:  callers → coherent operation → explicit outcome
                         └─ owns the shared decisions and ordering
```

Keep distinct permissions, lifecycles and responsibilities separate when they need different owners. Similar syntax alone is not a reason to merge flows. Consume an owner's decision at every real enforcement boundary; centralizing a rule does not remove authorization or input validation at a trust boundary.

## Make changes local, effects honest

Trace a representative behavior change. Does one owner hold the rule, or must several callers change together to preserve it? Prefer structure that concentrates relevant knowledge and verification without creating a catch-all service.

Use the **deletion test** as a diagnostic: if removing an abstraction removes complexity, it may be unnecessary; if its responsibilities would spread back across callers, it may earn its place. A thin wrapper can still protect a meaningful contract or isolate an external effect. Do not delete it merely for being small.

Hide implementation mechanics, not consequential effects. Keep writes, transaction boundaries, external calls, ordering requirements and partial failures clear in the contract. Prefer explicit inputs and results over hidden mutation where practical; effectful operations are legitimate, not something to disguise as pure computation.

## Put boundaries where they earn their place

A seam is a place where behavior can be substituted; an adapter supplies that behavior. Introduce one for actual variation, an external effect, a consequential contract or a coherent responsibility—not hypothetical flexibility or a pattern quota. Neither two production implementations nor a test fake is a prerequisite for a useful boundary.

Reuse project-native mechanisms:
- **In-process logic:** exercise real collaborators through the operation. No adapter is needed merely to compose functions.
- **Local infrastructure:** prefer existing isolated integration fixtures when persistence or infrastructure semantics matter. Do not introduce a substitute database or filesystem merely to satisfy an architecture pattern.
- **Owned remote services:** keep domain decisions with their owner and transport details at the appropriate boundary. A transport stub does not prove the remote service's behavior or cross-service persistence.
- **Third-party services:** isolate vendor interaction where useful and stub the external boundary for local tests; distinguish that confidence from real integration verification.

Do not force ports, adapters or dependency injection across the application. Add or change them only where the actual flow benefits.

## Test the meaningful interface

Exercise the operation real callers use with real internal collaborators. Assert results, persisted state and consequential effects, not incidental internal wiring. Do not stub the decision or writer the scenario claims to prove.

When consolidating implementation, replace redundant tests rather than layering another suite over the same guarantee—but delete only after identifying retained or replacement coverage. Preserve distinct authorization, rollback, partial-effect and compatibility protection. Keep focused tests for complex internal logic when they add unique confidence. Interface-level testing is not a ban on useful internal tests; follow the stage's test policy.

## Compare alternatives for a real choice

For an unresolved, consequential interface choice, sketch at least one materially different alternative before committing. Compare caller burden, ownership, change locality, seam placement and verification. Use a small caller example to expose differences; recommend the simplest approach that meets the supported flow and explain the relevant trade-off.

Scale the exercise to the decision. A brief local comparison may suffice; use independent agents only when they add useful scrutiny under the global delegation rules. Do not manufacture flexibility requirements, mandate agent fan-out or reopen accepted architecture. This is a reasoning tool, not an extra approval ceremony or required document.

## Sources and adaptation

Synthesized from Matt Pocock's [Codebase Design](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md), [Deepening](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DEEPENING.md), and [Design It Twice](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DESIGN-IT-TWICE.md).

Retains depth, locality, explicit contracts and alternative designs as practical diagnostics; deliberately does not adopt mandatory terminology, adapter counts, blanket unit-test deletion or automatic multi-agent design exercises.
