---
name: handoff
description: Create a concise, self-contained brief from the current conversation and start a fresh Pi session in Herdr to do that work. Use only when explicitly asked to hand off or start a new session for work.
disable-model-invocation: true
---

# Handoff

Turn the user's request and only the relevant conversation context into a brief for a fresh Pi session. Do not do the handed-off work here.

## Brief

Resolve the objective, repository/worktree, authoritative references, current state, settled decisions, permissions, forbidden actions, ordered work, and acceptance checks from the conversation. Keep only details that affect execution. Prefer paths and identifiers over copied background. Separate confirmed facts from assumptions; ask the user only if an unresolved conflict or ambiguity changes the destination, permissions, or work. Never infer permission to commit, push, change a PR, update Linear, or make other external changes.

Reserve persistent system instructions (`appendSystemPrompt`) for rules that should remain binding throughout the receiving session. Keep temporary assumptions and phase-specific choices in the brief, with their scope and end condition. Reconcile carried-over constraints when the task changes; surface conflicts rather than silently overriding higher-priority instructions.

Write a unique Markdown file under `/tmp/handoffs/`. Use these headings as needed; omit empty sections:

```md
# Objective
# Starting point
# Direction and boundaries
# Work and verification
# Stop condition
```

Make it self-contained but short. Do not paste the transcript or include secrets, credentials, PHI, or irrelevant history. State the desired final report and stop point. End with: “Work independently from this brief. Do not report back to or wait on the parent session.”

## Start the session

Use the `herdr_new_session` tool from the Pi Herdr session extension, passing the brief path as `handoff`. Default workspace/cwd are the current workspace/directory; pass overrides only when requested or clearly required. Honor an explicitly requested physical model; otherwise leave Pi defaults unchanged. Do not force an engineering model or thinking level. Report-back research should use its dedicated skill/tool, not this independent handoff. Specialized local workflows supply their own guidance and reporting instructions. The launcher validates an explicit physical model before creating a tab; unavailable models or virtual routers are errors, never silent substitutions. The extension always starts a fresh Pi agent and keeps the current tab focused.

If the extension tool is unavailable, stop and explain that; do not silently fall back to a different session-creation method. Report the created tab, agent, cwd, model/default, and objective. Do not wait for task results or continue the handed-off work.
