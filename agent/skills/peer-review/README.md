# peer-review

A small PR-facing entry point for evaluation. It reuses `review` for correctness, compatibility, effects, test quality and findings, and `codebase-design` for pragmatic design reasoning. SOLID, KISS, DRY and YAGNI are aids—not compliance scores.

## Adopt and use

Copy this directory with sibling `review/`, `codebase-design/`, `walkthrough/` and `build/` (Review requires `build/references/testing.md`). Walkthrough guides the explanation of findings; Review owns practical-flow actionability and severity. Preserve existing files and local changes when updating.

```text
/skill:peer-review https://github.com/OWNER/REPO/pull/123
```

A bare PR URL is an automatic selection target; an explicit explanation-only request uses `walkthrough` and its `references/pr-walkthrough.md`. Selection is model-mediated, not a URL router. Local diff reviews retain `review`. Both explanation and evaluation default to chat, not generated HTML.

Reports explain why each finding matters in a realistic flow and include proposed GitHub comments prefixed `[fix]` or `[nit]`. Prefixes distinguish defects from optional improvements, not severity; unresolved questions stay separate. Drafting comments does not post them.

Local inspection may fetch missing PR revisions and use a temporary detached source-only worktree without switching the user's branch. This does not install dependencies, initialize databases or run PR code. Executed evidence is a separate scoped pass; worktrees do not isolate runtime resources.

Requires repository/PR access, normally through authenticated `gh`, plus Git for local source inspection. Worktree creation and local execution also require the external `qa-toolkit` skill and applicable project-native guidance; these are not bundled here. Without that guidance, continue revision-specific source inspection and report the local-setup prerequisite. Applicable framework skills remain external dependencies. There is no summarize-pr, browser, HTML template or rendering-validator dependency. No automatic installation, code fixes, PR writes, publishing or watching.

## Check the behavior

Try a normal PR review, an explanation-only request, a meaningful follow-up and a local diff review with the skills discoverable in a fresh agent. Check correct routing, source-grounded findings, practical reachability and consequences, concise explanations, draft comment prefixes and stated verification limits. A direct-request bypass must not be called a demonstrated normal-UI failure; a Minor defect may still need `[fix]`, while an unresolved concern must not become a `[nit]`. For a stacked PR, check that an earlier layer's implementation is distinguished from a later layer's wiring. No findings is valid; source inspection is not a runtime test.

Also try a missing local head, a stacked comparison base, a dirty unrelated checkout, and a source-only review followed by a request for executed evidence. Check pinned revisions, no branch disturbance or implicit setup, QA handoff, snapshot-qualified results and non-destructive cleanup.

`npm test` checks Pi discovery and retained repository suites, not live GitHub access, worktree setup, routing or review quality. The conversational examples used for the refinement came from in-chat layer explanations; fresh-agent validation must be reported separately.
