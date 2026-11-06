---
name: open-pr
description: Create or refine a pull request with a clear delivery title, concise context, and useful before/after illustrations. Verify the description against the current diff and read back the published result.
---

# Open PR

Help an unfamiliar reviewer understand **why this matters → what changes → how
it was verified.** Use plain language, fewer words, and illustrations that explain
more quickly than prose. This is a review aid, not a work diary.

## Create or refresh

Invoking this skill updates the actual PR unless the user requests a preview.
Repeated invocations refine the same PR, not duplicates or appended summaries.

1. Confirm the repository/branch and find its existing PR. Read the title, body, base and draft/ready state, plus the repository's template and contribution guidance.
2. Inspect the current diff against the PR base and connected code needed to verify behavior. Distinguish local work from published changes; do not describe unpublished work as delivered.
3. Write the title and description using the guidance below and the repository's required headings. Keep an existing title if it still fits. Preserve valid human context, links, required fields and material caveats; replace stale claims and duplicated explanation throughout the body.
4. Check the draft, then update the existing PR or create a **draft** through the repository's normal CLI flow. Preserve an existing PR's base, draft/ready state and unrelated metadata. Do not commit, push or change implementation solely to refine its description. If the description already fits the current diff, leave it unchanged.
5. Read back the actual saved title/body and verify metadata is unchanged except as intended. Return the PR link and a brief account of the refinement.

## Titles: name the delivery

- Name a concrete action and outcome or changed component, recognizable in a PR list without opening the body. Preserve required issue prefixes and repository conventions.
- Prefer **add, fix, remove, keep, route, extract** over vague “improvements,” “hardening,” or “enhancements.” Drop promotional adjectives such as “robust” or “seamless.” Use necessary domain terms, not unexplained internal shorthand.
- Name what this PR delivers, not the larger initiative or future capability: **“Retry failed file uploads”**, not “Robust upload workflow improvements.”

## Description: context, change, proof

Use the repository's headings; this is a reading order, not extra mandatory sections.

- **Set the scene.** Briefly explain the prior problem and why the change is needed, without requiring a ticket read. Put motivation before implementation names or stack position; skip project history and repeated TL;DRs.
- **Explain the change.** Organize around behaviors or responsibilities, not files or commits. Show what changes and what relevant behavior stays the same. Label future work as future, not delivered.
- **Keep detail scannable.** Use short paragraphs and bullets, with brief **bold lead-ins** when helpful. Give each bullet one point. Avoid jargon, dense caveat paragraphs, repeated summaries, and deeply nested lists. Do not narrate a diagram again in prose.
- **State important boundaries once.** Keep consequential privacy, authorization, compatibility, failure, rollout and scope limits where they help judge the change. Skip inventories of untouched areas and generic safety boilerplate. Link detailed setup or rationale, but keep essential restrictions in the PR itself.
- **Keep verification current and factual.** Summarize checks and what they establish in compact bullets or a check → outcome table. Separate completed checks, suggested manual steps, and material gaps. Consolidate re-runs rather than accumulating test receipts; retain older evidence only when its scope still matters, clearly qualified. Never invent fixtures, results, live-service verification or full-suite/CI certification. Never include credentials, PHI or client identifiers.

## Illustrations: explain a relationship, not a list

- **Earn the diagram.** Clarify a changed flow, ownership, identity, state, timing or consequential branch. If removing boxes and arrows leaves a simple list, use bullets instead. A nontrivial PR does not automatically need a diagram.
- **Prefer before/after.** Keep actors, labels and detail consistent so the difference is obvious. Show the affected path, not the entire architecture. Make arrows and changed versus preserved behavior clear.
- **Start with ASCII in a fenced `text` block.** Use Mermaid only when complexity makes it clearer. Use a table for independent conditions/outcomes or a focused example for a payload or state. A code fence alone is not visual explanation.
- **Keep each visual focused.** Use concrete labels. A second view must answer a different review question, not repeat the flow. Ground every arrow and outcome in the diff and connected code.

## Final check

- Can a reviewer identify the delivery from the title and understand the why before the mechanics?
- Is the change easier to understand because of each illustration, or would bullets be clearer?
- Can any sentence, bullet, diagram or repeated caveat be removed without losing review context?
- Are current versus future behavior, required template fields, testing claims and material boundaries accurate?
- Is publication within the user's permissions, and does the saved PR preserve the intended metadata?

Saved-body equality confirms the update—not its explanatory quality. Judge both.
