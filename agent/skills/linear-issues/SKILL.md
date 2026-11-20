---
name: linear-issues
description: Create, rewrite, split, review, align, or update Linear issues and milestones. Use for drafting or changing titles, descriptions, deliverables, dependencies, status, or milestone sequencing. Keep outcomes, ownership, and completion criteria clear; preserve tracker metadata and verify authorized changes.
---

# Linear Issues

Help the next reader understand what an issue or milestone delivers, who owns it, and when it is done. Keep the tracker consistent with the authorized scope, not a transcript of the planning session.

## Workflow

**Draft, plan, or review means no Linear mutation.** Present the proposed scope, title, deliverables, and relation changes; a later instruction such as `apply` authorizes the agreed write set. A direct request to create or update authorizes that work without another approval round unless a material scope decision remains unresolved.

1. **Read the current state.** For an existing issue, read its full description, status, relations, milestone, and directly related tickets. Check linked PR status when checkboxes or current scope depend on it. For a new issue, inspect nearby tickets and the milestone for local conventions. For milestone work, read its description, metadata, and affected issues so sequencing matches the actual work.
2. **Draft only the requested change.** Use the writing guidance below for authored content. Keep unresolved decisions open rather than selecting an implementation prematurely. A status-only or metadata-only request does not authorize rewriting the description.
3. **Review before presenting or applying.** Can a reader scan the purpose, boundaries, ownership, and end state? Is every checkbox verifiable? Are invariants, legacy behavior, rollout gates, and open decisions visible? Check whether a blocker applies to the whole issue and remove speculative or stale prose within the authorized scope.
4. **Present or apply according to the request.** For draft-only work, return the proposal and stop. To apply, use the available Linear tools; if they are unavailable, report the prerequisite rather than introducing another provider.
   - Preserve assignee, priority, cycle, project, milestone, labels, attachments, status, and unrelated relations unless the approved plan changes them.
   - Prefer targeted description patches for small edits and a full replacement for an approved rewrite.
   - Change descriptions and relation metadata together when a split or scope move would otherwise leave the tracker contradictory.
   - Never mark a deliverable complete from assumption.
5. **Refetch every changed issue and milestone.** Confirm title, description, and intended field changes landed; checkbox state matches verified work; status and milestone are correct; blockers and related links reflect the new scope; and canceled or superseded work no longer blocks active delivery. Report changed issue and milestone links and any field the available tools could not update.

## Writing issues and milestones

Apply [Walkthrough](../walkthrough/SKILL.md) for the shared writing and illustration method. Keep issues high-level, succinct, and understandable without the planning conversation. Preserve details that change implementation or delivery; remove detail that only proves how much analysis happened.

For issues, a reader should understand the purpose, shape, boundaries, and end state by scanning the title, `Goal`, and `Done means`. Adapt milestone descriptions to their outcome and sequence rather than forcing an issue template.

### Standard shape

Use this flexible structure unless the team or active workflow requires a stricter format:

```markdown
## Goal

<One outcome in one or two sentences.>

## Shape

<A small flow, ownership diagram, or short explanation of how the pieces connect.>

## Scope

- [ ] <Concrete outcome included in this issue>
- [ ] <Concrete outcome included in this issue>

## Out of scope

- <Adjacent behavior this issue must not change or deliver>

## Done means

<The observable end state and focused acceptance checks, in plain language.>
```

Omit `Shape` when a visual or explanation would only repeat the goal. Do not add sections merely to make the ticket look complete. Add `Why`, `Still open`, rollout, or compatibility notes only when they carry information the implementer must not miss. Do not repeat the same outcome in every section.

## Writing rules

### Title

- Name the outcome, not the project, implementation phase, or team activity.
- Prefer a direct verb: `Render`, `Establish`, `Release`, `Prevent`, `Complete`.
- Make sibling tickets distinguishable without opening them.
- Avoid titles such as `Handle`, `Support changes`, `Phase 2`, or `Improvements` unless the missing noun is genuinely obvious.

### Goal

- State one outcome.
- Do not put implementation steps here.
- If the sentence needs `and` to join independently shippable outcomes, consider splitting the ticket.

### Shape

- Explain what this layer delivers and owns, its input, and its handoff. Show the smallest useful flow or responsibility boundary; let a diagram carry connections rather than repeating every arrow in prose.
- Name existing concepts; do not imply a new model or framework unless that change is in scope.
- Keep important guarantees and limits explicit beside the explanation.

### Scope

- Describe included outcomes at the behavior or responsibility level, not as a file-by-file implementation plan.
- Use Markdown checkboxes for every deliverable.
- One observable result per checkbox.
- Check `[x]` only when completion is verified in the current source of truth. A merged PR or completed operational action may be checked; an open PR remains unchecked.
- When it prevents confusion, label the kind of remaining work: `Code`, `Verify first`, `Migration`, or `Operational`.
- Do not turn every implementation detail or test case into a checkbox.

### Out of scope

- Name adjacent work that a reader might reasonably assume is included.
- State which existing behavior must remain unchanged.
- Distinguish deferred work from permanently excluded work; do not revoke earlier approvals by implication.

### Done means

- Describe what is observably true when this issue can close independently.
- Include focused verification and compatibility expectations, not a long test matrix.
- Distinguish completed code from release permission when rollout needs separate approval.

### Essential context

Keep only information that affects scope or correctness:

- state or command ownership;
- cardinality and identity;
- legacy compatibility;
- feature/admission gates;
- rollout or migration boundaries;
- important failure behavior;
- dependencies and intentionally open decisions.

Link to canonical design or implementation sources instead of copying them. Do not include file-by-file plans, long test matrices, rejected designs, speculative policy, or session history.

## Visual compression

Use Walkthrough's illustration guidance to choose the smallest useful view, not a blanket ASCII-first rule. Do not invent a flow between independent requirements or convert a diagram unless it becomes clearer; preserve the user's chosen format for the others.

Keep diagrams legible in Linear's narrow issue pane. Verify saved content and inspect rendering when available; saved-text readback is not visual verification.

## Ticket boundaries

Before creating or rewriting a ticket, ask whether it should exist in its current shape.

Split tickets when the parts:

- have different blockers;
- can close independently;
- deploy or roll back separately;
- belong to different owners;
- appear at different points in the delivery sequence.

Do not split merely because backend and frontend files differ. Prefer two clear sibling tickets over an umbrella plus two duplicate sub-tickets unless the umbrella owns a real outcome.

When splitting an existing ticket:

1. Follow the user's requested placement. Otherwise, keep the immediate independently deliverable outcome on the existing issue when practical.
2. Move the selected slice into its owner issue with no duplicated deliverables; leave unsplit work on its existing issue until authorized.
3. Update titles, descriptions, blockers, related issues, and milestone sequencing together.
4. Verify each ticket can be understood without reading the other one.

## Dependencies and relations

- A hard blocker means the whole ticket cannot proceed or complete without it.
- Do not use a hard blocker for a later checkbox or phase; state that dependency beside the affected deliverable or split the ticket.
- Use related links for useful context that does not block delivery.
- Remove stale relations when scope moves, completes, or is canceled.
- Keep the milestone sequence consistent with the actual dependency graph.

## Existing, canceled, and superseded work

- Preserve lifecycle/history semantics unless the ticket explicitly changes them.
- A canceled ticket should briefly say why it no longer needs to exist and which ticket owns any surviving scope.
- Do not keep an observe-only or speculative placeholder. Put required launch measurement on the launch ticket; create future work only when evidence identifies a concrete problem.
- When one implementation supersedes another, state the chosen direction and close or unlink the obsolete artifact after approval.
