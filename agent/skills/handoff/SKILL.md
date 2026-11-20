---
name: handoff
description: Create a concise, self-contained brief from the current conversation and start a fresh Pi session in Herdr to do that work. Use only when explicitly asked to hand off or start a new session for work.
disable-model-invocation: true
---

# Handoff

Turn the user's request and only the relevant conversation context into a brief for an independent Pi session or separate workstream. This is not parent-owned subagent delegation or a memory-system selection step. Do not do the handed-off work here or create a new TODO merely because a new session is starting.

## Brief

Resolve the objective, repository/worktree, authoritative references, current state, settled decisions, permissions, forbidden actions, ordered work, and acceptance checks from the conversation. Keep only details that affect execution. Prefer paths and identifiers over copied background. Separate confirmed facts from assumptions; ask the user only if an unresolved conflict or ambiguity changes the destination, permissions, or work. Never infer permission to commit, push, change a PR, update Linear, or make other external changes.

Before launch, the originating parent resolves the durable owner under the global AGENTS.md role-aware task-memory policy. Carry the owner TODO ID, authoritative design artifact ID or stable canonical document path, and relevant evidence/native result/report paths separately from the bounded current assignment and permissions. Require the receiving independent session to resume that TODO and read relevant bodies before applicable work, using available tools rather than private storage paths. If durable tracking is explicitly declined or unavailable, disclose the fallback and its persistence limits. The task/outcome owns this memory, not its session or worktree; a new session does not require a new record. This independent-session duty does not apply to generic parent-owned workers.

Reserve persistent system instructions (`appendSystemPrompt`) for rules that should remain binding throughout the receiving session. Keep temporary assumptions and phase-specific choices in the brief, with their scope and end condition. Reconcile carried-over constraints when the task changes; surface conflicts rather than silently overriding higher-priority instructions.

Write a unique Markdown file under `/tmp/handoffs/`. Use these headings as needed; omit empty sections:

```md
# Objective
# Starting point
# Direction and boundaries
# Work and verification
# Stop condition
```

Make it self-contained but short: a bounded assignment and launch envelope, not a comprehensive progress history or continuing authorization. Preserve consequential understanding under the global task-memory policy before launch; a `/tmp/` pointer alone is not durable memory. Do not paste the transcript or include secrets, credentials, PHI, or irrelevant history. State the desired final report and stop point. End with: “Work independently from this brief. Do not report back to or wait on the parent session.”

## Start the session

Use the `herdr_new_session` tool from the Pi Herdr session extension. It requires `hc` and an interactive Pi TUI with a live `HC_TERMINAL_ID`.

- Pass the brief path as `handoff`.
- When supplying session-wide rules, pass their nonempty file as `appendSystemPrompt`; keep phase-specific instructions in the brief.
- Default workspace/cwd are the caller's space/directory; pass overrides only when requested or clearly required. The `workspace` compatibility parameter accepts an existing local space's exact ID or unique name.
- Honor an explicitly requested physical model; otherwise leave Pi defaults unchanged. Do not force an engineering model or thinking level.

If the extension tool is unavailable, stop and explain that; do not substitute another session-creation method. Report-back research belongs to its dedicated skill/tool, not this independent handoff. Specialized local workflows supply their own guidance and reporting instructions.

## Launch guarantees and result

The launcher validates an explicit physical model before creating a tab; unavailable models or virtual routers are errors, never silent substitutions. It starts a fresh Pi session in an independent hc terminal with no parent and `keep: true`, in its own named app tab without changing caller focus. The session does not automatically inherit parent reporting bindings or appended system guidance.

Acceptance confirms the initial prompt was recorded in the exact intended session, not that the task completed. On partial failure, retain and report known identifiers; inspect the existing session before retrying, never blindly relaunch or resend.

Return the terminal ID, session ID/path, tab, name/label, cwd, model/default, and objective, then stop. Do not wait for task results or continue the handed-off work.
