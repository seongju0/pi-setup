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
- Apply the global AGENTS.md role-aware task-memory policy even when no TODO was supplied explicitly. As the delivery parent, resolve/attach the durable owner; the task/outcome, not its sessions, stages or worktrees, owns grounding. Honor the policy's creation/scope approval and disclosed fallback when tracking is explicitly declined or unavailable.
- Establish the authoritative grounding below before launching children; do not maintain a second comprehensive handoff ledger when a durable todo already owns it.

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

Follow the global AGENTS.md delegation contract. Distinguish the owner TODO ID, authoritative design artifact ID or stable canonical document path, and evidence/native result/report paths from the child's current bounded assignment/worktree, exact revision scope, permissions, required skills and stop condition. Include relevant settled decisions, non-requirements and consequential unsaved deltas. Require full reads of relevant material; when a worker lacks TODO access, supply enough relevant context without creating another authoritative copy. Parent-owned workers consume supplied ownership/context and return evidence; owner resolution and durable curation remain with the parent under the shared contract. Put task context in `message` and task-specific boundaries/quality gates in `instructions`; delegation never expands authority.

## Grounding and handoffs

Use one authoritative current grounding record:

- **With the resolved durable TODO:** its state/decisions and relevant specifications own project grounding under the global task-memory policy. Do not also maintain a comprehensive `handoff.md`, authored progress/next-action summaries, or checkpoint solely because the stage changed. Detailed stage reports stay with their native workflow; the parent curates consequential reusable findings, choices, uncertainty and material completion/limitations into the TODO. Parent records hold shared conclusions; independently owned child outcomes hold their own detail, not one child item per stage or worker.
- **Transient execution handoff:** if needed, keep exact revision/worktree, resource leases and report routing outside the repository. Link authoritative context rather than maintain a competing full project summary; temporary stage permissions do not become durable authorization.
- **Only if durable tracking is explicitly declined or unavailable:** explain that limitation and use a task-specific `handoff.md` outside the repository, preferably in an existing artifact location or a unique /tmp directory. It holds the objective/worktree, supported flow, decisions, exclusions/trade-offs, permissions, stage, revision scope, spec/report paths, findings/disposition, blockers and next action. Link substantive detail rather than repeat it. Temporary files survive compaction, not guaranteed cleanup/machine loss; a `/tmp/` pointer alone does not durably preserve essential understanding. A missing TODO parameter is not grounds for this fallback.

Each child reads the relevant grounding and full prior reports as needed. Its complete final answer is the default stage report: include affected files, decisions, unresolved issues, commands/results and exact revision scope. The native subagent extension saves that answer automatically and supplies the result path to the parent after settlement; do not require a duplicate file or ask the worker to return that manager-owned path before settlement. Request a separate report only for substantial supporting detail or a workflow requirement; preserve prior evidence. Registered research file-report transport and QA Toolkit/native artifacts retain their own reporting contracts. In parent-only fallback, report directly without claiming a native subagent result exists.

The parent receives the result path automatically, reads the full saved result when needed rather than relying on a notification summary, checks it against code/scope, and decides whether to proceed. Keep detailed QA plans, fixtures, runs, recordings and results in their native reports, not copied into TODO; a consequential acceptance limitation can earn a concise finding and evidence pointer. Update authoritative state only when meaningful progress or a consequential finding warrants it; replace stale claims and consolidate current understanding during that update. Do not add a mandatory checkpoint/compression cycle or extra bookkeeping turn. Preserve independent review, disposition, verification and scoped publication gates; no child-to-child bypass.

After interruption/compaction, read current grounding/relevant reports and reconcile actual worktree/remote state before continuing. Never replay edits or publication solely because context was lost. Never store credentials, PHI or sensitive payloads in handoff files or todo.

A user-requested fresh parent session is separate from stage delegation. Use the handoff skill with a brief requiring it to read/follow deliver; do not start another session merely because deliver was invoked.
