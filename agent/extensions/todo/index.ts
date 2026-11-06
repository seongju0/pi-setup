import { randomUUID } from "node:crypto";
import { estimateTokens, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyChanges, needsApproval, statuses, type Changes, type Todo } from "./state.ts";
import { checkpoint, configuredRoot, create, list, locate, readKnown, type Located } from "./storage.ts";
import { readArtifactPage, saveArtifact } from "./artifacts.ts";
import { pageResult, PAGE_CHARS } from "../lib/retrieval.ts";
import { searchKnowledge } from "./knowledge.ts";
import { tighten, type TighteningInput } from "./tightening.ts";
import { compact, guidance, restoreSelection, resumeBundle, selectionEntry, summary } from "./session.ts";
import { syncLinear } from "./linear.ts";
import { effects, dependencyView, dependencyState, prerequisites, validateGraph } from "./dependencies.ts";
import { pickTodo } from "./picker.ts";
import { discoverySummary, search } from "./search.ts";
import { anchorEntry, contextType, detachedType, driftType, sizeType, ordinaryMessages, messageKey, projectContext, hasMissingAnchor, type Anchor, type ContextNote } from "./context.ts";
import { acknowledgementEntry, addCompactionFocus, compactionEntry, pendingReconciliation, reconciliationText, type CompactionMarker } from "./compaction.ts";

const enumOf = (values: readonly string[]) => Type.Union(values.map(value => Type.Literal(value)));
const str = (maxLength = 2000) => Type.String({ minLength: 1, maxLength });
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9-]{27}$" });
const strings = Type.Array(str(), { maxItems: 30 });
const revision = Type.Integer({ minimum: 1 });
const changesSchema = Type.Object({
  title: Type.Optional(str(300)), outcome: Type.Optional(str(3000)), status: Type.Optional(enumOf(statuses)),
  current_state: Type.Optional(Type.Object({ evidence: strings }, { additionalProperties: false })),
  depends_on: Type.Optional(Type.Array(id, { maxItems: 100, uniqueItems: true })), references: Type.Optional(strings),
  decisions: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(id), summary: str(), rationale: str(), approval: enumOf(["draft", "approved"]), evidence: strings, supersedes: Type.Optional(id) }, { additionalProperties: false }), { maxItems: 80 })),
  questions: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(id), text: str(), resolution: Type.Optional(str()) }, { additionalProperties: false }), { maxItems: 80 })),
  linear: Type.Optional(Type.Object({ url: str(), coverage: enumOf(["whole", "partial"]) }, { additionalProperties: false })),
  approval_evidence: Type.Optional(str(1000)),
}, { additionalProperties: false });
const object = (fields: Record<string, any>) => Type.Object(fields, { additionalProperties: false });
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
function result(data: unknown, display: unknown = data) {
  const text = JSON.stringify(display, null, 2);
  return { content: [{ type: "text" as const, text: text.length <= 45000 ? text : text.slice(0, 45000) + "\n[Display truncated; full structured result is available programmatically.]" }], details: data, structuredContent: data };
}

export default function todoExtension(pi: ExtensionAPI) {
  let selected: string | undefined;
  let acknowledged = false;
  let sessionId: string | undefined;
  let preparedCompaction: CompactionMarker | undefined;
  let reconciliation: CompactionMarker | undefined;
  let refreshPending = true;
  let loadedMessage: ContextNote | undefined;
  let notes: ContextNote[] = [];
  const anchors = new Map<string, Anchor>();
  let driftMessage: typeof loadedMessage;
  let driftKey = "";
  let sizeWarningKey = "";
  let loadedSizes = { orientation: 0, bundle: 0 };
  let sizeMessage: typeof loadedMessage;
  const known = new Map<string, Located>();
  const root = configuredRoot();

  function display(ctx: ExtensionContext, item?: Located) {
    if (ctx.hasUI) ctx.ui.setStatus("todo", item ? `Todo · ${clean(item.todo.title)} [${item.todo.status}]` : undefined);
  }
  function observe(item: Located & { updated_parent?: Pick<Todo, "id" | "revision" | "status"> }, ctx?: ExtensionContext) {
    const parent = item.updated_parent && known.get(item.updated_parent.id);
    if (parent) known.set(parent.todo.id, { ...parent, todo: { ...parent.todo, ...item.updated_parent } });
    if (known.has(item.todo.id)) {
      known.set(item.todo.id, item);
      driftKey = ""; driftMessage = undefined;
    }
    if (ctx && selected) display(ctx, known.get(selected));
  }
  function project(messages: Parameters<typeof projectContext>[0], ctx: ExtensionContext) {
    if (!loadedMessage) return messages;
    // Other context hooks may append transient messages. Only persisted transcript messages can anchor notes.
    const persisted = new Set(ctx.sessionManager.getBranch().flatMap(entry => {
      if (entry.type === "message") return [messageKey(entry.message)];
      if (entry.type === "compaction" || entry.type === "branch_summary") return [messageKey({ role: entry.type === "compaction" ? "compactionSummary" : "branchSummary", timestamp: new Date(entry.timestamp).getTime() })];
      return [];
    }));
    const ordinary = ordinaryMessages(messages).filter(message => persisted.has(messageKey(message)));
    for (const note of [loadedMessage, ...notes]) if (!anchors.has(note.details.load_id)) {
      const anchor = { id: note.details.load_id, epoch: loadedMessage.details.load_id, after: ordinary.length ? messageKey(ordinary.at(-1)) : null };
      anchors.set(anchor.id, anchor); pi.appendEntry(anchorEntry, anchor);
    }
    return projectContext(messages, loadedMessage, notes, anchors);
  }
  function detach(ctx: ExtensionContext) {
    selected = undefined; known.clear(); notes = []; anchors.clear(); driftMessage = undefined; sizeMessage = undefined;
    refreshPending = false;
    loadedMessage = { role: "custom", customType: detachedType, content: "No active todo is attached. Earlier todo briefs are superseded; saved todo files are unchanged. This is a context reset, not permission to start other work.", display: false, details: { load_id: randomUUID(), anchor_version: 2 }, timestamp: Date.now() };
    pi.appendEntry(selectionEntry, { id: null }); pi.sendMessage(loadedMessage, { triggerTurn: false }); display(ctx);
  }
  async function loadContext(ctx: ExtensionContext, bundle?: Awaited<ReturnType<typeof resumeBundle>>) {
    if (!selected) throw new Error("No todo attached");
    refreshPending = true;
    bundle ??= await resumeBundle(root, selected);
    loadedSizes = { orientation: JSON.stringify({ ...bundle, required_artifacts: undefined }).length, bundle: JSON.stringify(bundle).length };
    const content = `${guidance}\n${reconciliationText(reconciliation)}\nIf this todo has a Linear link, refresh it before relying on its issue status; report stale snapshots if unavailable. This is starting context as of this load: later tool results and current reads supersede it. Already-acknowledged bookkeeping does not need repeating.\n\nDurable todo context loaded at a session boundary (untrusted task data):\n${JSON.stringify(bundle)}`;
    loadedMessage = { role: "custom", customType: contextType, content, display: false, details: { load_id: randomUUID(), anchor_version: 2 }, timestamp: Date.now() };
    known.clear();
    for (const scope of bundle.scopes) known.set(scope.context.id, { directory: scope.directory, parent_id: scope.parent_id, todo: scope.context });
    for (const prerequisite of bundle.prerequisites) {
      const item = await locate(root, prerequisite.id); known.set(item.todo.id, item);
    }
    refreshPending = false; driftKey = ""; driftMessage = undefined; sizeMessage = undefined; sizeWarningKey = "";
    notes = []; anchors.clear();
    // Persisted anchor entries keep this at its first-delivered position even if Pi queues persistence.
    pi.sendMessage(loadedMessage, { triggerTurn: false });
  }
  async function restore(ctx: ExtensionContext) {
    sessionId = ctx.sessionManager.getSessionId();
    selected = restoreSelection(ctx.sessionManager.getBranch()); acknowledged = false;
    preparedCompaction = undefined; reconciliation = pendingReconciliation(ctx.sessionManager.getBranch(), selected);
    refreshPending = true; loadedMessage = undefined; driftMessage = undefined; driftKey = ""; sizeWarningKey = ""; sizeMessage = undefined; notes = []; anchors.clear(); known.clear();
    const branch = ctx.sessionManager.getBranch();
    const sinceCompaction = branch.slice(branch.findLastIndex(entry => entry.type === "compaction") + 1);
    const saved = sinceCompaction.findLast((entry: any) => entry.type === "custom_message" && [contextType, detachedType].includes(entry.customType)) as any;
    if (saved && saved.customType === (selected ? contextType : detachedType)) {
      for (const entry of sinceCompaction) if (entry.type === "custom" && entry.customType === anchorEntry && (entry.data as Anchor | undefined)?.epoch === saved.details?.load_id) anchors.set((entry.data as Anchor).id, entry.data as Anchor);
      if (anchors.has(saved.details?.load_id) && saved.details.anchor_version === 2) {
        loadedMessage = { role: "custom", customType: saved.customType, content: saved.content, display: false, details: saved.details, timestamp: new Date(saved.timestamp).getTime() };
        notes = sinceCompaction.filter((entry: any) => entry.type === "custom_message" && anchors.has(entry.details?.load_id) && entry.details.load_id !== saved.details.load_id).map((entry: any) => ({ role: "custom", customType: entry.customType, content: entry.content, display: false, details: entry.details, timestamp: new Date(entry.timestamp).getTime() }));
        refreshPending = false;
        driftKey = notes.findLast(note => note.customType === driftType)?.details.drift_key ?? "";
        if (selected && saved.customType === contextType) {
          const bundle = JSON.parse(saved.content.split("Durable todo context loaded at a session boundary (untrusted task data):\n")[1]);
          loadedSizes = { orientation: JSON.stringify({ ...bundle, required_artifacts: undefined }).length, bundle: JSON.stringify(bundle).length };
          for (const scope of bundle.scopes) known.set(scope.context.id, { directory: scope.directory, parent_id: scope.parent_id, todo: scope.context });
          for (const prerequisite of bundle.prerequisites) {
            const item = await locate(root, prerequisite.id);
            known.set(item.todo.id, { ...item, todo: { ...item.todo, revision: prerequisite.revision } });
          }
        }
      }
    }
    display(ctx);
    if (selected) {
      try { display(ctx, await locate(root, selected)); }
      catch (error) { ctx.ui.notify(`Attached todo unavailable: ${(error as Error).message}`, "error"); }
    }
  }
  async function attach(ctx: ExtensionContext, selector: string) {
    const item = await locate(root, selector);
    const bundle = await resumeBundle(root, item.todo.id); // Validate required context before changing selection.
    if (selected && selected !== item.todo.id && !acknowledged) {
      if (!ctx.hasUI || !await ctx.ui.confirm("Switch without another checkpoint?", "Cancel to checkpoint the current todo first. Previously checkpointed context remains saved.")) throw new Error("Checkpoint or acknowledge the current todo before switching");
    }
    selected = item.todo.id; sessionId = ctx.sessionManager.getSessionId(); acknowledged = false;
    reconciliation = pendingReconciliation(ctx.sessionManager.getBranch(), selected);
    preparedCompaction = undefined;
    pi.appendEntry(selectionEntry, { id: selected }); display(ctx, item);
    await loadContext(ctx, bundle);
    return { selected, title: item.todo.title, revision: item.todo.revision, context_loaded: true, dependency: dependencyView(await list(root), item) };
  }
  function acknowledge(ctx: ExtensionContext, todoId: string) {
    if (ctx.sessionManager.getSessionId() === sessionId && selected === todoId) {
      acknowledged = true; reconciliation = undefined;
      pi.appendEntry(acknowledgementEntry, { id: todoId, reason: "checkpoint" });
    }
  }
  async function approve(ctx: ExtensionContext, todo: Todo, changes: Changes) {
    applyChanges(todo, changes); // Validate before asking for approval.
    if (!needsApproval(todo, changes)) return;
    if (!ctx.hasUI || !await ctx.ui.confirm("Approve todo direction change?", JSON.stringify({ todo: todo.title, outcome: changes.outcome, decisions: changes.decisions }, null, 2))) throw new Error("Changed outcome/approved decisions require interactive sign-off. Preserve a draft or ask the user first.");
  }
  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => { display(ctx); selected = undefined; });
  pi.on("before_agent_start", () => { acknowledged = false; });
  pi.on("tool_execution_end", (event) => {
    // Conservative signal, not semantic detection: even a read-only bash may warrant a no_change acknowledgement.
    if (selected && !event.isError && (["write", "edit", "bash"].includes(event.toolName) || event.toolName === "todo_artifact" && event.args?.action === "upsert" && known.has(event.args?.id))) acknowledged = false;
  });
  pi.on("session_before_compact", async (event, ctx) => {
    preparedCompaction = undefined;
    if (!selected) return;
    const owner = selected; const session = ctx.sessionManager.getSessionId();
    event.signal.throwIfAborted();
    const item = await locate(root, owner);
    if (selected !== owner || ctx.sessionManager.getSessionId() !== session) return;
    preparedCompaction = { id: owner, revision: item.todo.revision, pending: !acknowledged || !!reconciliation, reason: event.reason };
    addCompactionFocus(event.preparation, preparedCompaction);
  });
  pi.on("session_compact", (_event, ctx) => {
    if (preparedCompaction && preparedCompaction.id === selected && ctx.sessionManager.getSessionId() === sessionId) {
      pi.appendEntry(compactionEntry, preparedCompaction);
      reconciliation = preparedCompaction.pending ? preparedCompaction : undefined;
    }
    preparedCompaction = undefined;
    refreshPending = true;
    // No model call here: automatic compaction resumes normally; manual compaction waits for the next user request.
  });
  pi.on("session_compact_failed", () => { preparedCompaction = undefined; });
  pi.on("context", async (event, ctx) => {
    const messages = event.messages;
    try {
      if (!selected) {
        if (refreshPending && (loadedMessage || messages.some((message: any) => [contextType, detachedType].includes(message.customType)))) detach(ctx);
        if (loadedMessage && hasMissingAnchor(messages, [loadedMessage, ...notes], anchors)) detach(ctx);
        return { messages: project(messages, ctx) };
      }
      if (loadedMessage && hasMissingAnchor(messages, [loadedMessage, ...notes], anchors)) {
        refreshPending = true;
        ctx.ui.notify("Todo context reset to repair a missing message anchor; saved todo data is unchanged.", "warning");
      }
      if (refreshPending || !loadedMessage) await loadContext(ctx);
      const changed: { id: string; revision: number }[] = [];
      // Watch scoped manifests and transitive prerequisites, without artifact rereads.
      const currentRows: Located[] = [];
      for (const item of known.values()) {
        const current = await readKnown(root, item); currentRows.push(current);
        if (current.todo.revision !== item.todo.revision) changed.push({ id: current.todo.id, revision: current.todo.revision });
      }
      const watchedIds = new Set(currentRows.map(row => row.todo.id));
      if (currentRows.some(row => row.todo.depends_on.some(id => !watchedIds.has(id)))) currentRows.splice(0, currentRows.length, ...await list(root));
      const active = currentRows.find(row => row.todo.id === selected)!;
      const relevant = [active, ...currentRows.filter(row => row.todo.id === active.parent_id), ...prerequisites(currentRows, active)];
      const relevantIds = new Set(relevant.map(row => row.todo.id));
      for (const id of known.keys()) if (!relevantIds.has(id)) known.delete(id);
      for (const row of relevant) if (!known.has(row.todo.id)) known.set(row.todo.id, row);
      validateGraph(relevant);
      const dependency = dependencyState(relevant, active);
      const relevantChanges = changed.filter(row => relevantIds.has(row.id));
      const key = JSON.stringify({ changed: relevantChanges, dependency });
      if (relevantChanges.length && key !== driftKey) {
        driftKey = key;
        driftMessage = { role: "custom", customType: driftType, display: false, details: { load_id: randomUUID(), drift_key: key }, timestamp: Date.now(), content: `Saved todo context changed outside this session's known reads/writes: ${JSON.stringify(relevantChanges)}. Read those items with todo get view active (full for history), or explicitly refresh the attached brief, before relying on it. Current dependency state: ${JSON.stringify(dependency)}. Inspect newly relevant artifacts; do not overwrite external changes blindly.` };
        notes.push(driftMessage);
        pi.sendMessage(driftMessage, { triggerTurn: false });
      }
      const message = loadedMessage!;
      const estimated = estimateTokens({ role: "user", content: [{ type: "text", text: message.content + (driftMessage?.content ?? "") }], timestamp: message.timestamp });
      const usage = ctx.getContextUsage?.();
      const highUsage = typeof usage?.percent === "number" && usage.percent >= 70;
      const warningKey = JSON.stringify([message.details.load_id, ctx.model?.contextWindow, highUsage]);
      const largeForModel = !!ctx.model?.contextWindow && estimated > Math.floor(ctx.model.contextWindow / 10);
      const oversized = loadedSizes.orientation > 18000 || loadedSizes.bundle > 40000 || largeForModel || highUsage;
      if (oversized && sizeWarningKey !== warningKey && !notes.some(note => note.details.warning_key === warningKey)) {
        sizeWarningKey = warningKey;
        const warning = `Todo context size warning (nonblocking): orientation ${loadedSizes.orientation} characters, full bundle ${loadedSizes.bundle} characters, about ${estimated} injected tokens${largeForModel ? "; exceeds 10% of this model's window" : ""}${highUsage ? `; Pi estimates session context usage at ${Math.round(usage!.percent!)}%` : ""}. Active context was retained; use todo get view active for current understanding, full/artifact read for history. Consider todo_tighten during a meaningful update only when verified progress makes context redundant. Read full selected/parent context first. Retire only artifacts no longer governing remaining work, not every merge; keep active rules, authorization boundaries, unresolved constraints, relevant research/design and completion evidence. Preserve evidence and decision history; do not hide required material, infer approval or resolve questions without evidence. No extra cleanup turn or repeated maintenance without new material progress. Tightening affects future loads, not this brief or conversation; explicit refresh replaces the brief, Pi compaction reclaims conversation space.`;
        sizeMessage = { role: "custom", customType: sizeType, display: false, details: { load_id: randomUUID(), warning_key: warningKey }, timestamp: Date.now(), content: warning };
        notes.push(sizeMessage); pi.sendMessage(sizeMessage, { triggerTurn: false });
        ctx.ui.notify(`Todo context is large (${loadedSizes.orientation} orientation characters, ${loadedSizes.bundle} bundle characters${largeForModel ? "; exceeds 10% of this model's window" : ""}${highUsage ? `; session usage ${Math.round(usage!.percent!)}%` : ""}). The model received a nonforcing tightening nudge.`, "warning");
      }
      if (!oversized) { sizeMessage = undefined; sizeWarningKey = ""; }
      return { messages: project(messages, ctx) };
    } catch (error) {
      ctx.abort(); ctx.ui.notify(`Todo context could not load: ${(error as Error).message}. Use /todo leave to detach or repair it.`, "error");
      return { messages };
    }
  });

  pi.registerTool({
    name: "todo", label: "Todo", description: "Durable minimum sufficient project understanding, not an execution diary. list returns flat summaries with goals and parent labels (excludes done/canceled unless include_done). search requires query and searches current saved titles/goals across all statuses; optional status/type filter exactly, include_done is list-only. Case/punctuation-insensitive literal terms must all occur across title/goal; ranks title exact/phrase/all terms, then mixed, then goal-only. No fuzzy matching, parent-text inheritance, facts/decisions/artifact-body or obsolete wording search. Search first, inspect ambiguous candidates, then explicitly get/resume; search/list never attach or start work. get defaults to view full (history), view active uses resume visibility. resume loads scoped context once; refresh explicitly replaces the attached brief. Reads/writes do not refresh it. create requires explicit user intent. Use a durable recognizable outcome title in natural domain terms, distinguishing siblings; outcome concisely states goal, ownership, inclusions and important exclusions, with detailed contracts in design. Keep recognizable wording through progress/completion, not phases, receipts or Done. Revise only for agreed responsibility changes or materially clearer wording; no aliases, keyword stuffing or rename ritual. Label clarification cannot silently change scope or authorize execution. selection never starts implementation; resuming done work leaves it done. depends_on manages same-scope simple prerequisites; reads expose readiness/downstream effects. Use todo_checkpoint for consequential understanding and todo_artifact for reusable Markdown documents.",
    promptSnippet: "Select and manage durable simple/project work items across sessions.",
    parameters: object({ action: enumOf(["list", "search", "get", "create", "resume", "refresh", "leave"]), query: Type.Optional(str()), status: Type.Optional(enumOf(statuses)), selector: Type.Optional(str()), view: Type.Optional(enumOf(["active", "full"])), type: Type.Optional(enumOf(["simple", "project"])), title: Type.Optional(str(300)), outcome: Type.Optional(str(3000)), parent: Type.Optional(str()), include_done: Type.Optional(Type.Boolean()), depends_on: Type.Optional(Type.Array(id, { maxItems: 100, uniqueItems: true })) }),
    outputSchema: Type.Unknown(), executionMode: "sequential", annotations,
    async execute(_callId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      switch (params.action) {
        case "list": {
          const rows = await list(root);
          const titles = new Map(rows.map(row => [row.todo.id, row.todo.title]));
          return result(rows.filter(row => params.include_done || !["done", "canceled"].includes(row.todo.status)).map(row => ({ ...discoverySummary(row, titles), dependency: dependencyView(rows, row) })));
        }
        case "search": {
          if (!params.query) throw new Error("query required");
          return result(search(await list(root), params.query, params.status as Todo["status"] | undefined, params.type as Todo["type"] | undefined));
        }
        case "get": {
          if (!params.selector) throw new Error("selector required");
          const item = await locate(root, params.selector); observe(item);
          const full = effects(await list(root), item);
          return result(params.view === "active" ? { ...full, todo: compact(item.todo) } : full);
        }
        case "refresh": await loadContext(ctx); return result({ selected, context_loaded: true });
        case "resume": if (!params.selector) throw new Error("selector required"); return result(await attach(ctx, params.selector));
        case "leave": if (selected && !acknowledged) throw new Error("Checkpoint or acknowledge no_change/needs_approval before leaving"); detach(ctx); return result({ detached: true });
        case "create": {
          if (!params.type || !params.title || !params.outcome) throw new Error("type, title and outcome required");
          const created = await create(root, params.type as Todo["type"], params.title, params.outcome, params.parent, signal, params.depends_on);
          return result(created, { saved: true, id: created.todo.id, revision: created.todo.revision, ...(created.todo.depends_on.length ? { dependency: created.dependency } : {}) });
        }
      }
    },
  });
  pi.registerTool({
    name: "todo_knowledge", label: "Todo knowledge",
    description: "Find saved findings, decisions, questions, references and artifact text using case-insensitive literal substring matching (punctuation preserved). Does not search title/goal or old body revisions. Omit selector for the whole TODO store; a project includes its direct children, a simple item only itself. Includes completed owners. view defaults to active visibility; full includes retained hidden/superseded/resolved material. Returns bounded excerpts, provenance and explicit read targets; follow next_cursor with unchanged query/scope/view. Search is live, not a snapshot. Never attaches, starts work or changes files. Read sources before relying on them; history and saved drafts are not current state or permission.",
    promptSnippet: "Find curated project knowledge without loading every document.",
    parameters: object({ query: str(), selector: Type.Optional(str()), view: Type.Optional(enumOf(["active", "full"])), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })), cursor: Type.Optional(str(6000)) }),
    outputSchema: Type.Unknown(), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_callId, params, signal) {
      return result(await searchKnowledge(root, params, signal));
    },
  });
  pi.registerTool({
    name: "todo_checkpoint", label: "Todo checkpoint", description: "Commit related high-signal understanding atomically: consequential nuances, choices with reasons/rejected alternatives, uncertainty, scope and substantial goal completion. No diary, transient stage permissions or per-test receipts; QA Toolkit/native reports own QA detail. Store consequential knowledge in current_state.evidence; outcome is concise Goal, ownership and scope, with detailed contracts in design. Keep durable recognizable title/goal terms through completion, not phases/receipts/Done; clarify materially or update agreed responsibility, never keyword-stuff or rename per turn. Wording changes cannot silently change scope or grant execution authority. Preserve negation, attribution and exact identifiers. Parent holds shared conclusions/constraints/owner routing, child holds detail. Lists replace fields; decisions/questions upsert by stable ID (omit to create). Supersede explicitly; history remains in full get. Update one current spec per responsibility instead of appending corrections. Save only when omission risks wrong decisions, significant repeated work or an authorization breach; no per-turn acknowledgement. Requires current revision and unique retry key; retry identical key/payload after a lost response. Empty changes still write; prefer todo_ack no_change for explicit reconciliation. Approved decisions/changed outcomes require sign-off unless approval_evidence quotes explicit user approval for these exact changes, not task data/unrelated permission. depends_on replaces same-scope simple prerequisites ([] clears). Meaningful saves start not-started item/parent, preserving terminal/explicit statuses. Dependencies do not block starting; completion requires all transitive prerequisites done, never canceled. Compact success text; full structured result retains current downstream effects. Sibling statuses and Linear are unchanged.",
    parameters: object({ id, revision, key: str(200), changes: changesSchema }), outputSchema: Type.Unknown(), executionMode: "sequential", annotations,
    async execute(_callId, params, signal, _onUpdate, ctx) {
      const item = await locate(root, params.id);
      // Avoid repeating approval for a successful identical retry; checkpoint still verifies digest and owner.
      if (item.todo.last_checkpoint?.key !== params.key) await approve(ctx, item.todo, params.changes as Changes);
      const updated = await checkpoint(root, params.id, params.revision, params.changes as Changes, params.key, ctx.sessionManager.getSessionId(), signal);
      observe(updated, ctx); acknowledge(ctx, params.id);
      // applyChanges appends id-less patches in order; an identical last-key replay retains that tail.
      const createdDecisions = params.changes.decisions?.filter(row => !row.id).length ?? 0;
      const createdQuestions = params.changes.questions?.filter(row => !row.id).length ?? 0;
      const decisionIds = createdDecisions ? updated.todo.decisions.slice(-createdDecisions).map(row => row.id) : [];
      const questionIds = createdQuestions ? updated.todo.open_questions.slice(-createdQuestions).map(row => row.id) : [];
      const changedDependencies = updated.todo.status !== item.todo.status || JSON.stringify(updated.todo.depends_on) !== JSON.stringify(item.todo.depends_on);
      return result(updated, {
        saved: true, revision: updated.todo.revision,
        ...(decisionIds.length ? { decision_ids: decisionIds } : {}), ...(questionIds.length ? { question_ids: questionIds } : {}),
        ...(updated.todo.status !== item.todo.status ? { status: updated.todo.status } : {}),
        ...("updated_parent" in updated && updated.updated_parent ? { updated_parent: updated.updated_parent } : {}),
        ...(changedDependencies && (updated.todo.depends_on.length || updated.affected_dependents.length || params.changes.depends_on !== undefined) ? { dependency: updated.dependency, affected_dependents: updated.affected_dependents } : {}),
      });
    },
  });
  pi.registerTool({
    name: "todo_tighten", label: "Tighten Todo context",
    description: "Context visibility maintenance (hide/restore is reversible) during meaningful updates based on verified project progress. Read todo get view full first. consult_on_demand_decisions/artifacts ADD to what is already hidden; restore_decisions/artifacts make items visible again; records remain readable, never deleted. Optionally replace current_state.evidence and references; overwritten text has no recovery guarantee. Keep active rules, unresolved constraints, authorization boundaries, relevant research/design and completion evidence visible. Required artifacts cannot be hidden; retire_artifacts lists artifacts to demote to non-required reference (still readable) — use only when no longer governing remaining work, not automatically on merge. Do not change direction or infer approval. Requires current revision; after a lost response read the item before retrying. Changes saved orientation for future loads and returns a compact receipt, not full history. Does not refresh the attached brief or compact the conversation. Size/age or a merge alone do not warrant maintenance; never run an extra cleanup turn.",
    parameters: object({ id, revision, reason: str(), consult_on_demand_decisions: Type.Optional(Type.Array(id, { maxItems: 80, uniqueItems: true })), consult_on_demand_artifacts: Type.Optional(Type.Array(id, { maxItems: 200, uniqueItems: true })), restore_decisions: Type.Optional(Type.Array(id, { maxItems: 80, uniqueItems: true })), restore_artifacts: Type.Optional(Type.Array(id, { maxItems: 200, uniqueItems: true })), current_state: Type.Optional(Type.Object({ evidence: strings }, { additionalProperties: false })), references: Type.Optional(strings), retire_artifacts: Type.Optional(Type.Array(id, { maxItems: 200, uniqueItems: true })) }),
    outputSchema: Type.Unknown(), executionMode: "sequential", annotations,
    async execute(_callId, params, signal, _onUpdate, ctx) {
      const { id: todoId, revision: expected, ...input } = params;
      const updated = await tighten(root, todoId, expected, input as TighteningInput, signal);
      observe(updated); acknowledge(ctx, todoId);
      return result({ id: todoId, revision: updated.todo.revision, context_policy: updated.todo.context_policy, dependency: updated.dependency, context_refreshed: false });
    },
  });
  pi.registerTool({
    name: "todo_ack", label: "Todo acknowledgement", description: "Conclude todo bookkeeping. no_change means nothing meaningful changed. needs_approval durably records a pending approval question and asks the user; it does not approve changes, alter established decisions, or mark work complete.",
    parameters: object({ id, reason: enumOf(["no_change", "needs_approval"]), explanation: str(1000) }), outputSchema: Type.Unknown(), annotations,
    async execute(_callId, params, _signal, _onUpdate, ctx) {
      if (selected !== params.id || sessionId !== ctx.sessionManager.getSessionId()) throw new Error("Acknowledge only the attached todo");
      if (params.reason === "needs_approval") {
        const item = await locate(root, params.id);
        const text = `Awaiting approval: ${params.explanation}`;
        if (!item.todo.open_questions.some(question => question.text === text && !question.resolution)) {
          observe(await checkpoint(root, params.id, item.todo.revision, { questions: [{ text }] }, `approval-${randomUUID()}`, ctx.sessionManager.getSessionId()), ctx);
        }
        ctx.ui.notify(`Todo needs approval: ${params.explanation}`, "warning");
      }
      acknowledged = true; reconciliation = undefined; pi.appendEntry(acknowledgementEntry, params);
      return result(params);
    },
  });
  pi.registerTool({
    name: "todo_artifact", label: "Todo artifact", description: "Read current artifact bodies in pages (default/max 12000 characters). Follow next_offset with expected_version from the first page; a changed version requires restart at offset 0. Structured results contain the same page, not a hidden full body. Or upsert an owned substantial Markdown research synthesis or design specification when future work needs it, not every output. kind must be research or design, including when updating legacy documents. Keep one authoritative current spec per actual responsibility; update corrections instead of appending, and reconcile conflicting claims without treating latest timestamp as policy/approval. Omit artifact_id to create; provide it to update. Immutable revisions preserve history; nothing is deleted. applies_to holds direct child IDs; [] means owner-wide. Only current artifacts can be required; reference/superseded material stays readable on demand. Retire only when no longer governing remaining work. Saving preserves a draft, not user approval.",
    parameters: object({ action: enumOf(["read", "upsert"]), id, revision: Type.Optional(revision), artifact_id: Type.Optional(id), title: Type.Optional(str(300)), kind: Type.Optional(enumOf(["research", "design"])), description: Type.Optional(str(1000)), lifecycle: Type.Optional(enumOf(["current", "reference", "superseded"])), required: Type.Optional(Type.Boolean()), applies_to: Type.Optional(Type.Array(id, { maxItems: 100, uniqueItems: true })), body: Type.Optional(str(100000)), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE_CHARS })), expected_version: Type.Optional(str()) }), outputSchema: Type.Unknown(), executionMode: "sequential", annotations,
    async execute(_callId, params, signal, _onUpdate, ctx) {
      if (params.action === "read") {
        if (!params.artifact_id) throw new Error("artifact_id required");
        const page = await readArtifactPage(root, await locate(root, params.id), params.artifact_id, params.offset, params.limit, params.expected_version);
        signal?.throwIfAborted();
        return pageResult(page, page.body);
      }
      if (params.revision === undefined || !params.title || !params.kind || !params.description || !params.lifecycle || params.required === undefined || !params.applies_to) throw new Error("upsert requires revision and complete catalog metadata");
      const before = known.get(params.id)?.todo;
      const updated = await saveArtifact(root, params.id, params.revision, { id: params.artifact_id, title: params.title, kind: params.kind, description: params.description, lifecycle: params.lifecycle as any, required: params.required, applies_to: params.applies_to, body: params.body }, signal);
      observe(updated, ctx);
      const artifact = params.artifact_id ? updated.todo.artifacts.find(row => row.id === params.artifact_id)! : updated.todo.artifacts.at(-1)!;
      const parent = "updated_parent" in updated ? updated.updated_parent : undefined;
      return result(updated, {
        saved: true, revision: updated.todo.revision,
        ...(!params.artifact_id ? { artifact_id: artifact.id } : {}), ...(params.body !== undefined ? { path: artifact.path } : {}),
        ...(updated.todo.status === "in_progress" && (!before || before.revision !== params.revision || before.status === "todo") ? { status: updated.todo.status } : {}),
        ...(parent ? { updated_parent: parent } : {}),
      });
    },
  });
  pi.registerTool({
    name: "todo_linear", label: "Todo Linear", description: "Refresh the linked Linear issue snapshot without changing local progress. Optionally request an exact team status; whole-issue coverage and interactive confirmation are required for writes. Partial todos never change the parent issue. Uses the existing Linear MCP tools, not separate credentials. Refreshed status is a timestamped snapshot, not a completion signal.",
    parameters: object({ id, revision, target_status: Type.Optional(str(100)) }), outputSchema: Type.Unknown(), executionMode: "sequential", annotations: { ...annotations, openWorldHint: true },
    async execute(_callId, params, signal, _onUpdate, ctx) {
      const updated = await syncLinear(root, params.id, params.revision, ctx, params.target_status, signal);
      observe(updated); return result(updated);
    },
  });

  const choices = ["new simple", "new project", "resume", "refresh", "checkpoint", "tighten", "leave", "status", "sync"];
  pi.registerCommand("todo", {
    description: "Select/resume durable work, create simple/project todos, checkpoint, detach, change status, or refresh Linear",
    getArgumentCompletions: prefix => choices.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      try {
        await ctx.waitForIdle();
        const command = args.trim();
        if (command === "refresh") { await loadContext(ctx); ctx.ui.notify("Todo context refreshed; no work was started.", "info"); return; }
        if (command === "checkpoint") {
          if (!selected) throw new Error("No todo attached");
          pi.sendUserMessage("Checkpoint the active todo now: preserve consequential understanding and substantial goal completion through todo tools; save substantial documents only when future work needs them, not QA receipts or every output. Do not begin further work. If nothing changed, call todo_ack."); return;
        }
        if (command === "tighten") {
          if (!selected) throw new Error("No todo attached");
          pi.sendUserMessage("Review the active todo and parent with todo get, then use todo_tighten only if verified progress makes context redundant. Keep active rules, approvals, unresolved constraints, completion evidence and relevant research/design visible. Retire only artifacts no longer governing remaining work, not automatically on merge; hide/restore records without deleting them; visibility is reversible, overwritten text has no recovery guarantee; do not change direction or begin further work. If no meaningful tightening is justified, explain briefly without writing."); return;
        }
        if (command === "leave") {
          if (selected && !acknowledged && ctx.hasUI && !await ctx.ui.confirm("Detach without another checkpoint?", "Changes already checkpointed remain saved. If recent discoveries are not saved, cancel and run /todo checkpoint first.")) return;
          if (selected && !acknowledged && !ctx.hasUI) throw new Error("Acknowledge/checkpoint before leaving in noninteractive mode");
          detach(ctx); return;
        }
        if (command === "sync") {
          if (!selected) throw new Error("No todo attached");
          pi.sendUserMessage("Refresh the active todo's linked Linear status using todo_linear; do not change the issue or local progress status."); return;
        }
        if (command === "status" || command.startsWith("status ")) {
          if (!selected) throw new Error("No todo attached");
          const status = command.slice(6).trim() || (ctx.hasUI ? await ctx.ui.select("Local todo status", [...statuses]) : undefined);
          if (!status) return;
          if (!statuses.includes(status as any)) throw new Error("Invalid status");
          if ((status === "done" || status === "canceled") && (!ctx.hasUI || !await ctx.ui.confirm("Set terminal local status?", `${status} is your claim about this todo, not a Linear issue update. Confirm required work is complete or explicitly canceled.`))) return;
          const item = await locate(root, selected);
          const updated = await checkpoint(root, selected, item.todo.revision, { status: status as any }, `status-${randomUUID()}`, ctx.sessionManager.getSessionId()); observe(updated); display(ctx, updated);
          pi.sendMessage({ customType: "todo-status-v1", content: `Saved todo ${selected} status is now ${status}. This does not change Linear status or authorize further work.`, display: false }, { triggerTurn: false }); return;
        }
        if (command.startsWith("new ")) {
          if (!ctx.hasUI) throw new Error("Use todo create in noninteractive mode");
          const type = command.slice(4).trim(); if (type !== "simple" && type !== "project") throw new Error("Usage: /todo new simple|project");
          const title = await ctx.ui.input("Todo title"); if (!title) return;
          const outcome = await ctx.ui.editor("Intended outcome"); if (!outcome) return;
          let parent: string | undefined;
          if (type === "simple" && selected) {
            const current = await locate(root, selected); const project = current.parent_id ?? (current.todo.type === "project" ? current.todo.id : undefined);
            if (project && await ctx.ui.confirm("Project-scoped todo?", "Create this simple todo inside the active project?")) parent = project;
          }
          const item = await create(root, type, title, outcome, parent);
          await attach(ctx, item.todo.id); ctx.ui.notify(`Created and attached ${item.todo.title}. Ask to adopt this session's existing findings/artifacts if needed.`, "info"); return;
        }
        let selector = command.startsWith("resume ") ? command.slice(7).trim() : command === "resume" ? "" : command;
        if (!selector) {
          const rows = await list(root);
          if (!ctx.hasUI) { ctx.ui.notify(JSON.stringify(rows.filter(row => !["done", "canceled"].includes(row.todo.status)).map(summary)), "info"); return; }
          selector = await pickTodo(ctx, rows) ?? "";
          if (!selector) return;
        }
        await attach(ctx, selector); ctx.ui.notify("Todo attached and context loaded once; no work was started.", "info");
      } catch (error) { ctx.ui.notify((error as Error).message, "error"); }
    },
  });
}
