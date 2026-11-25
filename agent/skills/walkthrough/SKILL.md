---
name: walkthrough
description: Explain how something works or will change (behavior, architecture, plans and designs) with a clear mental model, concrete examples and useful visuals. Use for substantive explanations and PR, issue or document bodies, even without an explicit walkthrough request. Apply alongside the relevant specialist skill.
---

# Walkthrough

Make the topic easy to understand, not merely shorter or more decorated. Use this method for substantive explanations and authored writing; routine replies can stay brief.

When explaining a PR or its changes, also read [PR walkthroughs](references/pr-walkthrough.md). Evaluation requests retain the review skill's rubric; explaining a change is not a completed review.

## Approach

- Start with the central idea and a concrete user situation. Explain purpose and behavior before implementation names; use familiar, precise words, name who does what and define unfamiliar terms.
- Answer the current question. A follow-up usually needs the missing distinction or new information, not another complete overview. Match requested depth; omit incidental plumbing, file inventories and repeated summaries.
- When multiple parts interact, follow one representative action from entry to outcome. Connect the important callers, decisions, state changes, effects and failure boundaries. Use code names where they help navigation; a localized change may need only a sentence.
- Ground explanations in the conversation and relevant sources. Distinguish implemented behavior, proposed changes and unverified concerns. Keep consequential constraints and uncertainty beside the step they affect. Explain a risk’s practical trigger and consequence before promoting it as a reason for more work.
- Keep prose short and concrete, with one reader question per block. Use lists for independent rules, tables for comparisons and flows for sequences. State non-goals only where scope could plausibly be misunderstood; avoid repeated caveats.

## Illustrations

Use visuals proactively when they make the relationship easier to follow; do not wait for an explicit request. Choose the smallest useful view and put it beside the explanation. When the best view is unclear, read [Illustration examples](references/illustration-examples.md); adapt the pattern, not its hypothetical behavior.

| Reader needs to follow | Useful form |
|---|---|
| A simple point | A sentence or short paragraph |
| Independent facts | Bullets |
| Ordered actions | Numbered steps |
| Alternatives or combinations of conditions | A comparison or decision table; make precedence explicit |
| State meanings | A state table; add recorded times when they matter |
| Deadlines, intervals or exact cutoffs | A short timeline with concrete boundary values |
| A short path, ownership split or one action's outcomes | A compact plain-text diagram or indented tree |
| A small before/after code or contract change | A focused diff or concrete input/output example |
| Cross-actor message order, state transitions or complex branching | Mermaid sequence, state or flowchart |
| A decision or concrete implementation shape | Small pseudocode sketch or focused code example |
| Visible layout or interaction | A screenshot or recording, labelled with what it demonstrates |
| Actionable work, progress, risk or a decision | Task list, known count, status label or callout |

Use another view only when it answers a different important question. Do not force a visual, diagram type, number of sections or reply template.

Keep labels short, connections source-grounded and diagrams readable at the destination’s width. Split a dense diagram rather than shrinking it. Prose explains purpose and limits; the visual carries connections.

Use fenced Mermaid where the destination supports it; do not require a rendering check before each diagram. For a known unsupported destination or an actual rendering failure, provide readable text; honor requests for Mermaid source. Do not claim visual verification you did not perform or add a routine disclaimer.

## Output

Explain directly in the current chat unless the request or active workflow names another destination; do not create a file or open another view merely to present it. Specialist skills retain audience, required format and publication permissions. Preserve machine-readable contracts and keep terminal-only markers out of authored outputs.

Lead with the useful answer, result, blocker or decision. Include the proof and remaining limits that matter, not a tool-call diary or exhaustive inventory. Before sending, check that restructuring preserved every material contract and limit. Concise means low reading effort, not minimum words.
