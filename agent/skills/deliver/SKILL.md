---
name: deliver
description: "Deliver an approved change end to end: firm up the spec if rough, build, independently review, remediate and verify, open a draft PR, then notify the user for review. Explicit invocation authorizes scoped implementation and the commit/push/draft-PR steps needed for delivery, subject to the user's restrictions and repository rules. Does not merge, deploy or enable flags."
disable-model-invocation: true
---

# Deliver

Own the delivery loop for a specification, rough plan or sufficiently explicit request. The parent integrates and verifies; fresh subagents perform each applicable stage. This skill orchestrates, not replaces, the stage skills.

## 1. Prepare and accept the approach

- Read the request, specification, repository instructions and relevant code/tests. Establish the outcome, supported flow, exclusions, accepted trade-offs, checks, branch/worktree, dependencies and permissions. Preserve settled product decisions; ask only about material ambiguity or unsafe prerequisites.
- Explicit invocation authorizes scoped implementation, review/remediation, commits, push and a draft PR. More restrictive instructions still apply. Do not stage unrelated work, force-push, merge, deploy, enable flags or alter external trackers without separate authorization. Preserve credentials, data and other owners' work.
- Stay in the current session/worktree unless requested otherwise. For a requested new worktree, follow repository guidance, refresh/verify the base and use an unoccupied branch/path. Never reset or steal another owner's checkout.
- **Check readiness and necessity before build.** A build-ready spec resolves behavior, implementation locations, non-requirements and checks. For rough input, delegate design first. Before accepting either a supplied spec or the design report, identify the ordinary operation, actual variation and rule owners. Challenge mechanisms that add unrequested guarantees or only support unnecessary machinery; being specified is not sufficient justification. Surface conflicts without silently removing approved requirements. Resolve material direction/flow questions with the user; otherwise retain stated defaults and leave extras out.
- Track substantial work with session tasks. If a durable work item is supplied, preserve its scope/dependencies and record meaningful progress under its rules; do not create one without user intent.
- Establish the file-backed handoff below before launching children.

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

After parent verification, give a fresh PR child the final diff scope, intended base, verification receipts, review disposition and scoped commit/push/draft-PR permission. It follows the open-pr skill and repository commit/PR instructions, uses required stack tooling and confirms task-only changes before staging. It must not change implementation or mutate another owner's stack.

Update an existing task PR rather than duplicate it. Preserve unrelated content/metadata and draft/ready state as instructed. After a failed or lost publication response, inspect remote state before retrying.

Require the PR URL, base/head IDs, final title/body and publication receipts. The parent reads the diff first, then audits the actual PR against open-pr's final check, repository requirements, intended base/state and verification claims—not just the child's summary. If correction is needed, record it, use a fresh narrowly scoped PR child and recheck. Surface unresolved nonblocking risks; distinguish tests run from suggested manual checks.

## 6. Notify and stop

Verify the PR exists and targets the intended base. Report its URL and draft state, concise outcome/boundaries, checks/results and material gaps, fixed/declined findings with reasons, and remaining risks. If blocked, state where and what is needed; do not claim completion. Use external notification only if requested. Do not wait indefinitely for user/CI or infer permission to merge, deploy, enable flags, edit trackers or start another slice.

## Stage ownership and guidance

| Stage | Owner | Required skill / result |
|---|---|---|
| Prepare + spec acceptance | Parent | Scope, permissions and handoff; validate mechanism necessity. |
| Design (rough input) | Fresh child | Design; direction checkpoint + build-ready spec. |
| Build | Fresh child | Build; implementation, confirmed gaps/conflicts and test delta. |
| Review | Fresh child | Review; read-only findings, Test review and exact scope. |
| Remediation (accepted fixes) | Fresh child | Build; only accepted fixes and verification report. |
| Verification | Parent | Inspect integrated diff and run/independently confirm checks. |
| Draft PR | Fresh child | Open-pr; scoped publication receipts, no implementation edits. |
| PR audit + notification | Parent | Inspect actual PR and report to user. |

Use a fresh child for each applicable stage when coding-subagent tools are available, even for small stage work. Each reports to the parent, never launches the next stage. Do not substitute Herdr sessions or research/analysis launchers. If subagents are unavailable, do the work in the parent and label review parent-only; ask before publication when independent review is an explicit prerequisite that cannot be met.

Read each stage's actual SKILL.md on entering it and require the child to read it fully, plus relevant supporting references resolved from its directory. Use session-advertised absolute paths; default sibling paths are ../design/SKILL.md, ../build/SKILL.md, ../review/SKILL.md and ../open-pr/SKILL.md. Report missing prerequisites rather than inventing guidance. Do not delegate the deliver orchestrator itself.

Follow the global AGENTS.md delegation contract. Give a self-contained brief with worktree, outcome, supported flow, spec, settled decisions, non-requirements, permissions, required skills and report paths. Put task context in `message` and task-specific boundaries/quality gates in `instructions`; delegation never expands authority.

## File-backed handoff

Use one task-specific directory outside the repository, preferably an existing artifact location or a unique /tmp directory. Temporary files survive compaction, not guaranteed cleanup/machine loss; use durable artifacts for longer retention. Never store credentials, PHI or sensitive payloads.

- Parent owns handoff.md: objective/worktree, supported flow, settled decisions, exclusions/trade-offs, permissions, current stage, exact revision/diff scope, spec/report paths, accepted/declined findings and reasons, verification receipts, blockers and next action. Link the spec rather than copying it into every report.
- Each child reads the handoff and relevant full prior reports, writes a unique stage report and returns its path plus a short summary. Preserve affected files, decisions, unresolved issues, commands/results and revision scope; never overwrite prior reports.
- Parent reads the full report, checks it against code/scope, updates handoff.md and records a concise context checkpoint before launching the next stage. No child-to-child bypass.
- After interruption/compaction, read handoff/relevant reports and reconcile actual worktree/remote state before continuing. Never replay edits or publication solely because context was lost.

A user-requested fresh parent session is separate from these stage handoffs. Use the handoff skill with a brief requiring it to read/follow deliver; do not start another session merely because deliver was invoked.
