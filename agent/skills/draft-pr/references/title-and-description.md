# PR titles and descriptions

This reference guides wording, not code changes or publication. For substantive behavioral explanations, read [Walkthrough](../../walkthrough/SKILL.md) and [PR walkthroughs](../../walkthrough/references/pr-walkthrough.md). Title-only edits need neither. For an unclear illustration choice, consult [Illustration examples](../../walkthrough/references/illustration-examples.md).

## Title and structure

Use a concrete action and outcome for this change; follow repository conventions and keep a fitting existing title.

Use the repository's PR template when present, preserving its required headings, wording, emoji and fields. Apply Walkthrough within that structure; otherwise, use problem → change → verification.

Keep motivation, behavior and verification distinct where the template separates them. Give enough context to understand the change without a ticket read.

Write for a reviewer, not someone reconstructing the author's session. Keep context that explains the problem, change, evidence or deployment. Omit unrelated local work, agent coordination and development/publishing history. When a development detail materially affects verification or rollout, state the resulting prerequisite or limitation, not its chronology.

## Description

For substantive changes, use the PR walkthrough's story shape at the requested depth. Preserve valid human context, links and material caveats; replace stale claims throughout. Retain a user-selected walkthrough's meaning, sequence, examples and useful illustrations, reformatting rather than replacing it with a synopsis.

Keep consequential boundaries—failure, transactions, privacy, authorization, compatibility, rollout and scope—beside the behavior they qualify. Link detail without removing essential restrictions. If an affected-areas field would separate a risk from its cause, explain it at the change and put a short pointer in that field. Omit untouched-area inventories and boilerplate.

## Verification claims

- Separate completed checks, suggested steps and material gaps. State what each check proves; distinguish published, local and proposed behavior, and source changes from applied live/external configuration and remaining activation gates.
- Consolidate reruns. Retain older evidence only when its scope still matters, clearly qualified.
- Never invent failures, fixtures, results, live-service verification or full-suite/CI certification. Verify examples against the actual diff and connected code. Label what media demonstrates; presentation evidence does not prove backend behavior. State unverified scope once.
- Keep credentials, PHI and client identifiers out of titles, descriptions and evidence.

## Final check

Can an unfamiliar reviewer retell what changed and why? Remove author-only context and duplicated views; check template fit, before/after and current/future distinctions, evidence and material limits. Saved-body equality confirms an update, not explanatory quality.
