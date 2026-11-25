---
name: draft-pr
description: Create draft pull requests or refine existing PR titles and descriptions, including publication when authorized. Use for opening a PR or improving its title or body, not code review. Preserve existing draft/ready state and metadata.
---

# Draft PR

Follow the repository's PR procedures. Read applicable guidance fully:

- Titles/descriptions: [PR writing](references/title-and-description.md).
- Behavioral explanations: also read [Walkthrough](../walkthrough/SKILL.md) and [PR walkthroughs](../walkthrough/references/pr-walkthrough.md).
- Unclear visual choice: [Illustration examples](../walkthrough/references/illustration-examples.md).

## Workflow

1. **Establish the target.** Read repository instructions; inspect the branch, diff and connected code. Find any matching PR and read its title, body, base and draft/ready state. Determine whether the request is a preview, creation or refinement.
2. **Draft.** Apply the shared writing guidance. Leave a fitting title/body unchanged only when it satisfies both the current diff and the requested refinement.
3. **Publish within scope.** A direct create or title/body update request authorizes that PR write unless preview is requested; otherwise follow the assigning workflow's scope. PR existence or skill/example discussion is not edit permission. For a preview, return the proposal and stop. When authorized, update the matching PR or create a new draft through the repository's normal CLI flow. Preserve an existing PR's base, draft/ready state and unrelated metadata.
4. **Verify.** Read back the saved title/body and metadata, checking accuracy and explanatory quality. Return the PR link and a brief result. After a failed or uncertain write, inspect remote state before retrying.

Commit/push preparation must stay within the active request or workflow; do not change implementation merely to improve a description.
