---
name: open-pr
description: Create or refine a pull request with detailed illustrations and fewer words so reviewers can grasp the changeset. Verify the description against the current diff and read back the published result.
---

# Open PR

**Leverage detailed illustrations and fewer words so it is easier for the reviewer to grasp the changeset.** Write for someone who has not followed the implementation discussion. Make the problem, the change and its important boundaries clear; do not turn the PR into an implementation report.

## Create or refresh

Invoking this skill updates the actual PR unless the user requests a preview. Repeated invocations refine the same PR, not duplicates or appended summaries.

1. Confirm the repository/branch and find its existing PR. Read the title, body, base and draft/ready state, plus the repository's template and contribution guidance.
2. Inspect the current diff against the PR base and connected code needed to verify behavior. Distinguish local work from published changes; do not describe unpublished work as delivered.
3. Write an outcome-focused title and the illustrated description below, using the exact repository template headings. Keep an existing title if it still fits. Preserve valid human context, links, required fields and material caveats; replace stale claims and duplicated explanation throughout the body.
4. Check the draft, then update the existing PR or create a **draft** through the repository's normal CLI flow. Preserve an existing PR's base, draft/ready state and unrelated metadata. Do not commit, push or change implementation solely to refine its description. If the description already fits the current diff, leave it unchanged.
5. Read back the actual saved title/body and verify metadata is unchanged except as intended. Return the PR link and a brief account of the refinement.

## Make illustrations carry the explanation

- **Orient briefly.** Start with one or two plain-English sentences: the problem or prior limitation, then the outcome. Do not assume the reviewer knows the ticket or implementation names.
- **Show the substantive changes.** Organize around the few things the reviewer needs to understand, not files or coding steps. For nontrivial changes, lead each explanation with a useful illustration. Use before/after for a changed flow, a table for independent conditions/outcomes, or a concrete example for identity, state or lifecycle behavior. For trivial changes, short bullets may be clearer.
- **Put detail in the visuals.** Show concrete actors, operations, ownership, identity and consequential branches or side effects—not vague boxes such as “same behavior.” Make the changed versus preserved behavior visible. Prefer several complementary views over one overloaded diagram; each should answer a different review question.
- **Use the clearest format.** Fenced `text` diagrams, tables, Mermaid and focused code/request examples are all valid. Choose for readability, not decoration. Keep labels concise and arrow meanings consistent; distinguish current behavior from planned integrations.
- **Use prose only where it adds meaning.** Explain motivation, trade-offs or caveats the illustration cannot convey. Do not narrate the diagram again. Remove repeated summaries, file inventories, boilerplate and setup recipes; link reusable documentation instead. Keep essential review context in the PR. Less prose does not mean hiding consequential complexity or shrinking useful illustrations.
- **Keep testing factual and compact.** A small check → verified outcome table often replaces a long test narrative. Separate checks run for the current change from earlier evidence and suggested manual steps. Do not invent seeded walkthroughs or imply full-suite, CI or live-service certification. State material verification gaps once; never include credentials, PHI or client identifiers.

## Final check

Before publishing, ask:

- Can a reviewer quickly grasp the problem, the delta and important compatibility/failure/rollout boundaries without reading the chat?
- Does each illustration explain a concrete relationship or outcome, and is every claim/arrow grounded in the actual diff and connected code? A code fence alone is not visual explanation.
- Can any prose be deleted because a visual or another sentence already says it? Keep detail that helps judge the change; do not optimize for a word count.
- Are testing claims accurate, required template fields and material caveats preserved, and publication within the user's permissions?

After publishing, saved-body equality confirms the update—not its explanatory quality. Judge both.
