# Stack foundations

Use this checklist before starting, extending or rebasing a stack. Follow the
installed upstream `gh-stack` skill and its relevant references for command
behavior; this checklist does not replace them. If that skill or executable is
missing, report the prerequisite rather than inventing a replacement workflow.
Permissions and repository rules still govern upgrades, Git changes and publication.

## Establish the foundation

- **Check the executable, not just the skill.** Read `gh stack --version` and the
  relevant `gh stack <command> --help`. Distributed worktrees need shared-catalog
  and owner-aware operations, introduced in v0.3.0. If the executable lacks the
  required capability, propose an official upgrade before a manual Git fallback.
  Finish or recover an existing operation before changing tool versions; do not
  mix old and new writers in one clone.
- **Identify the base and owners.** Confirm repository, remote, trunk name and
  intended trunk tip; inspect `git worktree list --porcelain` and affected owners'
  status. Do not silently advance a trunk owned elsewhere. A saved base or
  `needsRebase: false` against stale local trunk does not establish currency with
  the remote. Select the remote explicitly where supported, or verify configured
  remote selection.
- **Keep three states aligned:** Git ancestry, local helper tracking, and GitHub
  PR order/bases. Existing PRs or a GitHub stack do not imply local registration.
  Check `gh stack view --json`, including its exit status. After an upgrade, even
  a view can trigger official legacy-catalog migration; serialize that access.

## Start and extend through the helper

- **New stack:** plan dependent concerns bottom to top, then use
  `gh stack init --base <trunk> <first-layer>` before implementing. Verify the
  resulting trunk and branch order. If the stack already exists on GitHub,
  import it instead of initializing a duplicate.
- **Next layer:** run `gh stack add <next-layer>` from the current top. Stage and
  commit deliberately; uncommitted changes can carry onto the new branch. Confirm
  the intended parent and register/adopt the layer before editing in a separate
  worktree. Follow repository worktree conventions without stealing a checkout.
- **Shared ownership:** affected worktrees must see the same ordered stack and
  current heads, apart from their current-branch markers. For occupied branches,
  use explicit-target `checkout --print-path` to find the owner; check success
  before changing directory. Path mode can check out an unoccupied target here.
- **Publish through the supported flow:** prefer `gh stack push` / `submit`
  within granted permissions and repository restrictions. `gh stack link` is
  API-only grouping for externally managed branches, not a worktree workaround;
  it does not maintain local tracking. Verify local and GitHub membership after
  an authorized addition or publication.

## Rebase and recover through the helper

- Edit the owning layer, then prefer `gh stack rebase` over a hand-written cascade.
  Serialize mutations across the clone and check affected owners are clean and
  free of another operation before starting.
- For a lower-layer edit without adopting new trunk changes, use
  `gh stack rebase --upstack --no-trunk --remote <remote>`. `--upstack` includes
  the current layer; `--no-trunk` skips trunk fetching/alignment. For an authorized
  trunk refresh, use the normal helper rebase with the intended base instead.
  `gh stack sync` also publishes; do not use it as a local-only rebase shortcut.
- Resolve and stage conflicts in the owner reported by the helper, then use
  `gh stack rebase --continue` or `--abort`. Do not switch to a different operation
  manager midway, delete locks/journals, or auto-stash another owner's changes.
- If tracking is absent or stale, inspect the existing GitHub stack and upstream
  recovery guidance. Prefer supported import via `gh stack checkout <stack-id>`.
  If replacement tracking is necessary, verify the target and preserve unrelated
  stacks; use explicit `gh stack unstack <stack-id> --local` before re-importing.
  Never omit `--local` for a local repair or hand-edit catalogs. Migration conflicts
  need reconciliation, not selection by timestamp. Import may fetch normally.
- Verify the resulting order, heads, ancestry, affected worktrees and recovery
  state. A successful view or no-op rebase is not proof of remote-trunk currency
  or full conflict handling. If the helper remains blocked, report the concrete
  capability or repository restriction and the narrow fallback before proceeding.
