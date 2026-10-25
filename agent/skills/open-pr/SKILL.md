---
name: open-pr
description: Create or refresh a pull request with an easy-to-digest reviewer primer, using illustrations to explain the change with less prose. Verify the description against the current diff. Safe to rerun for refinements. Use when the user asks to open, submit, update, shorten, clarify, or refine a PR or its description.
---

# Open PR

A PR description is a primer for someone who has not followed the implementation discussion. Give the reviewer a clear mental model of the problem, the change, and the important boundaries so they can judge the diff. Reduce cognitive load through plain language, visual structure, and selective detail—not by hiding consequential complexity.

This skill is self-contained. Do not require another explanation or visualization skill to write the description.

## Every invocation: create or refresh

Running this skill means updating the actual PR, not merely suggesting wording, unless the user explicitly requests a preview. Repeated invocations refine the same PR; they do not create duplicates or append another summary.

1. Confirm the repository and current branch. Find its existing PR, if any, and read its title, body, base branch, and draft/ready state. Follow the repository's PR template and contribution guidance.
2. Read the current diff against the PR's base and the connected code needed to verify the flow. Do not reuse an earlier summary as evidence of current behavior. Check local versus published changes; do not claim unpublished work is in the PR or push it without authorization.
3. If a PR exists, refresh its description in place. Otherwise, create a **draft** using the repository's normal CLI flow. Preserve an existing PR's draft/ready state, base, and unrelated metadata. Do not commit, push, or change implementation solely to refine the description.
4. Use an outcome-focused title. Write the body as the reviewer primer described below, within the repository's exact template headings.
5. On refinements, apply the user's latest direction to the whole description, not an appended addendum. Preserve still-valid human-authored context, links, required template fields, and material caveats; remove stale claims and duplicated explanations. If the existing description already meets these requirements and the diff has not changed, leave it unchanged.
6. Before publishing, run the publication gate below. After publishing, read the PR back to verify the actual saved body. Return the PR link and a brief account of what changed, or say it was already current.

## Write a reviewer primer

### Orient before explaining

Lead with the outcome and only the context needed to understand it, usually one or two plain-English sentences. Explain the problem or prior limitation before introducing implementation names. Do not assume the reviewer has read the ticket, chat, or design discussion.

Then make these distinctions easy to see, wherever relevant:

- **What changes:** the behavior, relationship, or responsibility introduced by this diff.
- **What stays unchanged:** the existing contract or protected behavior a reviewer might otherwise think is affected.
- **Why this approach:** a consequential design choice or trade-off, not a narration of coding steps.
- **Where it stops:** compatibility paths, failure behavior, rollout constraints, and explicitly deferred scope.

These are review questions, not mandatory section headings. Keep repository template headings verbatim; do not add a fixed inventory of TL;DR, architecture, guards, rollout, and caveat sections.

### Let illustrations carry the explanation

For nontrivial changes, use visuals proactively to expose relationships that prose makes harder to grasp. A diagram should do explanatory work, not decorate a paragraph or turn bullets into arrows.

Choose the view around the reviewer's question:

| Reviewer needs to understand | Useful view |
| --- | --- |
| How behavior or ownership changes | Aligned before/after comparison |
| Where a decision branches or paths converge | Flow diagram with the consequential branches |
| When reads, writes, or side effects happen | Sequence or timeline with transaction/async boundaries |
| Which component owns or delegates work | Boundary or responsibility diagram |
| What a policy or data relationship means | Small concrete domain example or decision table |
| How an API contract or code shape changes | Focused request/response example, pseudocode, or diff |

Prefer fenced `text` diagrams for simple views readable in raw Markdown and GitHub. Use Mermaid when its rendering makes a richer flow, sequence, or architecture easier to understand. Tables and focused code sketches are also illustrations; ASCII art is not mandatory.

Let the material determine depth. A complex change may need a richer diagram or several complementary views—for example, ownership plus runtime sequence. Each view must answer a distinct review question. Do not force everything into one tiny diagram, or repeat the same explanation in multiple forms. For trivial changes, short bullets can be clearer than a visual.

### Make the visual precise

- Make the delta obvious. Use before/after when comparing existing behavior; do not invent a "before" flow for a new foundation. Label prepared versus connected behavior explicitly.
- Show concrete operations when they explain the changed responsibility, ordering, or boundary. Labels like "booking mechanics" or "same behavior" are insufficient if they hide the central distinction.
- Include consequential validation, side effects, failure paths, and compatibility behavior. Omit incidental calls and exhaustive file inventories.
- Keep labels short, consistent, and in the project's domain language. Include code symbols only when they help locate an owning boundary.
- Keep arrow meanings consistent: control flow, data flow, and identity/reference are different relationships. Label them or use separate views rather than mixing them silently.
- Distinguish implemented behavior from future extension points. Never draw a planned integration as active.

For example, a data-identity change can be clearer as:

```text
Replacement by B:
  Bundle 1 → A's request [historical] ─┐
                                     ├→ SAME Journey
  Bundle 2 → B's request [current] ────┘
```

This makes replacement versus retained identity visible; it is not a runtime sequence. Use examples from the actual PR rather than copying this domain into unrelated descriptions.

### Keep prose selective

Put each illustration next to the short explanation it supports. Add prose for motivation, constraints, or trade-offs the visual cannot communicate well; do not narrate the diagram again.

- **One fact, one place.** Remove repeated summaries, implementation inventories, boilerplate, and speculative follow-ups.
- **Plain language first.** Define unfamiliar concepts briefly; do not substitute vague abstractions for meaningful detail.
- **Progressive detail.** Make the main change understandable in a quick scan, then include the depth needed to review it. Roughly 150–300 prose words is a useful range for a typical PR, not a quota or ceiling. Richer illustrations are welcome when they reduce reading effort; avoid sprawling diagrams that merely relocate the complexity.
- **Preserve meaning.** Keep domain names explicit and distinguish related concepts rather than shortening them into ambiguous labels. Preserve exact code identifiers when quoting them.
- **Link reusable detail.** Link handbook explanations and environment/setup recipes rather than reproducing them. Keep changed behavior and essential review context in the PR itself. Add or update durable documentation only within the task's authorized scope; otherwise flag the gap.
- **Evidence, not reassurance.** State material caveats once, with verified evidence. Use counts, dates, or aggregates only when useful; never include PHI or client identifiers. Mark uncertainty explicitly.
- **Testing stays factual.** Distinguish checks actually run against the relevant revision from suggested, unrun manual steps. Keep test instructions focused on changed behavior.

## Publication gate

Do not publish until all are true:

- **Grounded:** Every behavior claim, diagram arrow, and before/after comparison is supported by the published diff and connected code. Testing claims match checks actually run against the relevant revision.
- **Self-contained:** A reviewer unfamiliar with the implementation conversation can understand the problem, the change, and the important boundaries without reconstructing context elsewhere.
- **Semantically useful:** Identify what the reviewer must understand to judge each substantive change, then locate where the description explains it. For a responsibility split, check ownership and delegation; for ordering or side effects, check timing and transaction boundaries; for an API change, check externally visible behavior. Keep this reasoning internal, not as another PR section.
- **Visually explanatory:** Ask, "What relationship does this view make easier to see?" If there is no answer, redraw it or use bullets. A code fence or before/after heading alone does not pass. Richer views earn their space by answering distinct review questions.
- **Easy to scan:** The main delta is apparent quickly. Concrete labels and visual grouping reduce the effort needed to follow it. Important failure, compatibility, and rollout distinctions remain visible.
- **No redundant explanation:** Perform a subtraction pass. Remove prose already conveyed by a visual, repeated facts, and details unnecessary to judge this diff. Allow added depth when it fixes an omission or makes the explanation easier to grasp; do not optimize for word count at the expense of understanding.
- **Publication verified:** Required template fields and material caveats are preserved. Read back the saved body and confirm the intended metadata is unchanged. Saved-body equality verifies publication, not explanation quality.
