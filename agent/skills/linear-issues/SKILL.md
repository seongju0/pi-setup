---
name: linear-issues
description: Create, rewrite, split, review, align, or update Linear issues and milestone descriptions using a low-cognitive-load standard. Use whenever work involves drafting or changing Linear ticket titles, descriptions, deliverables, dependencies, status, or milestone sequencing. Keeps tickets human-readable, high-level but specific, checkbox-driven, and visual where ASCII or Mermaid communicates faster than prose.
---

# Linear Issues

Write Linear issues for the next human reader, not as a transcript of the planning session.

A reader should understand the purpose, shape, boundaries, and end state by scanning the title, `Goal`, and `Done means`. Keep issues high-level, succinct, and understandable without the planning conversation. Preserve details that change implementation or delivery; remove detail that only proves how much analysis happened.

## Standard shape

Use this structure unless the team already has a stricter template:

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

- Show the smallest flow or responsibility boundary that explains the issue.
- Name existing concepts; do not imply a new model or framework unless that change is in scope.
- Keep labels short. Prefer a few bullets when a diagram adds no clarity.

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

Use visuals when they reduce reading time. They are not decoration.

### ASCII first

Use a small `text` block for linear flows, ownership, cardinality, before/after shape, or a few branches:

```text
submission
  ├── lock exact records
  ├── validate all selections
  └── create all or nothing
```

Keep labels short and put explanatory prose outside the diagram.

### Mermaid when structure is genuinely complex

Use Mermaid for a branching state machine, sequence, or dependency graph that would otherwise require several paragraphs. Keep it small, valid, and readable in Linear. Do not duplicate the same information in prose.

### Bullets when simpler

Use bullets instead of a diagram when the content is a short list. Never force ASCII or Mermaid around information that is clearer as three bullets.

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

## Workflow

### 1. Read before writing

For an existing issue, read its full description, status, relations, milestone, and directly related tickets. Check linked PR status when checkboxes or current scope depend on it.

For a new issue, inspect nearby tickets and the milestone so the title, fields, and level of detail match the local standard.

### 2. Draft the smallest complete ticket

Apply the standard shape. Prefer deletion over preserving stale prose. Keep unresolved decisions explicitly open instead of selecting an implementation prematurely.

### 3. Review for cognitive load

Before writing to Linear, confirm:

- Can the title, Goal, Shape, and Done means explain the issue in one scan?
- Does every checkbox describe a verifiable result?
- Are important invariants, legacy behavior, rollout gates, and open decisions still visible?
- Is any paragraph better as bullets, ASCII, or Mermaid?
- Does any hard blocker apply only to part of the ticket?
- Can any speculative section be deleted?

### 4. Get approval before mutation

When the user asks for a plan, review, or draft, do not modify Linear. Present the proposed scope, title, deliverables, and relation changes first. A later explicit instruction such as `apply` authorizes the agreed write set.

If the user directly asks to create or update the issue, proceed without a second approval round unless a material scope decision is still unresolved.

### 5. Apply safely

Use the available Linear tools.

- Preserve assignee, priority, cycle, project, milestone, labels, attachments, status, and unrelated relations unless the approved plan changes them.
- Prefer targeted description patches for small edits and a full replacement for an approved rewrite.
- Change descriptions and relation metadata together when a split or scope move would otherwise leave the tracker contradictory.
- Never mark a deliverable complete from assumption.

### 6. Verify

Refetch every changed issue and milestone. Confirm:

- title and description landed;
- checkbox state matches verified work;
- status and milestone are correct;
- blockers and related links reflect the new scope;
- canceled or superseded work no longer blocks active delivery.

Report the changed issue links and any field the available tools could not update.
