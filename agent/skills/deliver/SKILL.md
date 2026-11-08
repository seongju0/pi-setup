---
name: deliver
description: "Deliver an approved specification or sufficiently explicit change end to end. Use when the user asks to deliver a change, deliver a finalized design, or take it through implementation, independent review and a draft PR. Honor requested worktree instructions and report completion or blockers. An explicit delivery request authorizes scoped implementation, commit, push and draft-PR creation, subject to repository rules and user restrictions; not merge, deploy or flag enablement."
---

# Deliver

Own the delivery loop for a specification, rough plan or sufficiently explicit request. The parent integrates and verifies; fresh subagents perform each applicable stage. This skill orchestrates, not replaces, the stage skills.

## 1. Prepare and accept the approach

- Read the request, specification, repository instructions and relevant code/tests. Establish the outcome, supported flow, exclusions, accepted trade-offs, checks, branch/worktree, dependencies and permissions. Preserve settled product decisions; ask only about material ambiguity or unsafe prerequisites.
- An explicit user request to run the delivery workflow—including a natural-language request such as “deliver this design”—authorizes scoped implementation, review/remediation, commits, push and a draft PR. Merely loading or mentioning this skill does not grant publication permission. More restrictive instructions still apply. Do not stage unrelated work, force-push, merge, deploy, enable flags or alter external trackers without separate authorization. Preserve credentials, data and other owners' work.
- Stay in the current session/worktree unless requested otherwise. For a requested new worktree, follow repository guidance, refresh/verify the base and use an unoccupied branch/path. Never reset or steal another owner's checkout.
- For stacked work, read [Stack foundations](../build/references/stack-foundations.md) and the upstream `gh-stack` skill during preparation. Establish helper tracking and worktree ownership before implementation; include the verified stack/base/owners in stage assignments and serialize stack mutations across the clone.
- **Check readiness and necessity before build.** A build-ready spec resolves behavior, implementation locations, non-requirements and checks. For rough input, delegate design first for a direction checkpoint and build-ready spec. Before accepting either a supplied spec or the design report, identify the ordinary operation, actual variation and rule owners. Challenge mechanisms that add unrequested guarantees or only support unnecessary machinery; being specified is not sufficient justification. Surface conflicts without silently removing approved requirements. Resolve material direction/flow questions with the user; otherwise retain stated defaults and leave extras out.
- Apply global AGENTS.md task-memory policy as the delivery parent, including owner resolution and tracking opt-out. Establish the grounding described below before launching children.
- For consequential structural choices, read [Codebase Design](../codebase-design/SKILL.md) when accepting the approach. Carry the accepted caller contract, responsibility owners, consequential effects and relevant trade-offs into stage assignments; verify they survive build and review without mandating extra architecture work or reopening settled decisions.

## 2. Build and verify

Delegate the accepted scope to a build child. Inspect the integrated diff, confirmed gaps/spec conflicts and test delta against the build skill's necessity, design and test policies. Worker confidence or completion alone is not verification.

Run or independently confirm relevant checks, including affected retained acceptance specs before publication, even for shared copy/components. Honor environment ownership, DB isolation and external-service mocks. Never run children concurrently against shared databases, competing branch operations or the same files; never let them independently reset, migrate or seed shared data. An unsafe test environment is a blocker, not permission to use shared or real data. Distinguish mocked regressions from separately authorized real integration acceptance. Report commands actually run and results, not merely starts or worker claims.

## 3. Review independently

Use one fresh, read-only review child after integration. Supply:

- Intended behavior, spec, supported flow, exclusions and accepted trade-offs.
- Exact base commit/range plus relevant staged, unstaged and task-owned untracked files. Do not let a default HEAD diff omit committed work or new files.
- Repository/worktree, applicable guidance and connected callers/tests. Require review of mechanisms and responsibility boundaries as well as spec conformance; do not coach toward a clean verdict.
- No edits, commits, publication, external writes or runtime commands against shared environments. Parent runs tests by default; separately authorized safe checks must not race with other DB users.
- Actionable findings with severity, file/line, impact and smallest correction; the review skill's exception-based **Test review**; material unreviewed risks and exact revision/diff scope.

Use a second reviewer only for a distinct material risk or required project review, not automatic fan-out.

## 4. Disposition, remediate and verify

- Check every finding against code, supported behavior and existing protection. Fix confirmed defects in specified behavior at their existing owner and behavior-preserving clarity problems. Record concise evidence-backed reasons for declining findings. No accepted fixes is a valid result.
- **New behavior still needs a scope decision.** New guarantees, policies, recovery behavior, storage or architectural contracts are not routine corrections. Ask the user before accepting them; decline proposals contradicting settled non-requirements. A security label does not expand permissions: preserve required trust-boundary protections and escalate changes that materially alter approved behavior or conflict with an accepted trade-off.
- Apply justified test consolidation and stub repairs while retaining distinct regression protection. Added tests must meet review's missing-test bar, not merely cover another branch.
- Record the report and disposition, then delegate accepted fixes to a fresh remediation child—not the builder or reviewer. Supply the spec, prior reports and exact accepted scope. Skip this stage when no fixes are accepted.
- Rerun affected checks. One review round by default; use focused fresh review when remediation materially changes behavior, security boundaries or architecture, not for trivial corrections. Inspect the final integrated diff/generated outputs and disclose meaningful post-review deltas.
- Do not silently publish with a known correctness/security defect or failed required check. Resolve it or ask whether an explicitly disclosed incomplete draft is wanted. State optional/unavailable checks honestly; a PR does not certify CI.
- Stop cycling when a finding needs a product decision or remains unresolved after remediation. Explain the blocker rather than churning edits.

## 5. Publish a draft PR

After parent verification, give a fresh PR child the final diff scope, intended base, verification receipts, review disposition and scoped commit/push/draft-PR permission. It must read the open-pr SKILL.md fully and follow it with repository commit/PR instructions, use required stack tooling and confirm task-only changes before staging. It must not change implementation or mutate another owner's stack.

Update an existing task PR rather than duplicate it. Preserve unrelated content/metadata and draft/ready state as instructed. After a failed or lost publication response, inspect remote state before retrying.

Require the PR URL, base/head IDs, final title/body and publication receipts. The parent reads the diff first, then audits the actual PR against open-pr's final check, repository requirements, intended base/state and verification claims—not just the child's summary. If correction is needed, record it, use a fresh narrowly scoped PR child and recheck. Surface unresolved nonblocking risks; distinguish tests run from suggested manual checks.

## 6. Notify and stop

Verify the PR exists and targets the intended base. Report its URL and draft state, concise outcome/boundaries, checks/results and material gaps, fixed/declined findings with reasons, and remaining risks. If blocked, state where and what is needed; do not claim completion. Use external notification only if requested. Do not wait indefinitely for user/CI or infer permission to merge, deploy, enable flags, edit trackers or start another slice.

## Stage assignments

Use a fresh child for each applicable stage when coding-subagent tools are available, even for small stage work. Each reports to the parent, never launches the next stage. Do not substitute Herdr sessions or research/analysis launchers. If subagents are unavailable, do the work in the parent and label review parent-only; ask before publication when independent review is an explicit prerequisite that cannot be met.

Use design for spec refinement, build for implementation and remediation, review for independent review, and open-pr for publication. Read each stage's actual SKILL.md on entering it and require the child to read it fully, plus relevant supporting references resolved from its directory. Use session-advertised absolute paths; default sibling paths are ../design/SKILL.md, ../build/SKILL.md, ../review/SKILL.md and ../open-pr/SKILL.md. Report missing prerequisites rather than inventing guidance. Do not delegate the deliver orchestrator itself.

Follow global AGENTS.md delegation policy. In each assignment, distinguish authoritative context (owner TODO ID and canonical design artifact/document) and evidence/report paths from transient execution scope (worktree, exact base/revision and task-owned files, permissions and stop condition). Carry the accepted flow, caller contracts, owners/effects, decisions, exclusions and consequential unsaved deltas. Require relevant full reads; supply bounded material when TODO access is unavailable. Put task context in `message` and task-specific boundaries/quality gates in `instructions`.

## Grounding and handoffs

- **Durable grounding:** the owner TODO and canonical design own shared understanding; the parent curates consequential findings under global AGENTS.md policy. Do not create a parallel comprehensive handoff ledger or a child TODO per stage. Keep detailed QA/review/execution evidence with its native owner, linking material conclusions and limitations rather than copying reports. Stage changes alone require no checkpoint or bookkeeping turn.
- **Transient execution:** keep any needed revision/worktree, resource leases, temporary permissions and report routing outside the repository, linked to authoritative context. Saved permissions are context, not renewed authorization.
- **Tracking declined or unavailable:** disclose the limitation and use a task-specific `handoff.md` outside the repository, preferably an existing artifact location or unique `/tmp` directory. Capture objective, supported flow, decisions/exclusions/trade-offs, worktree, stage, revision scope, permissions, spec/report paths, disposition, blockers and next action; link substantive detail. Temporary files can survive compaction but not guaranteed cleanup or machine loss; a `/tmp` pointer alone is not durable preservation. A missing TODO parameter does not justify this fallback.

Each child reads relevant grounding and full prior reports as needed. Its complete final answer is the default stage report: affected files, decisions, unresolved issues, commands/results and exact revision scope. The native subagent extension saves it and returns the result path to the parent after settlement. Do not require a duplicate summary file or ask the worker for that manager-owned path before settlement. Separate reports are for substantive supporting detail or workflow requirements; preserve prior evidence. Registered research file-report transport and QA Toolkit/native artifacts retain their reporting contracts. Parent-only fallback reports directly without claiming a native child result.

The parent reads full saved results when needed, not just notification summaries, checks consequential claims against code/scope and decides whether to proceed. After interruption/compaction, read current grounding/reports and reconcile live worktree and remote state before continuing; never replay edits or publication merely because context was lost. Never store credentials, PHI or sensitive payloads in memory or handoffs.

A user-requested fresh parent session is separate from stage delegation. Use the handoff skill with a brief requiring it to read/follow deliver; do not start another session merely because deliver was invoked.
