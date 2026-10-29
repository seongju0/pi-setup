---
name: deliver
description: "Deliver an approved change end to end: firm up the spec if rough, build, independently review, remediate and verify, open a draft PR, then notify the user for review. Explicit invocation authorizes scoped implementation and the commit/push/draft-PR steps needed for delivery, subject to the user's restrictions and repository rules. Does not merge, deploy or enable flags."
disable-model-invocation: true
---

# Deliver

Own the complete delivery loop for the supplied specification, rough plan or sufficiently explicit request. The parent prepares, integrates reports, verifies, approves publication scope and notifies; fresh subagents do each applicable stage (see **Subagents by stage**).

```text
parent: prepare
  → child: design (if rough) → parent: record + accept
  → child: build            → parent: record + inspect + verify
  → child: review           → parent: record + disposition findings
  → child: remediate (if needed) → parent: record + inspect + verify
  → child: draft PR         → parent: record + audit PR + notify → stop
```

This skill orchestrates existing skills; it does not replace them. Read their actual `SKILL.md` files when entering each stage, using the paths advertised by the session. For these user-installed skills, the default paths relative to this directory are `../design/SKILL.md`, `../build/SKILL.md`, `../review/SKILL.md` and `../open-pr/SKILL.md`. If a required skill is unavailable, report the missing prerequisite instead of inventing its instructions.

## 1. Prepare

- Read the request, referenced specification, repository instructions and relevant code/tests. Establish the outcome, exclusions, non-requirements/accepted trade-offs, acceptance checks, base/branch/worktree, dependency state, safety constraints and publication permissions. Preserve settled product decisions; pause only for a material ambiguity or unsafe prerequisite.
- Explicit invocation of this workflow requests implementation, review/remediation, scoped commits, push and a draft PR. More restrictive user or repository instructions still apply. Do not stage unrelated changes, force-push, merge, deploy, change live flags or alter external trackers without separate authorization. Preserve existing credentials, data and other owners' work.
- Stay in the current session and worktree unless the request specifies otherwise. If a new worktree is requested, follow the repository's worktree guidance, refresh/verify the requested base and create an unoccupied branch/path before editing. Never steal or reset another owner's checkout.
- **Check spec readiness.** A build-ready spec names files/symbols, behavior, non-requirements and checks. If the input is a rough plan or idea instead, run a design pass (design skill, via a subagent) before building. If its direction checkpoint raises flow questions or a material direction choice, stop and ask the user before building; otherwise continue with its stated defaults.
- Track substantial work with the session task tool. If an existing durable work item is supplied, preserve its scope/dependencies and record meaningful progress and receipts under its rules; do not create new durable work items without user intent.
- Before the first child starts, establish the file-backed handoff described below. Every stage reports to the parent; the parent records its disposition before launching the next stage.

## 2. Build

Delegate to a build subagent per **Subagents by stage**, requiring a full read of the build skill using the global delegation convention. Implement the smallest complete change, including affected callers, tests, config and generated contracts. The parent stays responsible for the integrated result: inspect the diff, its "possible gaps not handled" list and its test delta (push back on per-class spec files or internal stubs), and run or confirm verification itself.

Run relevant verification as the change develops, including affected retained acceptance specs before publication—even when only shared copy/components changed. Honor environment ownership, database isolation, external-service mocks and other repository safety rules before tests or generation. Distinguish mocked regression coverage from separately authorized real integration acceptance; neither substitutes silently for the other. An unsafe test environment is a blocker, not permission to use shared or real data. Report checks actually run and their results; never equate a command starting, an error response or a worker's claim with verified behavior.

## 3. Review independently

Use one fresh review subagent by default after the integrated change is coherent. Supply:

- The intended behavior, specification path, exclusions, non-requirements/accepted trade-offs and repository/worktree.
- An exact review target: base commit/range plus relevant staged, unstaged and task-owned untracked files. Do not let the review skill's default HEAD diff accidentally omit committed work or new files.
- The review skill's absolute `SKILL.md` path and a requirement to read it fully using the global delegation convention, plus applicable project guidance and supporting references; inspect connected callers and tests, not only the diff.
- Read-only permission: no edits, commits, pushes, external writes or runtime commands against shared environments. Parent runs tests by default; separately authorized safe checks must not race with other DB users.
- Required output: actionable findings with severity, file/line, impact and minimal fix; the review skill's "Spec review" section (keep/merge/delete/repair per spec file); material unreviewed risks; exact reviewed revision/diff scope.

Do not coach the reviewer toward a clean verdict. A second reviewer is justified only for a distinct material risk or required project review, not automatic fan-out. If subagents are unavailable, perform and clearly label a parent-only review; do not claim independence. Ask before publication if independent review is an explicit project/user prerequisite that cannot be met.

## 4. Remediate and verify

- Inspect every finding against the code and intended behavior. Fix valid issues; record a concise evidence-backed reason for declining a finding. Do not change product scope just to satisfy a reviewer.
- **Do not auto-fix new safeguards.** A finding that proposes a guard, lock, re-check, fallback or recovery path the spec does not include is a flow question for the user, not a fix. Decline it outright when it contradicts a stated non-requirement. Apply the "Requirements you don't have" rules from the build and review skills.
- **Apply spec consolidation by default.** Merge, delete-as-covered and stub-repair findings are normal fixes when a named retained test still protects the behavior. Requests for added tests must meet the review skill's missing-test bar.
- After recording the review report and your disposition, launch a fresh remediation subagent. Give it the approved spec, build report, full review report and accepted findings with exact scope; require a full read of the build skill using the global delegation convention. It implements only accepted fixes, reports what changed and leaves publication to the PR stage. Do not resume the builder or let the reviewer edit. Skip remediation when no fixes are accepted.
- Rerun affected checks after fixes. One review round by default; request focused fresh review when remediation materially changes behavior, security boundaries or architecture. Trivial corrections do not require restarting the entire review loop.
- Review the final integrated diff and generated outputs yourself. Ensure the review scope still covers the delivered change; identify any meaningful post-review delta.
- Do not silently publish with a known correctness/security defect or failed required check. Resolve it, or report the blocker and ask whether an explicitly disclosed incomplete draft is wanted. Optional/unavailable checks must be stated honestly; a PR is not test or CI certification.
- Stop cycling if a finding requires a product decision or the same issue remains unresolved after remediation. Explain the specific blocker rather than churning edits.

## 5. Open a draft PR

After parent verification, launch a fresh PR subagent. Give it the accepted final diff scope, intended base, exact verification receipts, review disposition and scoped publication permission. Require a full read of the open-pr skill using the global delegation convention; require reads of repository-specific commit/PR instructions and relevant supporting references. Use the exact repository template, intended target branch and ticket conventions. Confirm the final diff contains only the task's work before staging/committing. Use repository stack tooling when applicable; do not mutate another owner's stack.

The PR child creates the scoped commits and pushes needed to open the draft PR; it must not change implementation. If a task PR already exists, update it rather than create a duplicate. Do not overwrite unrelated PR content or change draft/ready status contrary to the request. If publishing fails or a response is lost, inspect remote state before retrying.

The child returns the PR URL, base/head commit IDs, final title/body and publication receipts. The parent independently reads the diff before judging the description, identifies the consequential relationships and behavior changes, then checks whether the published visuals expose them. Do not accept "illustration-first" merely because a code fence, before/after layout or diagram exists. If surrounding prose is needed to reveal the central change, request a revision. Check the actual PR against the open-pr skill's publication gate and repository instructions: correct diff/base/state, concise illustration-first explanation, accurate implemented flow, and verified testing claims. Also cut duplicated explanation and reusable setup recipes that belong in linked documentation. Do not accept only the child's summary. If corrections are needed, record them and use a fresh, narrowly scoped PR child, then recheck.

The PR must accurately explain delivered behavior, important preserved/failure paths, verification and limits. Distinguish tests run from suggested manual steps. Surface unresolved nonblocking review risks. Do not infer permission to merge, deploy, enable flags, edit Linear or start the next slice.

## 6. Notify and stop

Verify the PR exists and targets the intended base. Report to the user in this session:

- PR URL, marked draft and ready for the user's review.
- Concise outcome and important boundaries preserved.
- Tests/checks run and results; unavailable checks and CI state if checked.
- Review findings fixed, declined findings with reasons, and remaining risks.

If delivery is blocked, report where it stopped and what is needed; do not claim completion. Use an external notification channel only if requested. Do not wait indefinitely for the user or remote CI. Stop after the report; no merge, rollout or additional feature work.

## Subagents by stage

Use a fresh subagent for each applicable stage when the session has coding-subagent tools; the user should not need to ask. Each child reports to the parent, never launches the next stage. The parent records the report and its own disposition in context and in the handoff before proceeding. Do not reuse a previous stage's child or bypass this sequence for trivial stage work.

| Stage | Owner | Notes |
|---|---|---|
| Prepare | Parent | Establish scope, permissions and handoff. |
| Design (rough input only) | Fresh child | Require full design skill read; returns direction checkpoint + spec. Parent resolves material questions before build. |
| Build | Fresh child | Require full build skill read; returns implementation and test delta. |
| Review | Fresh child | Require full review skill read; read-only. Second reviewer only for a distinct material risk. |
| Remediation (accepted fixes only) | Fresh child | Require full build skill read; reads prior reports; never the builder or reviewer. |
| Verification | Parent | Inspect the integrated diff and run or independently confirm checks. |
| Draft PR | Fresh child | Require full open-pr skill read; scoped commit/push/PR permission only after parent verification. |
| PR audit + notification | Parent | Read the actual PR, check against the open-pr skill and report to the user. |

- Give each subagent a self-contained brief: worktree, spec path, outcome, supported user flow, settled decisions, non-requirements, accepted trade-offs, constraints, permissions and expected deliverable. Identify the applicable stage skill by absolute `SKILL.md` path and require a full read before applicable work using the global AGENTS.md delegation convention. Require explicit reads of relevant supporting references, resolved from the skill directory. Put the task-specific brief, skill references and handoff paths in `message`; keep `instructions` focused on task-specific boundaries, working rules and quality gates. Do not delegate the deliver orchestrator to stage workers. Workers cannot inherit permissions beyond the task's authorization.
- Never run subagents concurrently against shared databases, competing branch operations or the same files. Never let agents independently reset, migrate or seed shared data.
- Worker completion alone does not prove correctness; check output against the integrated code. The parent owns the result, review disposition and publication.
- Do not substitute independent Herdr sessions or research/analysis launchers for coding subagents. If subagents are unavailable, do the stage in the parent and say so (and label review as parent-only).

## File-backed stage handoff

Use one task-specific handoff directory outside the repository (for example, a unique directory under `/tmp`). Prefer an existing task artifact location when it provides better persistence. Temporary files survive context compaction, not guaranteed cleanup or machine loss; use durable artifact storage when longer retention is required. Do not store credentials, PHI or sensitive payloads in handoff files.

- The parent owns one current `handoff.md`: objective, repository/worktree, supported flow, settled decisions, exclusions, accepted trade-offs, permissions, current stage, exact revision/diff scope, report paths, accepted/declined findings with reasons, verification receipts, blockers and next action. Link the approved spec instead of copying it into every report.
- Give each child the handoff path, relevant full prior report paths and a unique output report path. Require it to read them before working, save its detailed stage report and return the report path plus a short summary. Reports preserve affected files, decisions, unresolved issues, verification commands/results and revision scope; do not overwrite earlier stage reports.
- On completion, the parent reads the full report, checks it against scope/code, then updates `handoff.md` and records a concise checkpoint with report paths in its session context. A child report alone does not authorize the next stage. No child-to-child handoff bypasses the parent.
- After compaction or interruption, read the current handoff and relevant reports, then reconcile with actual worktree and remote state before continuing. Do not repeat edits or publication solely because conversation details were lost.

## Handoff composition

Starting a fresh parent session is separate from these file-backed stage handoffs and from delivery. If the user requests a fresh session, the handoff skill should launch it with a brief explicitly instructing it to read and follow this deliver skill. Do not start another session merely because this skill was invoked.

Example request: `/skill:handoff — have the new session read /skill:deliver and deliver this spec in a new worktree off main.`
