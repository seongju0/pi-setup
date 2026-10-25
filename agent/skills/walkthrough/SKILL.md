---
name: walkthrough
description: Walk the user through changes, plans, designs, approaches, code, or any topic using simple explanations and concise illustrations that reduce cognitive load. Use when the user says "walk me through", asks for a walkthrough, or wants to understand how something works or what will change. They do not need to explicitly ask for simplification, diagrams, or visualization. Output directly in the session by default.
---

# Walkthrough

Help the user understand the topic at hand with the simplest accurate explanation and a few well-chosen illustrations. Treat "walk me through the changes" (or a plan, design, approach, or topic) as a request for this style without requiring extra instructions.

## Approach

- Use the current conversation and relevant source material. Distinguish planned behavior from what is already implemented; do not invent details to fill a diagram.
- Start with the central idea in one plain-English sentence. Skip preambles.
- Establish the big picture before details: what problem we are solving, what changes, and how the pieces work together. Omit parts that do not help answer the request.
- Walk through the important steps in a natural order. Explain purpose and behavior before implementation names. Define unfamiliar terms briefly when needed.
- Use concrete examples when they make an abstract idea easier to understand.
- Keep only the calls, files, props, states, and boundaries needed for understanding. Do not turn a walkthrough into an exhaustive file-by-file inventory.
- Preserve important constraints, trade-offs, and uncertainty even when simplifying. Mention the consequential ones near the step they affect.

## Illustrations

Use illustrations proactively, not only when explicitly requested. Pick the smallest visual that makes the point clear, and put it next to the short explanation it supports. One useful diagram is better than several redundant ones.

Prefer plain-text diagrams for simple relationships and flows that are easy to read directly in the session:

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
- **Mermaid:** use when branching or interactions are clearer than an equivalent plain-text diagram. Keep labels short and the diagram small.

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

## Output

Render the walkthrough directly in the current session, including its illustrations. Do not create a Markdown file, launch an editor, or open a separate view unless the user explicitly asks for that output.

Keep prose brief and scannable. The goal is an intuitive mental model, not merely a shorter technical document. Let the user request a deeper dive rather than front-loading every detail.
