---
name: writing-skills
description: Creates and refines Pi skills with concise prose, clear activation descriptions and actionable workflows. Use when asked to create a skill or revise a SKILL.md, its metadata or supporting files—not merely to use an existing skill.
---

# Writing skills

Create a focused skill an agent can follow and a maintainer can understand. Assume the agent is capable; include only context that changes its actions or decisions.

## 1. Define the job and checks

Name the input, outcome and stop condition. Before drafting, choose representative requests and expected results: normal use, a meaningful boundary and a nearby request that should not activate it.

Reuse an existing skill when it owns the job; do not split every step into another skill. Favor durable workflows and domain rules. Keep model-specific workarounds only for observed problems; revisit them when models change.

Edit the canonical source, not installed upstream copies. For pi-setup, use `agent/skills/` and add a root README catalog entry describing what to copy, repository companions and external prerequisites; no manifest or installer is needed. Keep workplace policy separate. Authoring does not authorize executing the workflow, installing dependencies or publishing.

## 2. Write the smallest useful guide

Use `<name>/SKILL.md`, matching the directory for portability. Names use lowercase letters or digits separated by single hyphens (at most 64 characters). Write a nonempty description (at most 1,024 characters) saying what it does and when to use it; avoid “I” or “you.” Missing descriptions and malformed frontmatter prevent loading.

For command-only skills, set `disable-model-invocation: true`.

Start with this shape; adapt or omit headings that do not help:

```markdown
---
name: summarizing-changes
description: Summarizes Git diffs for reviewers. Use when asked to explain a changeset without creating or publishing a PR.
---

# Summarizing changes

Explain what changed and why. Do not edit code or publish.

## Workflow

1. Read the requested diff and enough surrounding code to verify behavior.
2. Describe before/after behavior; separate verified checks from assumptions.

## Result

Return a short change summary and material verification gaps.
```

- **Direct prose:** use concrete verbs and consistent terms. Put each rule beside its action, in one place. Cut generic background, repetition, inflated claims and imagined edge cases.
- **Useful precision:** give exact steps for fragile operations and judgment where context varies. Preserve actors, timing, approvals, privacy, failures and output contracts. Keep qualifiers that change behavior, such as “live callers,” “all variants” or “only after approval.”
- **Selective detail:** keep the main path and essential boundaries inline. Link conditional references directly, one level deep, using skill-relative paths and explicit read triggers. Add examples for real ambiguities. Use scripts or tools for mechanical steps and prose for judgment; reuse existing helpers before adding new ones.
- **Verified instructions:** state prerequisites and dependencies; check tool names and commands. Distinguish running a script from reading it; do not invent installation or recovery behavior.

## 3. Try it and validate

For automatic skills, expose the draft with `pi --skill <dir>` and test plain requests without naming it; forced loading tests only the body.

Exercise the chosen requests with a fresh agent and intended models when available. Inspect results and references actually read. Fix observed failures; judge correctness, instruction-following and unnecessary context—not brevity alone. Compare with the previous version or no skill before claiming improvement.

Validate frontmatter, discovery and links with existing host tooling; do not assume another harness's paths or tool restrictions apply. Run required project checks. Draft-only or synthetic trials must not execute external or destructive workflows.

Return the path, activation scope, checks and remaining gaps, including models/cases not tested. Static review is not behavioral proof. Installation and publication remain separate unless requested.

Sources: [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) and [Red Hat](https://next.redhat.com/2026/07/28/building-skills-for-ai-agents-pitfalls-and-best-practices/), adapted to Pi.
