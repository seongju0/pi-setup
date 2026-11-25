# Context

Independent projects, reusable knowledge and a separate session-local task board for Pi. Context preserves understanding; it does not execute goals, infer approval or synchronize project completion with Linear.

```text
Project — goal, findings, decisions, questions, research/design artifacts
  ├─ prerequisite → another project (completion constraint)
  ├─ required reference → direct source grounding or one source artifact
  └─ association → project or knowledge (navigation, not ownership)
Knowledge — independently versioned reusable explanation, scope, sources and review
Session tasks — ephemeral execution board, independent of both
```

## Adoption

Requires **Node.js 26+** (built-in SQLite) and a supported Pi installation providing `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` and `typebox`. Copy the **whole `context/` source directory**. No sibling source, installer, manifest, package install or companion skill is required. Session-history is optional enhanced journal retrieval; Linear uses existing configured MCP tools, not new credentials.

1. Compare/back up locally modified extension source.
2. Disable/remove **BOTH old `task/index.ts` and `todo/index.ts` source entries** from every actually loaded directory/configured path before loading Context. Preserve runtime `tasks/`, `todos/` and `sessions/` data.
3. Coordinate stopped old/new project writers and the separately authorized data upgrade below, if needed. Copying source does not migrate data or authorize a live upgrade.
4. Deliberately load/reload compatible code in an idle session before resuming writes. Development tests do not perform operator adoption or reload.

Do not load Context beside either legacy source entry. Pi conflict diagnostics do not disable old hooks: first-loaded tools may win while duplicate task snapshots and old-schema lifecycle errors still occur; commands may be renamed. No forwarding entry, automatic pruning or process-global guard chooses a winner.

The public `index.ts` registers Session tasks first, then Context exactly once. Both share one code-load boundary: a broken shared import can prevent the whole package from loading. Module state and lifecycle receipts remain separate. Healthy unattached task-only use neither opens nor initializes the Context database and needs no optional tools/services. See [Session tasks](tasks/README.md) for unchanged task IDs, JSON format, dependencies and snapshots.

## Memory contract

Use the relevant attached project for substantial enduring work, or inspect status/search candidates and attach a clear match. Ask on ambiguity or before switching owners. Create only on explicit user intent; honor tracking opt-out. A project may span worktrees, repositories and issues; cwd is not ownership. `get`/search/read alone never attach or start work.

Preserve distilled explanation: intent, why/how state arose, causal findings, choices and reasons, scope, nonobvious constraints, uncertainty and consequential completion implications. Context is not a session log, Git/PR history mirror or status ticker; code/history and QA/native reports remain canonical for execution detail. Preserve negation, attribution and essential approval provenance; keep exact identifiers when needed to recognize/adopt/avoid repeating effects or bound scope/approval. Exclude transient stage grants and execution receipts, including those in nested decision evidence; keep consequential conclusions and limits with canonical references. See [memory rationale](docs/memory.md).

Each project is independent. There are no parent rollups or inherited permissions. `legacy.type/parent_id` is migration provenance only. `depends_on` is a store-wide acyclic prerequisite graph: starting with unmet prerequisites is allowed; completion requires transitive prerequisites done, and canceled/reopened prerequisites require review. Associations do not satisfy prerequisites or change endpoint status.

Project checkpoints do not create knowledge. Save a reusable explanation through `context_knowledge` only when its creation/maintenance is explicitly authorized. An attached project is optional session provenance, not an implicit extraction source or grant. An explicit origin pins its project/artifact/version and creates an `originated-in` association; the source project is not rewritten.

## Tools and commands

| Interface | Purpose |
| --- | --- |
| `context status/list/search/read` | Attachment metadata, bounded discovery and project/knowledge reads; no implicit attach/start. |
| `context attach/refresh/detach` | Select a project, replace its brief, or detach after pending bookkeeping is resolved. |
| `context_knowledge create/update/review/supersede/history` | Explicit library maintenance and immutable revision history. History is read-only. |
| `context_link link/unlink/restore/update_reason/list/history` | Associations, backlinks and immutable link history. |
| `context_link reference_add/reference_remove` | Revision-checked direct required-context edits on one project. |
| `context_project` | Project status/list/search/get/create/resume/refresh/leave API. No knowledge entries in project lists. `get` defaults full; `context read` project defaults active. |
| `context_project_checkpoint`, `context_project_ack` | Durable understanding and explicit reconciliation; unchanged compact native receipts/full programmatic results. |
| `context_project_artifact`, `context_project_record`, `context_project_search` | Project research/design documents, revision-pinned records, positioned project-memory search. |
| `context_project_tighten`, `context_project_linear`, `context_project_recap` | Explicit visibility maintenance, existing Linear integration, read-only recap. |
| `task`, `/task` | Independent [session execution board](tasks/README.md). |

`/context` uses one **chat-first** handler. Empty invocation reports attachment/help; ask in chat to list/search/inspect work. `context list include_closed:true` discovers completed work formerly reached through the picker. There is no picker or dialog-based browsing.

The command supports `resume <selector>`, `refresh`, `recap`, `checkpoint`, `tighten`, `leave`, `status [todo|in_progress|done|canceled]` and `sync`. Resume accepts an ID, unique prefix, exact title or full Linear URL. Status changes local progress, not Linear. Deprecated `new simple/project` commands explain chat/tool creation; `context_project create` needs title/outcome and defaults to an independent project. Deprecated `simple` creation also produces a project; new parent placement is rejected with association guidance. Native direction/terminal-status/approval dialogs remain.

### Read deliberately

`context` reads require an explicit entity kind: `{action:"read", kind:"project", selector:"<project ID or selector>", view:"active"}` or `{action:"read", kind:"knowledge", id:"<knowledge ID>"}`. Project reads use `selector`, not `id`; kinds and identifiers are never inferred.

`context_project list` and `context_project search` add compact association navigation: `links: {count, read: {tool: "context_link", action: "list", endpoint: {kind: "project", id}, direction: "both"}}`. The count includes active incoming and outgoing associations; follow `read` for bounded neighbor pages. `context_project get` and `context read` project retain the full `links.items` / `links.next_cursor` page instead of this discovery summary.

Unified search uses literal case-insensitive substrings with punctuation preserved. It returns one best match per entity, bounded excerpts and typed positioned readers. Scoped search includes own project records/catalog bodies, directly referenced grounding records, individually referenced artifacts and directly linked knowledge. Ordinary associated bodies and recursive neighbors are excluded. `context_project_search` remains project-memory-only with its retained matching/read targets; `context_project search` retains title/goal term ranking. Lists/searches are live, not snapshots; continue with unchanged filters, or restart if a cursor anchor disappears.

Knowledge summary reads omit the explanation. Content pages contain at most 12000 characters in both visible and structured output. Follow `expected_version` continuations; current versions hash the exact rendered text, including bounded current link summaries, so relevant link/neighbor changes invalidate paging. Any explicit revision selects immutable core-only content, even if that revision is current; current links are separately retrievable, not historical facts. Canonical sections are Knowledge, Scope and limits, Sources, Related context. Empty sources is legal, not fabricated provenance.

Project record reads require `expected_revision` on every page. Artifact reads use their **source owner** plus artifact ID and opaque expected version. Required documents load as metadata/read targets, never eager bodies; read relevant bodies before relying on them. A grounding reference alone does not enroll source artifacts; an artifact reference alone does not enroll source records. Own artifacts also enter the brief only through explicit references. New artifact creation atomically adds its owner reference; removing it leaves catalog/history readable. Imported `applies_to` is immutable provenance, not live inheritance.

### Supply context to workers

Subprocesses do not inherit the parent's Context tools, brief or conversation from IDs alone. Supply exact scoped artifact read grants when supported, or complete pinned snapshots/inline material or accessible external file paths through the existing handoff. State source roles, versions/freshness and current execution permissions separately; report missing/conflicting material to the parent rather than expanding scope.

The optional public `delegation.ts` / `reader.ts` integration exposes only fixed, version-pinned `context_project_artifact` reads, not discovery, writers or tasks. It uses existing-store-only read-only SQLite transactions; ordinary full Context initialization is unchanged. SQLite WAL/SHM sidecars may change. The native subagent adapter is optional and must be separately adopted; Context itself has no sibling dependency or worker orchestration. See [assigned artifact reads](docs/delegation.md) for the public API, paging, restore/fallback and authority boundaries.

### Write safely

`context_project_artifact` upsert requires `id`, `revision` and the complete catalog metadata on every create/update: `title`, `kind`, `description`, `lifecycle`, `required`, `applies_to`. `required:false` and `applies_to:[]` are valid; `body` is optional for metadata-only updates. Read current metadata before updating; omitted fields are not copied or defaulted.

Project evidence is `{id,text}` on read; checkpoint edits use `evidence:{add,update:[{id,text}],remove:[id]}`. Omitted records survive; enumerate all removals, including consolidation at the 30-record/2000-character limit. Retired whole-list `current_state` writes always reject. Decisions/questions upsert by stable ID. Decision edits preserve omitted `supersedes`; an explicit target retargets under graph validation. Required summary/rationale/approval/evidence replace their prior values. Approved effective/prior supersession relationships require sign-off even for draft successor edits or retargets. Resolution and reversible visibility remain explicit. Outcome changes can add automatic approval provenance even with no evidence additions; make room by consolidating or explicitly removing a chosen evidence ID in the same change. Artifact upserts accept research/design; legacy kinds remain readable. Artifact uncertain retries require read-before-retry.

Every knowledge/link/reference mutation requires a session-scoped key and either **actual current-request** `approval_evidence` or native confirmation. Never fabricate evidence or reuse saved historical/task-report approvals; delegated assignments do not themselves grant end-user authority. Confirmation shows affected identities/titles and field/render preview outside SQL. Validation occurs before reads/preflight/approval. Accepted identical replay avoids a second prompt, and the transaction rechecks replay before revision/domain checks. Changed action/payload under a key rejects. Stale/canceled/invalid operations create no accepted rows or receipts. Evidence records an assertion, not machine-proven truth or permission.

Knowledge updates preserve omitted fields and sources. Exact `explanation_edits` must each match once in the original text, cannot overlap and cannot accompany whole-explanation replacement. Source updates replace one identified record (omitted optional note/date clears); additions generate stable IDs and removals enumerate them. Review creates a full revision with API review time and user-asserted `checked`; wording edits do not refresh that review or source verification dates. Superseded entries are read-only except links/history; update their current replacement. No automatic promotion on checkpoint/close.

## Session context, drift and recap

The model2 brief contains `context_model:2`, `project`, direct `grounding`, source-qualified `artifact_catalog/required_artifacts`, transitive `prerequisites`, bounded `links` and `watch`. No scopes/children reconstruction or recursive bodies. Watch includes selected/direct-source/prerequisite revisions, not generic neighbors. Own reads/writes observe known revisions but do not refresh the brief or acknowledge understanding; status/recap do neither. External changes yield small drift notices; inspect or explicitly refresh before relying on stale grounding.

Session selection stays `todo-selection-v1`; existing context/anchor/compaction/preservation markers and append-only journals are retained. A cached boundary is reused only with `anchor_version:2`, `context_model:2`, `project_tool_api:1` and compatible payload. Older tool-namespace/model1 boundaries retain selection and reconciliation but intentionally reset the obsolete prompt prefix **once**, at the next normal context load. No journal/provider entries are rewritten. Thereafter persisted first-delivery anchors preserve prefix order; reset filters pre-boundary Anthropic thinking, not later thinking or ordinary transcript answers/results. Missing anchors repair through the same boundary mechanism.

Loads happen on attach/switch, explicit refresh, successful compaction, old-model restore or missing-anchor repair—not each request/write. Large briefs are not silently truncated; the footer estimates the loaded base brief, not billing or total context. Required-source failures are visible and abort grounding, never fall back to old JSON or arbitrary associations.

Recap returns current model2 metadata plus at most 12 visible active-branch excerpts of 1000 characters. It reads no artifact bodies (even required), archives or external services, excludes hidden notes/thinking/images, and marks derived/partial ancestry. Call-time `ctx.tools` determines whether executable `session_history` read targets are available; otherwise stable refs and actionable unavailable metadata remain. The ordinary main agent synthesizes `Status / This session / Preserved understanding / Artifacts to know / Remaining`; recap never saves, observes, refreshes, acknowledges, attaches or proves completion.

Compaction remains Pi-owned. The extension appends preservation focus to prepared summary inputs, captures successful-compaction/reconciliation receipts and reloads once on the next normal request. Failed compaction does not publish success or clear pending reconciliation. The best-effort early `turn_end` preservation continuation runs once per owner/native-compaction cycle, under live Pi settings/known physical-window thresholds. It never delays/replaces native compaction or starts a separate worker/model. Checkpoint meaningful understanding within the turn; missing evidence becomes uncertainty, not invented approval. Preserve still-active authorization with exact scope in the conversation summary, not as durable execution permission.

## Storage and explicit upgrades

Default project/library root remains `~/.pi/agent/todos` (`PI_TODO_PATH` override), canonical database `todo.sqlite`. Task JSON remains `<agent-dir>/tasks/sessions/<session-id>.json` (normally `~/.pi/agent/tasks/sessions/<session-id>.json`). Source paths and data paths are different: copying Context does not move either store.

Runtime requires exact **SQLite schema 2 / Project3**. Owners are validated JSON; committed artifact bytes and retained unknown legacy files remain separate immutable namespaces. Knowledge revisions, current pointers, association histories and compact session-keyed operation receipts live in the same store. WAL, foreign keys, FULL synchronous writes and operation-scoped connections remain. Writes use synchronous transactions: no UI/network/await inside SQL. Busy/unknown/corrupt state fails visibly, never auto-resets/migrates. This is not a sandbox against arbitrary local SQL/filesystem access.

### Existing SQLite schema1 → schema2

This is **not** the JSON importer. With Node26, inspect/rehearse a synthetic or separately authorized target:

```sh
node agent/extensions/context/sqlite-upgrade.ts inspect --root ROOT
node agent/extensions/context/sqlite-upgrade.ts rehearse --root ROOT --workspace NEW_PRIVATE_DIR
node agent/extensions/context/sqlite-upgrade.ts apply --root ROOT --backup NEW_OUTSIDE_PATH --apply
node agent/extensions/context/sqlite-upgrade.ts verify --root ROOT
```

Authorize the exact root and stop **all** old/new Pi/Herdr/script writers before apply. The CLI cannot prove quiescence or stop/reload processes. Backups are command-created, private/exclusive and WAL-consistent via native SQLite backup; existing destinations are refused. Rehearsal preserves `WORKSPACE/backup/todo.sqlite` as schema1 and upgrades only a second `candidate/todo.sqlite`. Apply revalidates locked source against its verified backup fingerprint before rebuilding. It preserves IDs/revisions/times/ordered records, committed and retained bytes, metadata and prerequisite edges. Old child placement becomes an association plus direct grounding; old artifact audiences materialize explicit refs (child-only remains child-only), with zero knowledge entries. No future inheritance. Exact schema2 rerun reports already upgraded; unknown schemas refuse before creating a backup.

Before commit, failure rolls back schema1; preserved diagnostic backups are not automatic restore inputs. After commit but before new writes, restoration needs separate stopped-store authorization and WAL-aware verified preimage handling. After new writes, stale-backup/code-only rollback loses data: forward repair is default. No lossless downgrade subsystem is promised. Old code rejects schema2; new code refuses schema1 with explicit-upgrade instructions. No mixed writers.

### Retained JSON import

The supported independent commands remain:

```sh
node agent/extensions/context/migration.ts inspect --source ROOT --report REPORT
node agent/extensions/context/migration.ts rehearse --source ROOT --workspace NEW_PRIVATE_DIR
node agent/extensions/context/migration.ts cutover --source ROOT --workspace NEW_PRIVATE_DIR --apply
node agent/extensions/context/migration.ts verify --root ROOT
```

Use fresh private workspaces outside the source. Inspect reports without modifying source; rehearse snapshots and validates a private candidate. Cutover requires exact-source authorization and stopped writers, takes a **fresh** final snapshot (never promotes rehearsal), stages frozen schema1 then the same schema2 conversion in one private transaction, verifies normal readers and exact bytes, checkpoints/closes WAL, and publishes only a complete schema2 database by atomic rename. Source JSON/docs remain unchanged, archival and unsynchronized. Unknown files are preserved separately, not advertised as committed history. Invalid graphs, symlinks/escapes, duplicate/malformed owners and missing current bodies block publication.

Cutover refuses existing destinations, unknown `.write-lock` or unresolved `.todo-import-*`. Successful `.write-lock/owner.json` with `purpose:migrated-to-sqlite` is a permanent old-writer fence: **never remove it as a stale lock or reimport archival JSON**. On uncertain failure inspect `failure.json`, source/candidate/canonical DB/fence before retry. Published state is not reimported. Abort/cleanup/restore are separately authorized; before any successful post-import write a verified stopped-store rollback may preserve/quarantine the DB and restore compatible source/code; after writes prefer forward repair.

## Linear and safety limits

Linear is optional. Local reads/writes work without MCP; explicit `context_project_linear` fails actionably when required tools are unavailable. Whole-issue writes require exact team status, native approval and fresh drift checks. Partial projects cannot write issue status. Saved snapshots are not fresh external truth; local progress never changes automatically from Linear. A remote write plus failed local save reports partial success: inspect/refresh instead of replaying blindly. No credentials, ticket creation, background polling or distributed transaction.

No installer, manifest/registry, automatic source/data copying, live adoption, service start, reload or publication is performed by these tools/tests.

## Checks

```sh
# From the isolated feature directory:
node tests/test.mjs
# From the repository:
npm test
```

`PI_TEST_PACKAGE_ROOT` may identify the installed Pi SDK; otherwise tests use `npm root -g`. The feature runner creates private HOME/agent/store roots, copies only Context, and executes domain/library/projects/tasks/package suites from that copy with real SQLite and Pi loading. External MCP/provider transports are synthetic; there are no service calls. Retained native SessionManager/model-runtime/Anthropic serializer/prefix/reopen proofs intentionally depend on supported SDK internal exports/model catalog: incompatible SDK failures are prerequisites to resolve, not grounds to replace serializers or skip coverage. These checks prove deterministic package mechanics, not model adherence, operator quiescence, live integrations or live migration.
