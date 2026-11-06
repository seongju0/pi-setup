# Session history

`session_history` retrieves raw historical text without changing compaction or
injecting context. Loading it creates no files, indexes, or background work.

- Search: `{ action: "search", query: "literal text", limit: 10 }`. Search is
  case-insensitive, preserves punctuation, and covers only the active branch's
  raw ancestry, including precompaction originals and active-context entries.
  Original messages precede derived visible coordination and summaries; newest
  entries come first within each group. Continue with the same query and returned
  `cursor`. Appended retrieval receipts do not extend an existing search.
- Read: `{ action: "read", ref: "pi-history:v1/session-id/entry-id" }` using an
  exact returned reference. Pages default to 12,000 characters; continue with
  `offset: next_offset`. `limit` is at most 20 for search or 12,000 for reads.
  Query, cursor, and reference inputs are bounded to 2,000, 6,000, and 2,000
  characters respectively. IDs in references are URI-encoded identifiers,
  never file paths.
- Explicit current-session references may read off-branch entries. Archived
  references resolve only in the configured session directory, for the exact
  session ID and same working directory. Deleted or missing sources fail; there
  is no global search, parent-session traversal, migration, or rewrite.

This is **raw journal history**, not current state, authorization, or permission.
Context edits do not erase originals. Tool requests, arguments, results/errors,
user bash commands/output, visible custom coordination, and derived summaries
retain their distinct provenance. Tool metadata uses `tool_name`, `tool_namespace`,
`tool_call_id`, and `is_error` when relevant. Verify live state before repeating
side effects.

There is **no redaction**: retrieved text enters the selected provider and may
contain sensitive original input/output. Thinking, system messages, hidden custom
messages, extension state, and image bytes are excluded. Image content blocks
appear only as `[image omitted]` markers. Reads return only the
requested normalized text page, not hidden full entries. Removing the source
removes archived retrieval availability.

Run temporary-source integration checks with:
`node agent/extensions/session-history/tests/test.mjs`.
