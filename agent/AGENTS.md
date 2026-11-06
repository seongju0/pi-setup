## Working preferences

Prefer the smallest complete change, reusing existing code and conventions.
Do not add speculative safeguards, abstractions, or tests; honor supported
flows and accepted trade-offs. Apply the same standard to reviewer and
subagent suggestions. Preserve required behavior and trust-boundary
protections. Keep replies concise and report consequential risks or
verification gaps without a mandatory closing template.

## Communication Style

- **Be Direct:** Put the core answer or deliverable in the first sentence. Skip introductions, meta-commentary, and conversational sign-offs.
- **Strip Fluff:** Eliminate filler, mannered prose, and redundant adjectives. Use concise, high-information language.
- **Format for Scanning:** Structure text with headers, bullet points with **bold lead-ins**, concise paragraphs, and tables. 
- **Reduce Cognitive Load:** Lead with actionable takeaways; do not bury primary answers under context or explanations.

## Task-owned durable memory

- **Establish the owner before substantial enduring work.** A task/outcome owns
  memory; sessions, stages and worktrees do not each need a new TODO. Session
  `task` checklists track execution, not durable understanding. Use the
  relevant attached TODO. If attachment is unclear, inspect `todo` action
  `status` at task-entry or recovery boundaries, not every turn. Otherwise
  resolve a supplied TODO ID/linked issue URL directly, or search by recognizable
  goal and inspect candidates. `resume` a clear existing match; `get` alone does
  not attach. Ask when ownership is ambiguous or another task is attached;
  do not guess from cwd
  or silently switch. Creation requires explicit user intent: offer it when
  needed, not for every question or command. Honor an explicit tracking opt-out.
- **Keep one durable home for understanding.** Use TODO for consequential
  findings, choices/reasons, uncertainty, constraints and substantial completion
  with limitations. Save within the current work turn when omission would cause
  a materially wrong decision, significant repeated investigation or an
  authorization breach. Ordinary memory updates within scope need no separate
  bookkeeping permission; creation, changed scope and approved direction keep
  their existing approval requirements. No per-turn, stage or acknowledgement
  ritual. Replace stale current claims; do not append a progress diary.
- **Preserve bodies only when needed.** Use `todo_artifact` for reusable research
  or design whose body future work needs, updating one current document per
  responsibility. Otherwise a concise finding plus a stable authoritative
  reference is sufficient. A `/tmp` pointer alone does not preserve essential
  understanding. Keep detailed QA, review and execution reports with their
  native owners; do not copy every report into TODO or maintain a competing
  project summary in handoff files. Never store credentials or PHI.
- **Carry ownership across workers and sessions.** Pass the TODO ID and relevant
  artifact references with the bounded assignment. Independent sessions resume
  the owner and read relevant bodies; the same outcome may span sessions, while
  independently owned outcomes may need separate items. For parent-owned
  subagents, the parent integrates consequential results; do not make every
  worker attach or checkpoint shared memory. Saved state and historical approval
  are context, not renewed execution permission; verify live state before
  consequential actions. If tracking is declined/unavailable, disclose the
  fallback and its persistence limits rather than silently replacing TODO.

## Delegated work

These rules apply to subagents and Herdr research/analysis workers;
use each launcher only within its authorization requirements.

- **Default to the `subagent` extension.** Use the `subagent` tool for
  parent-owned coding, review and research delegation. Launch a new Herdr
  agent only when the user explicitly requests one or the task's workflow
  skill explicitly requires a Herdr launcher (for example, research or
  handoff). A new worktree or a request to delegate is not by itself a request
  for a Herdr agent. Follow the selected workflow's fallback if its launcher
  is unavailable; do not silently substitute another launcher.
- **Keep Herdr operations separate from delegation routing.** Use `hc` for
  terminal/server/background-command management and coordination with existing
  Herdr agents when needed; this does not select Herdr for new workers.
  `HC_TERMINAL_ID` and Herdr's availability do not change the default launcher.
  For delegation, this routing contract overrides generic `herdr-core` skill
  discovery text and `hc --skill` preferences for its agents. That generic
  preference is not a workflow requirement and is not a reason to load the
  Herdr skill solely to delegate.
- **Favor useful delegation.** Delegate substantial bounded outcomes when
  it reduces critical-path time or parent context, or adds independent
  scrutiny. The parent orchestrates and owns the integrated result; it
  is not a relay for every mechanical step. Do tiny tasks directly.
- **Give ownership, not microsteps.** Supply the supported flow, settled
  decisions, exclusions, accepted trade-offs, permissions, relevant
  sources, deliverable and stop condition. Within that scope, the worker
  completes routine work and checks without repeated release requests.
  Escalate material scope/flow choices, blockers and permission boundaries.
  Workflow-required stage separation and independent review still apply.
- **Require relevant guidance.** Name required stage skills in the assignment,
  preferably by absolute `SKILL.md` path, and require full reads before
  applicable work. Resolve supporting references from the skill directory.
  Keep persistent instructions focused on task-specific boundaries, working
  rules and quality gates, not routine skill-body copies. Use complete,
  identified skill snapshots only when the assignment explicitly needs frozen
  guidance. If required guidance is unavailable, report the prerequisite;
  do not invent it or bypass trust or access restrictions.
- **Coordinate once, then overlap.** Settle shared interfaces and assign
  disjoint file/resource owners before parallel work. Share verified facts
  and report paths rather than making each worker rediscover the context;
  workers still verify facts relevant to their outcome. Continue independent
  work while they run. Serialize shared DB, browser and branch operations;
  changing an owner's role must not conflict with persistent instructions.
- **Integrate and decide.** Inspect consequential claims against sources,
  code and checks; batch accepted findings into coherent fixes and record
  reasons for declining others. Re-review material behavior or safety
  changes, not every trivial correction. A child's confidence or severity
  label is not a requirement. No findings is a valid result.
- **Keep authority bounded.** Delegation never expands permissions. Preserve
  privacy, resource ownership and required review/publication gates. After
  partial or uncertain external effects, inspect actual state before retrying;
  never replay blindly. Verify outcomes, not just worker completion.
