---
name: walkthrough
description: Explain how something works or will change (behavior, architecture, plans and designs) with a clear mental model, concrete examples and useful visuals. Use for substantive explanations and PR, issue or document bodies, even without an explicit walkthrough request. Apply alongside the relevant specialist skill.
---

# Walkthrough

Make the topic easy to understand, not merely shorter or more decorated. Use this method for substantive explanations and authored writing; routine replies can stay brief.

When explaining a PR or its changes, also read [PR walkthroughs](references/pr-walkthrough.md). Evaluation requests retain the review skill's rubric; explaining a change is not a completed review.

## Approach

- Start with the central idea and a concrete user situation. Explain purpose and behavior before implementation names; name who does what and define unfamiliar terms when needed.
- Answer the current question. A follow-up usually needs the missing distinction or new information, not another complete overview. Match requested depth; omit incidental plumbing, file inventories and repeated summaries.
- When multiple parts interact, follow one representative action from entry to outcome. Connect the important callers, decisions, state changes, effects and failure boundaries. Use code names where they help navigation; a localized change may need only a sentence.
- Ground explanations in the conversation and relevant sources. Distinguish implemented behavior, proposed changes and unverified concerns. Keep consequential constraints and uncertainty beside the step they affect. Explain a risk’s practical trigger and consequence before promoting it as a reason for more work.
- Keep prose short, plain and concrete; give each block one reader question. Structure passages carrying several rules, states or limits: a list for independent rules, a table for comparisons, a flow for sequences. Prose explains purpose and significance; the illustration carries the connections. State non-goals only where a reader could plausibly misunderstand the scope, once; retain consequential uncertainty without repeating it.
- Use familiar, precise words rather than compressed internal shorthand. “I saved a note and read it back” is clearer than “write/readback verification passed.”

## Illustrations

Use visuals proactively when they make the relationship easier to follow; do not wait for an explicit request. Choose the smallest useful view and put it beside the explanation. When the best view is unclear, read [Illustration examples](references/illustration-examples.md); adapt the pattern, not its hypothetical behavior.

| Reader needs to follow | Useful form |
|---|---|
| A simple point | A sentence or short paragraph |
| Independent facts | Bullets |
| Ordered actions | Numbered steps |
| Alternatives across the same dimensions | A comparison table, not paragraphs packed into cells |
| State meanings | A state table; add recorded times when they matter |
| A short path, ownership tree or before/after | Plain-text diagram |
| Branches, loops, callbacks, states or handoffs whose connections matter | Mermaid flowchart, sequence or state diagram |
| A decision or concrete implementation shape | Small pseudocode sketch or focused code example |
| Actionable work, progress, risk or a decision | Task list, known count, status label or callout |

For example, a hypothetical save flow can be shown without narrating every arrow:

```text
Save
  ├─ invalid → show error; keep the old value
  └─ valid   → persist → refresh the view
```

Use another view only when it answers a different important question. Do not force a visual, diagram type, number of sections or reply template.

Keep labels short, connections source-grounded and diagrams readable at the destination’s width. Split a dense diagram rather than shrinking it. Prose explains purpose, important limits and handoffs; the visual carries connections.

Use fenced Mermaid where the destination supports it; do not require a rendering check before each diagram. For a known unsupported destination or an actual rendering failure, provide readable text; honor requests for Mermaid source. Do not claim visual verification you did not perform or add a routine disclaimer.

## Output

Explain directly in the current chat unless the request or active workflow names another destination; do not create a file or open another view merely to present it. Specialist skills retain audience, required format and publication permissions. Preserve machine-readable contracts and keep terminal-only markers out of authored outputs.

Lead with the useful answer, result, blocker or decision. Include the proof and remaining limits that matter, not a tool-call diary or exhaustive inventory. Before sending, check that restructuring preserved every material contract and limit. Concise means low reading effort, not minimum words.
