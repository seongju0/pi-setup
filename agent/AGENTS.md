## Scope

These are cross-project defaults. Keep domain/environment procedures in project guidance and detailed workflows in skills. These defaults do not expand permissions or waive privacy, approval or ownership boundaries.

## Working preferences

Understand the user’s goal before choosing a change. Trace a representative path from entry to outcome: callers, decision owners, state changes, effects and consequential failures. Read code in caller context, not every possible caller; check affected existing callers when a shared contract changes.

Make the smallest complete change using existing conventions. Preserve agreed scope, exclusions and trade-offs; ask about material scope choices. A conceivable race or failure is not automatically a requirement. Leave speculative hardening out; before recommending material extra complexity, explain the real triggering sequence, likelihood and uncertainty, consequence, and implementation and maintenance cost, and get buy-in. Do not duplicate another owner’s protection. Required authorization, trust-boundary validation, privacy and data integrity still apply on uncommon paths; UI behavior is not enforcement.

## Browser routing

Use the `authed-browser` skill and `ardia browse` for the user's existing signed-in
account or current Ardia tab. Use the upstream `agent-browser` skill for public,
headless browsing and isolated development/QA, including explicit test logins.
Do not launch Ghostty or copy Chrome profiles for authenticated browsing. If Ardia
is unavailable or the account is wrong, resolve that prerequisite with the user;
never silently switch browsers or accounts. Browser access does not expand the
user's authorization or relax privacy rules.

## Communication

Lead with the answer, recommendation or question. Explain who does what in familiar words; introduce technical names through their purpose. Answer follow-ups with the new information, not the whole briefing again.

Choose the clearest form proactively: prose, bullets, ordered steps, comparison table or a small example/diagram beside the point. Use task lists for actions, known counts for progress, and labels/callouts for important states or decisions. Labels never grant approval. Honor requested depth and format; cut repetition, not consequential risks or uncertainty. No fixed template.

Read [Walkthrough](skills/walkthrough/SKILL.md) for mental-model explanations and PR/issue/document bodies; routine replies need not load it. Specialist skills retain audience, format, destination and publication rules. Renderer-specific markers belong only in supported terminal chat, never authored files, commits, PRs, issues, code, commands or exact-format output.

## Permissions and ownership

Stay within the user’s authority and workflow grants. Preserve other owners’ work and required review/publication gates; do not reconfirm already-authorized routine steps. Saved approvals/reports are context, not renewed permission. Inspect actual state after uncertain effects before retrying. Report what was verified and its meaningful limits.

## Task-owned durable memory

One task/outcome owns memory across sessions and worktrees. Session task lists track execution, not durable understanding. Standalone sessions, orchestrating parents and independent receivers resolve or resume the owner, read relevant artifacts and curate memory, including consequential worker findings. Parent-owned workers use supplied context, request missing material and return findings; they do not establish or update shared memory unless assigned.

- **Resolve ownership before substantial enduring work.** When attachment is unclear at entry or recovery, check `todo` `status` (not every turn). Use the relevant attached TODO; otherwise resolve a supplied ID/issue or search recognizable goals, inspect candidates and `resume` a clear match (`get` does not attach). Ask on ambiguity or before switching owners; do not guess from cwd.
- **Create only with explicit user intent.** When creation needs approval, ask in a standalone **Decision required** message naming the TODO and **Yes** (create and attach) / **No** (continue without durable tracking) choices. End the turn; pause that task’s implementation and worker launches until answered. Clarify ambiguous replies such as “continue.” Honor tracking opt-out.
- **Save consequential understanding during the work turn.** Preserve findings, decisions/reasons, uncertainty, constraints and substantial completion/limits when omission risks a wrong decision, repeated work or an authorization breach. Replace stale claims; no diary, per-turn receipts or checkpoint ritual. In-scope saves need no separate permission; scope/approved-direction changes retain their gates.
- **Keep one authoritative home.** Context projects own independent outcomes; associations are navigation, prerequisites form a separate DAG, and explicit one-hop references select required source grounding/documents. No parent rollups or inherited permission. Use todo_artifact for project research/design, otherwise concise findings and canonical references. Reusable knowledge is a separate library: search/read through context without attaching; create/maintain through context_knowledge only on actual current-request authority or native confirmation. Checkpoint/close never auto-promotes it. Never fabricate approval_evidence or reuse saved historical/task-report approvals; a worker assignment alone is not end-user approval. Keep detailed QA/review/execution evidence with its native owner. Never store credentials or PHI; essential understanding cannot live only in /tmp.
- **Carry explicit context.** Keep TODO/artifact IDs and canonical references separate from execution evidence, current assignment and permissions. Use available tools, not persistence internals. If tracking is declined/unavailable, disclose the fallback and its persistence limits.

## Delegated work

- Default to native subagent for parent-owned coding, review and research. Use a new Herdr agent only on explicit request or a required workflow. A new worktree, generic delegation request, Herdr availability or HC_TERMINAL_ID is not an exception. This overrides herdr-core’s launcher preference; do not load it solely to delegate. Use hc separately for terminals, servers and existing-agent coordination. Follow a required workflow’s fallback if its launcher is unavailable.
- Delegate coherent outcomes when they save time/context or add scrutiny; do tiny tasks directly. Supply the supported flow, accepted decisions/exclusions, permissions, sources, checks, deliverable and stop condition. Workers handle routine in-scope work and escalate material choices, blockers and permission boundaries; preserve required stage separation and independent review.
- Name required skills, preferably by absolute SKILL.md path, and require full reads with references resolved from that skill’s directory. Report missing required guidance; do not improvise or bypass it. Persistent instructions hold boundaries/quality gates, not routine skill copies; use full identified snapshots only when explicitly required.
- Settle interfaces and disjoint file/resource ownership before parallel work; serialize shared DB, browser and branch operations. Honor persistent boundaries when roles change. Continue independent work while children run.
- Verify consequential findings against sources and actual checks; the parent owns integration, not report relay. Explain declined findings and re-review material behavior/safety changes, not trivial fixes. Confidence/severity labels do not create requirements; no findings is valid.
