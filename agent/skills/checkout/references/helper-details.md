# Checkout helper details

Use this reference for rejected inputs/options, configuration, refresh-receipt or output investigation, and older-cache compatibility. Ordinary repository inspection follows `SKILL.md`.

## Reference grammar

- Accepted forms: HTTP(S) repository URLs, `ssh://user@host/namespace/repo`, `user@host:namespace/repo`, host-qualified paths, and `owner/repo` shorthand.
- Shorthand uses `CHECKOUT_DEFAULT_HOST` (default `github.com`). A dotted first component identifies an unprefixed host. Non-GitHub hosts support nested organization/group paths; references must contain at least a namespace and repository.
- Hosts must be ASCII DNS-style names without ports, credentials (apart from the SSH user in SSH forms), IPv6 literals, empty labels, or leading/trailing label hyphens.
- Namespace/repository components allow ASCII letters, digits, `_`, `-`, and `.`; one terminal `.git` is removed. Empty components, raw `.`/`..`, whitespace/control characters, backslashes, percent escapes, local/file paths, and unsupported schemes are rejected before filesystem or Git operations.
- URL query strings and fragments are ignored, and one trailing slash on a repository URL is accepted.
- The parser can reduce GitHub deep links (`tree`, `blob`, `pull`, `issues`, `commit`, `actions`, `releases`, `compare`, `wiki`) to `owner/repo`. This capability is **not** an automatic trigger to use the skill and does not select the linked revision or resource. Other GitHub suffixes and GitLab `/-/` resource paths are rejected; non-GitHub paths otherwise represent nested namespaces, not revision selectors.

## Options and configuration validation

Flags may precede or follow the single repository argument. Unknown options, extra arguments, duplicate `--update-interval` options, and missing values fail.

`--update-interval` overrides `CHECKOUT_UPDATE_INTERVAL` and accepts decimal non-negative safe integers in seconds; `0` refreshes every reuse. `--force-update` bypasses the interval, not validation. `--help` alone displays usage without accessing Git or the cache. There is no configuration file.

Relative `CHECKOUT_CACHE_ROOT` values resolve against the caller's working directory; an initial `~/` expands using HOME. Empty roots and control characters are rejected. An intentionally symlinked root is supported, but descendant symlink escapes are rejected.

## Refresh receipts and output

The helper records decimal Unix seconds in `pi-checkout-last-fetch` in Git's administrative directory (normally `.git/pi-checkout-last-fetch`), only after successful clone/fetch. Missing, malformed, or future receipts trigger a refresh; unreadable/unwritable receipts are errors. The receipt records **fetch success, not working-tree currency**.

With `--path-only`, stdout contains only the checkout path on success; Git diagnostics may appear on stderr. Without it, the helper reports the normalized repository URL, checkout path, and clone/reuse, fetch, and fast-forward states:

| Situation | Clone/reuse | Fetch | Fast-forward |
|---|---|---|---|
| Successful clone | `cloned` | `fresh` | `not-needed` |
| Reuse within the interval | `reused` | `throttled` | `not-attempted` |
| Fetch succeeded; tracked changes, detached HEAD, or no resolvable upstream | `reused` | `fresh` | `skipped` |
| Fetch succeeded; merge returned success | `reused` | `fresh` | `applied` |
| Fetch succeeded; merge refused | `reused` | `fresh` | `not-applied` |

`applied` is the merge command's success outcome, not proof that new commits were needed. Skipped/refused fast-forwards warn and still return a successful path; clone/fetch failures do not. Only `origin` is fetched, even when the current branch's upstream belongs to another remote.

## Existing-cache compatibility

Existing cache paths, branches, and files are reused without migration. **The first reuse by this helper fetches once if the new receipt is absent**, regardless of any older timestamp. Older receipts, including `.git/checkout-last-fetch`, are not read, converted, or deleted. Configuration names remain unchanged; former `LIBRARIAN_*` variables remain retired.
