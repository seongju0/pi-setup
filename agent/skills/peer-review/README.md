# peer-review

A small PR-facing entry point for evaluation. It reuses `review` for correctness, compatibility, effects, test quality and findings, and `codebase-design` for pragmatic design reasoning. SOLID, KISS, DRY and YAGNI are aids—not compliance scores.

## Adopt and use

Copy this directory with sibling `review/`, `codebase-design/` and `build/` (Review requires `build/references/testing.md`). Copy `walkthrough/` too when combining evaluation with explanations. Preserve existing files and local changes when updating.

```text
/skill:peer-review https://github.com/OWNER/REPO/pull/123
```

A bare PR URL is an automatic selection target; an explicit explanation-only request uses `walkthrough` and its `references/pr-walkthrough.md`. Selection is model-mediated, not a URL router. Local diff reviews retain `review`. Both explanation and evaluation default to chat, not generated HTML.

Requires repository/PR access, normally through authenticated `gh`, plus Git for local source inspection. Applicable framework skills remain external dependencies. There is no summarize-pr, browser, HTML template or rendering-validator dependency. No automatic installation, code fixes, PR writes, publishing or watching.

## Check the behavior

Try a normal PR review, an explanation-only request, a meaningful follow-up and a local diff review with the skills discoverable in a fresh agent. Check correct routing, source-grounded findings, concise context and stated verification limits. For a stacked PR, check that an earlier layer's implementation is distinguished from a later layer's wiring. No findings is valid; source inspection is not a runtime test.

`npm test` checks Pi discovery and retained repository suites, not live GitHub access, routing or review quality. The conversational examples used for the refinement came from in-chat layer explanations; fresh-agent validation must be reported separately.
