---
name: design
description: Settle an approach and produce a codebase-verified, build-ready implementation specification. Use when asked to design a change, flesh out a plan, finalize the design, or make it ready for implementation. Stops at the specification; does not automatically build or deliver.
---

# Design

Decide what to build and write a specification a smaller model can implement in a fresh session. Resolve the architecture, product choices and core behavior rather than leaving the builder to guess. Use detail to remove ambiguity, not add speculative scope. Stop before implementation.

Start from research, a direct request or settled conversation context; no earlier workflow or document is required. Preserve settled decisions. Delegate bounded research or specification work when useful, but own the final design. Do not automatically start another session.

## 1. Agree the direction

Read research reports and their primary sources, not just summaries. Separate verified facts from assumptions. Then give a short direction checkpoint:

- **Outcome:** what changes for the user and how success will be checked.
- **Approach:** trace one real operation through the live code from entry to outcome. Identify what varies and who owns the decisions, data and effects before choosing files or classes.
- **Boundaries:** scope, non-goals, non-requirements and accepted trade-offs.
- **Questions:** at most 3 material flow questions, each with a default.
- **Slices:** for larger work, reviewable segments in dependency order, each with a useful result.

Reuse existing behavior. Compare alternatives only for a real unresolved trade-off and recommend one. If direction is already settled, restate it briefly and continue. If a choice would materially change behavior, scope or safety, stop at the checkpoint and ask; do not finish a spec on a guessed direction or assume approval.

## 2. Check the code and its callers

Read project instructions and the affected code and tests. Follow the actual entry points, shared functions and callers through inputs, decisions, permissions, persistence and effects. Verify research assumptions against live code; a report is a starting point, not a substitute for inspection.

When adding a writer, actor, client type, version or other variant, check how existing code consumes what it produces and what actions follow. A prescribed mechanism or an exclusion does not by itself approve changing an existing invariant. Raise that conflict unless the consequence was explicitly accepted.

Keep the exclusions and trade-offs agreed at the checkpoint, in conversation or in task memory. Do not silently restore excluded behavior. Choose the smallest complete change; prefer existing helpers, standard libraries, platform features and installed dependencies. Follow the project's domain model and conventions; avoid unrelated cleanup and a parallel architecture.

Read these guides when they apply:
- [Codebase Design](../codebase-design/SKILL.md) for consequential structural choices. Settle the caller contract, responsibility owners and important effects; carry the decision into the spec.
- `../vercel-react-best-practices/SKILL.md` for React work, plus `../vercel-composition-patterns/SKILL.md` for component APIs or architecture.

## 3. Keep only the mechanisms the change needs

For each proposed mechanism, explain the supported caller sequence, its consequence and why the existing owner is insufficient. A code citation, existing pattern or spec instruction is not enough. Recheck this when revising from research or review. Reusing behavior does not mean copying its defensive machinery; if a mechanism creates more edge cases, reconsider it before adding exceptions.

Do not add handling just for a hypothetical caller or artificial test state. Add race recovery, stale-state recovery, upstream re-checks or security hardening only for a real supported need, not an imagined failure. Raise recommended material hardening as a flow question and get agreement before including it.

Record notable exclusions as **considered-but-omitted**, so build does not add them. Keep entries brief; do not create an inventory of imagined failures or questions. Preserve approved requirements and surface conflicts.

**This does not waive authorization, malformed-input rejection at a trust boundary, privacy/PHI, money or data integrity on a real path, however uncommon.** UI behavior is not enforcement.

## 4. Write the implementation steps

Make the spec self-contained. State the objective, current and intended behavior, scope, exclusions and settled decisions. Include the repository/worktree, references and permissions; do not rely on “as discussed.”

Verify existing paths, symbols, interfaces and test commands. Mark new files and symbols as proposed. Resolve implementation-critical uncertainties; do not leave core locations as candidates for the builder to discover.

Give ordered steps. For each substantial step, name:

- **Location:** exact files and symbols to add, change, remove or reuse, plus what must stay unchanged.
- **Behavior:** inputs, outputs, types/interfaces, state transitions and connections between callers and components.
- **Rules and failures:** invariants, boundary validation, error handling and required branches. Tie each guard, fallback, recovery path or storage mechanism to its real trigger and consequence not already handled by another owner.
- **Proof:** the **Test plan** scenario that proves the step. Map steps to scenarios, not one test file per step or class.
- **Order and finish:** dependencies on earlier steps and a clear completion condition.

For consequential structural choices, name the owners and what genuinely varies; show a small code-shape sketch or diagram. Resolve the structure without prescribing every local helper or writing a speculative full implementation. Cover concurrency, cancellation, retries, compatibility and migrations only when the actual change needs them.

The builder may choose routine syntax and formatting, not architecture or intended semantics. Replace vague directions such as “handle errors,” “add tests” or “update callers” with the specific behavior, failure or caller involved.

## 5. Test plan

When writing the Test plan, read the [shared testing policy](../build/references/testing.md). Plan once for the whole change, from the user-visible flow inward; retained coverage may suffice.

- **Scenarios:** for each representative caller-level scenario, name the spec file, setup, trigger, asserted outcome/readback and regression it catches. Extend an existing spec first. Select supported actors, client types and versions where semantics differ; assert changed consumer decisions through those consumers, not just the new operation's success.
- **Execution:** name the workflow/spec that owns the proof and its real/stubbed boundaries. Note optional same-run capture for browser workflows; follow the shared policy's browser/backend split.
- **Deliberate omissions:** say what stays out, such as incidental log/metric shape, permutation matrices or guarantees another layer owns.
- **Consolidation:** name redundant specs and retained or replacement coverage before proposing merges or deletions.
- **Commands and gaps:** state commands, environmental prerequisites and remaining manual checks separately.

## 6. Return the spec and stop

Scale detail to the task, but keep what the builder needs to implement it. Include relevant risks, prerequisites and unresolved decisions. An acceptance checklist can help; the sections above are not a mandatory document template.

Mark the spec **ready for build** only when implementation-critical decisions and locations are resolved. Otherwise mark it **blocked** and name what must be decided or verified. Readiness is not user approval or permission to implement.

An unanswered flow question blocks only if its answer changes the core design. Otherwise state the default and omit the extra handling. End with a build handoff: approved direction, execution order, commands and expected results, prohibited changes (including omitted safeguards and tests outside the plan), final report requirements and stop condition.

Present the spec in conversation unless the user or workflow names another destination. Under delegation, return the spec body and relevant context for the parent to curate. When delegated through deliver, use its default final-answer report policy without a duplicate report file.

The standalone owner or parent preserves reusable design in one authoritative home; inline presentation alone is not preservation. Stop after the spec; do not automatically invoke `/skill:build`.
