---
name: open-pr
description: Create or refine pull request titles and descriptions as source-grounded walkthroughs. Use when asked to open a PR or improve its title or body, including publication when authorized; not for code review. Verify claims against the diff and read back published edits.
---

# Open PR

Help an unfamiliar reviewer understand **the problem → the change → the proof**.
Read [Walkthrough](../walkthrough/SKILL.md) before drafting and apply its explanatory
method. This skill owns PR grounding, repository templates and publication; the
Walkthrough session-output default does not override an authorized PR request.

## Create or refresh

When asked to create or refine a PR, update the actual PR unless the user requests
a preview. Editing this skill or discussing an example PR does not itself
authorize publication. Repeated refinements update the same description, not
duplicates or appended summaries.

1. **Establish the target.** Confirm the repository/branch and find its existing PR. Read its title, body, base and draft/ready state, plus the repository's template and contribution guidance.
2. **Ground the explanation.** Inspect the current diff against the PR base and connected code needed to verify behavior. Distinguish local work from published changes; do not describe unpublished work as delivered. Any preparation of unpublished work must stay within the current request's or assigning workflow's authority; report a publication blocker if that authority is missing. Do not commit, push or change implementation solely to refine a description.
3. **Draft in place.** Use the title and body guidance below and the repository's exact required headings and fields. Keep an existing title if it still fits. Preserve valid human context, links and material caveats; replace stale claims and duplicated explanation throughout the body. If the title and body already fit the current diff, leave the PR unchanged.
4. **Check and publish.** Apply Final check. For a preview, return the proposed title/body and stop. Otherwise update the existing PR or create a **draft** through the repository's normal CLI flow. Preserve an existing PR's base, draft/ready state and unrelated metadata.
5. **Verify the saved result.** Read back the actual saved title/body and verify metadata is unchanged except as intended. Return the PR link and a brief account of the refinement.

## Title and description

Name a concrete action and outcome or changed component, recognizable in a PR
list. Preserve required issue prefixes and repository conventions. Name this
delivery, not a larger initiative: **“Retry failed file uploads”**, not
“Robust upload workflow improvements.” Prefer concrete verbs such as **add, fix,
remove, keep, route, extract** over vague or promotional claims.

Use the repository's headings, not a new heading template. Where it separates
context, changes and testing, give each a distinct job:

- **Context:** establish the prior problem, motivation and central idea without requiring a ticket read. Leave the detailed walkthrough to the change section.
- **Changes:** explain before versus after and follow the operation from entry to outcome where parts interact. Use selective code pointers, not a file or commit inventory. Number steps or behavior-led subsections when useful, within this section rather than continuing into testing.
- **Testing:** explain coverage, how it was exercised and what the evidence establishes, as detailed below. Use unnumbered coverage subheadings; numbered manual action steps are fine.

Preserve an existing walkthrough the user selected: keep its explanatory sequence,
examples and useful illustrations. Adapt only for factual corrections, the
required template, current evidence and requested edits; do not replace it with
a synopsis.

Keep current behavior distinct from future work, and a connected user path
distinct from a merely available API or capability. Put consequential failure,
transaction, privacy, authorization, compatibility, rollout and scope boundaries
beside the step they affect. Link detailed setup or rationale, but keep essential
restrictions in the PR itself rather than hiding them behind a link. Skip inventories
of untouched areas and generic safety boilerplate.

Apply Walkthrough's illustration guidance to the reviewer question. Verify actors,
transitions and outcomes against the diff and connected code; do not invent a
failure to motivate the change. If the best illustration is unclear,
read [PR illustration examples](references/illustration-examples.md) for
responsibility splits, journeys, routing, recovery, algorithms, comparisons and
delivery boundaries. The catalogue is illustrative, not application evidence.

## Testing claims

- Keep test evidence in the testing section. Separate completed automated or manual checks, suggested manual steps and material gaps. Explain what each check establishes, not just commands or a pass count.
- Keep evidence current and concise. Consolidate re-runs rather than accumulating receipts; retain older evidence only when its scope still matters, clearly qualified.
- Never invent fixtures, results, live-service verification or full-suite/CI certification. A presentation fixture does not prove backend behavior; label screenshots or recordings with what they demonstrate and any unverified effects.
- Keep credentials, PHI and client identifiers out of the PR title, body and evidence.

## Final check

- Can an unfamiliar reviewer retell the main flow, what changed and why without reconstructing it from the diff or testing section? Does the explanation build understanding rather than merely enumerate facts?
- Does each illustration answer a useful question? Do tables ease comparison and complementary views add understanding rather than repeat it? Can removing a grid, paragraph or caveat reduce effort without hiding a material boundary?
- Are before/after, current/future and connected/available distinctions, required template fields, testing claims and material boundaries accurate?
- Is publication within the user's or assigning workflow's authority, and does the saved PR preserve the intended metadata?

Saved-body equality confirms the update—not its explanatory quality. Judge both.
