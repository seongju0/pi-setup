---
name: walkthrough
description: Explain topics and write for understanding with plain language, concrete examples and useful illustrations. Use when the reader needs a mental model of how something works or will change, an architecture, plan or design, or when drafting or revising a PR, issue or document body—not only for explicit walkthrough requests. Apply alongside specialist skills, which retain audience, format, destination and publication rules. Routine questions, confirmations, progress updates and short completion reports can use the global communication defaults without loading this skill. Output in the current chat unless the request or active workflow names another destination.
---

# Walkthrough

Help the reader build an accurate mental model with plain language, concrete examples and illustrations that make the topic easier to follow. Apply this method automatically to explanations and authored writing that need that understanding, including PR, issue and document bodies; do not wait for an explicit walkthrough request. Simple replies need not become full walkthroughs.

Use the same method alongside specialist skills rather than copying writing rules into each one. The request and active workflow still own audience, required format, destination and publication permissions.

## Approach

- Use the current conversation and relevant source material. Distinguish planned behavior from what is already implemented; do not invent details to fill a diagram.
- Start with the central idea in one plain-English sentence. Skip preambles.
- Establish the big picture before details: what problem we are solving, what changes, and how the pieces work together. Omit parts that do not help answer the request.
- Walk through the important steps in a natural order. Explain purpose and behavior before implementation names. Define unfamiliar terms briefly when needed.
- **Prefer an entry-to-resolution walkthrough when understanding the change depends on how multiple parts interact.** Follow a representative request or user action from its entry point to its observable outcome—for example, a UI action through its route, service, persistence and resulting UI, or a job through selection, execution and completion. Connect important callers, decisions, state changes, side effects and consequential failure paths; use concrete code names where they help the reader navigate. Use a simpler explanation for a localized change whose behavior is clear without tracing those handoffs. Prose can carry the walkthrough; diagrams are not mandatory, and incidental plumbing or an exhaustive call graph should be omitted.
- Use concrete examples when they make an abstract idea easier to understand.
- Keep only the calls, files, props, states, and boundaries needed for understanding. Do not turn a walkthrough into an exhaustive file-by-file inventory.
- Preserve important constraints, trade-offs, and uncertainty even when simplifying. Mention the consequential ones near the step they affect.

### Clear writing

- **Show who does what.** When abstract subjects or noun phrases hide the actor and action, name them directly. For example, "I kept the lock that prevents older agents from writing the old files" explains more than "The migration fence is preserved." Passive voice is fine when the actor is unknown or unimportant.
- **Use familiar, precise words and clear references.** Avoid stacked nouns, invented shorthand and unusual word combinations that the reader must decode. "I saved a note and read it back" is clearer than "write/readback verification passed." Introduce necessary technical terms through their purpose; retain real identifiers when they help precision or navigation.
- **Put the point where the reader can find it.** Lead with the answer, recommendation or question. Cut empty transitions, repeated summaries and statements that add no useful information. Do not trade an understandable explanation for a dense shorthand ledger, or trim away consequential constraints and uncertainty. Clarity is not a ban on particular words or punctuation.

### Fit the message to the reader's need

These are ways to choose content, not required headings or a response template:

- **Questions and confirmations:** make the choice and consequence clear; recommend an option when justified. Say what was accepted or completed. A brief acknowledgment can remain brief.
- **Progress:** report a useful result, blocker or changed plan, not a diary of tool calls. Explain the effect on the user's goal when it matters.
- **Completion:** explain what changed, why it matters, the useful proof and any meaningful remaining work. Preserve the active workflow's required checks and reporting without turning the explanation into an opaque inventory.
- **Explanations and authored documents:** establish the central idea, then follow the behavior or argument in a natural order. Put examples and illustrations beside what they explain; adapt to the reader and the specialist workflow's format.

## Illustrations

Use illustrations proactively, not only when explicitly requested. Pick the smallest visual that makes the point clear, and put it next to the short explanation it supports. One useful diagram is better than several redundant ones.

### Choose the medium by the relationship

Choose by what the reader must follow, not by the diagram category. A flow, sequence or dependency graph does not automatically need Mermaid.

| Use | When it reduces reading effort |
|---|---|
| **Prose** | A simple point or short explanation is clearer without a visual. |
| **Plain-text diagram** | A short path, tree, before/after or few branches are easy to follow directly. |
| **Mermaid** | Explicit connections make branching and rejoining paths, loops, asynchronous callbacks, state transitions or ownership boundaries easier to follow than text. |
| **Bullets** | Independent requirements, facts, prerequisites or outcomes need scanning, not an implied sequence. |
| **Numbered steps** | Order matters to the action or explanation. |
| **Table** | Comparing the same meaningful dimensions across alternatives or outcomes helps; avoid paragraphs packed into cells. |
| **Task list and progress summary** | Show actionable work and known item counts; distinguish saved state from live activity. |
| **Status label or supported terminal chip** | Make a result, blocker or ask easy to scan; pair attention states with the cause, next action or decision. |
| **Callout** | Set apart a consequential risk, decision or required action, using a bold lead label or a supported alert block. |
| **Pseudocode or a code sketch** | The decision or implementation change itself is what the reader needs to understand. |

Use these forms proactively and combine them when useful: a comparison table can contain status labels, and a task view can include counts and a blocker callout. Use existing tool-backed task/TODO views for actual saved state rather than inventing another checklist or repeating a full card in prose. Terminal-specific chip syntax stays out of files, PRs, issues, code and commands; use ordinary words there. Icons and color reinforce text, never replace meaning or grant permission.

Use Mermaid proactively when those connections carry the explanation; do not wait for the user to request it or for the prose to become several paragraphs long. Keep plain text when a rendered graph adds boxes without making the relationships clearer. A short delivery-order diagram can remain plain text even when a more involved architecture or lifecycle benefits from Mermaid.

For a short path, plain text is enough:

```text
Before: Request → one handler does everything
After:  Request → validate → choose action → execute
```

Choose the shape that best fits the material:

- **Before / after:** show how behavior or responsibility changes.
- **Flow or sequence:** show what happens and in what order.
- **Tree:** show ownership, UI structure, file responsibilities, or a call hierarchy.
- **Pseudocode:** explain a decision or algorithm without syntax noise.
- **Small code sketch or diff:** show the concrete shape when code makes the idea clearer than prose.
- **Mermaid:** use a flowchart for decisions and handoffs, a sequence diagram when ordering between actors matters, or a state diagram when legal transitions are the subject. Use groups only when they explain a responsibility boundary.

For example, explain a decision as:

```text
Save
  ├─ unchanged → reuse the existing result
  └─ changed   → write → refresh the result
```

Or explain ownership as:

```text
Page
├── Toolbar       user actions
└── Results       displays the current data
    └── Row       one item
```

For a code-shape change, show only the meaningful difference:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write content
+  refresh result
```

Show a whole block instead when most of it is new or omitted context would hide important ownership or ordering. Use judgment: do not force every illustration type or a fixed section template into every response.

### Keep diagrams explanatory and readable

- Keep a short explanation of what the layer delivers, what it owns and where it hands off. Let the diagram show connections; do not narrate every arrow again.
- Keep consequential rules, limits and uncertainty explicit in nearby prose. Do not make readers infer a guarantee from an arrow or imply that accepted, queued, committed and completed mean the same thing.
- Use short labels and a focused set of nodes or actors. Prefer top-to-bottom layout for a longer path; split by question when a graph becomes dense. Check readability at the destination's width, especially a narrow issue pane.
- Use fenced `mermaid` in the current chat and destinations that render it when its connections make the explanation clearer. Do not require a rendering check before using it. For a destination known not to render Mermaid, use a readable text diagram; honor an explicit request for Mermaid source. Treat an actual rendering failure as a separate debugging question, not a reason to avoid Mermaid by default.
- Check branches, joins, arrow direction and ownership against the source, and keep diagram syntax valid. Do not claim visual verification you did not perform, but do not add a routine rendering disclaimer to each explanation. Do not install a renderer merely to decorate an explanation.

## Output

Default to the current chat when no user request or active workflow names another destination. Render the explanation and its illustrations directly there; do not create a file, launch an editor or open a separate view just to present a walkthrough. When the request or workflow names a document, report, PR or issue, apply this method in that destination and follow its permission and publication rules.

Honor the requested length, depth and format. Keep prose scannable and include the detail needed for understanding, not every fact available. The goal is an intuitive mental model, not merely a shorter document or more formatting.
