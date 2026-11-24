# Assigned artifact reads for subprocesses

A worker can read the Context documents its parent assigns without receiving the
parent's project brief, conversation, discovery tools or writers. Context supplies
this read capability; the parent and chosen launcher still own the handoff,
execution permissions and integration of returned work.

```text
Parent selects exact source IDs + current body versions
  → initial preparation verifies all sources in an existing store
  → child receives fixed grants and a scoped read tool
  → each read checks the grant and current catalog/body in one read-only transaction
```

## Supply the sources, not just links

Give a worker exact read targets and source roles (governing versus supporting or
historical), available version/freshness, current task scope/permissions and a stop
condition. Artifact references do not grant access to their referenced documents.
Check that all required supporting sources are available before launch.

The optional [native subagent adapter](../../subagent/README.md#assigned-context-documents)
accepts `contextArtifacts` on spawn:

```javascript
subagent({
  action: "spawn",
  name: "source-reader",
  contextArtifacts: [{
    id: "<complete source-owner UUID>",
    artifact_id: "<complete artifact UUID>",
    expected_version: "<opaque current version from supported Context metadata/read>"
  }],
  message: "Read the assigned document in full. It is supporting context, not execution authority. Do not edit files. Return findings or exact missing/conflicting inputs with partial findings, then stop."
});
```

These placeholders are not real read targets. Obtain actual IDs and versions from
supported Context tools; do not infer versions from owner revisions or filenames.
Versions identify the current artifact body token, not a historical selector.

When the launcher lacks this capability, provide complete pinned snapshots/inline
material or accessible absolute external file paths through the existing handoff.
External files stay with existing authorized file tools: there is no Context
file-grant schema, file broker or new file-versioning guarantee. Keep combined body
output bounded as well as each page. Tool availability does not prove full reading
or semantic compliance.

## Version 1 public integration API

Copy the whole `context/` directory. `delegation.ts` uses Node/local domain modules
only; `reader.ts` is the explicit Pi host adapter. Neither is an auto-discovered
second entry. The ordinary `index.ts` and its full APIs remain unchanged.

- `prepareArtifactDelegation(grants, signal?)` captures the parent's configured
  `PI_TODO_PATH`/default root, canonicalizes the existing directory, validates exact
  grants and verifies every assigned owner/catalog/version/body. Use only at
  initial spawn, before reserving/starting the worker.
- `validateArtifactDelegation(value)` is pure shape/protocol validation. It rejects
  unknown fields/protocol, nonabsolute or invalid saved roots, malformed UUIDs,
  invalid/oversized version tokens and duplicate owner/artifact pairs. It performs
  **no filesystem, store or freshness check** and preserves the saved root.
- `readDelegatedArtifactPage(delegation, input, signal?)` checks fixed membership,
  opens a fresh read transaction, selects only the exact owner and artifact,
  compares its current catalog version and returns one bounded page.
- `scopedArtifactReader(delegation)` from `reader.ts` returns a Pi extension factory
  registering **only** `context_project_artifact`. Configuration validation during
  registration is pure; unavailable/stale sources cannot prevent loading.

The JSON-compatible saved configuration is:

```typescript
{
  protocol: "context-artifact-read-v1",
  root: "<canonical absolute existing root captured in parent>",
  artifacts: [{ id, artifact_id, expected_version }]
}
```

The child cannot choose the root. Freeze grants at spawn; persist this snapshot in
private child state and regenerate the extension wrapper from it at **every**
launch. Generate source using `JSON.stringify`, not executable input interpolation.
Load only the scoped wrapper, never Context's ordinary `index.ts`. Explicit
`--tools` users must include `context_project_artifact`. Native adapter startup
relies on supported Pi SDK 1.6.0 fatal RPC extension-load errors and existing
ChildRpc process-exit rejection, not a custom readiness command.

Only parent-supplied owner/artifact IDs and versions belong in system read-target
metadata. Do not inject retrieved catalog titles/descriptions, project text or
bodies there. Supply source-role labels and current execution authority separately
in the task assignment.

## Child read contract and lifetime

`context_project_artifact` accepts only:

```typescript
{ action: "read", id, artifact_id, expected_version, offset?: number, limit?: number }
```

All IDs are complete UUIDs and `expected_version` is required even at offset 0.
`offset` defaults to 0; `limit` defaults to 12000 and accepts 1–12000 characters.
The result is `{id, artifact_id, version, body, offset, next_offset, total_chars,
complete}`. Text and structured output contain the same page only. Continue with
the same IDs/version and `next_offset` until complete. No hidden full-body result,
owner brief, project search, reference traversal, knowledge read, task registration,
attachment, refresh or mutation is exposed.

- Ungranted pairs or wrong pins fail without revealing unrelated source metadata.
- Every actual read freshly verifies the fixed grant against the current catalog
  and body in one transaction; no Located object or connection is cached.
- Metadata-only/unrelated changes that preserve the body token remain readable.
  Retained reference/superseded/hidden artifacts remain explicitly assignable.
- A changed body fails even on page 0. Older retained bytes are not a historical
  selector. Report the mismatch to parent; never silently advance or drop the pin.
- Send/stop/status cannot replace grants. Stop/reopen and parent restore preserve
  saved root/grants, pure-validate configuration and regenerate the wrapper, without
  rechecking source/store existence or freshness. Thus a stale/unavailable source
  does not block a parent's explicit pinned snapshot/file follow-up; actual reads
  still fail. An idle live child has the same fixed scope.
- Missing, unsupported, corrupt or busy stores and missing bodies fail explicitly;
  no initializing/full-Context/raw-file/legacy fallback exists in the reader.

If blocked, the worker reports exact missing identities/topics and why, plus
partial findings, then ends its run. The parent can supply explicitly authorized
pinned material to that conversation or spawn a new child with revised grants.
Already delivered information cannot be revoked; a send does not prove the model
refreshed its cached understanding.

## Storage and authority boundaries

The reader requires an existing regular nonsymlink `todo.sqlite` under an existing
root (root symlinks may canonicalize). It uses SQLite `readOnly:true`, exact
schema2/Project3/application/WAL validation, a synchronous transaction and
operation-scoped close. It never creates the root/database/schema or invokes the
ordinary initializing `withRead`. SQLite may create/change WAL/SHM sidecars for
live WAL reads; this is not an immutable or byte-frozen-directory promise.
Ordinary full Context initialization and writers retain their existing behavior.

This is an API scope boundary, **not a malicious-worker sandbox**. Workers still
have same-user filesystem/bash permissions. Grants and stored approvals do not
supply current execution authority, authorize commits/publication/service writes,
or confer broader project/knowledge access. Context defines no worker roles,
stage ordering or review orchestration, and the reader writes no durable memory.

Source adoption and reload remain operator-controlled. Repository changes and
synthetic tests do not activate `contextArtifacts` in an older installed launcher;
use the snapshot/file fallback until compatible source is deliberately adopted.
