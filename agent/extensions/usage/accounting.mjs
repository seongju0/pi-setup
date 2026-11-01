import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** @typedef {import('./types.ts').Period} Period */
/** @typedef {import('./types.ts').Totals} Totals */
/** @typedef {import('./types.ts').UsageReport} UsageReport */

const counters = ["input", "output", "cacheRead", "cacheWrite"];
const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const identityString = value => typeof value === "string" && value.trim() ? value : null;
const count = (stats, key, n = 1) => { stats[key] = (stats[key] ?? 0) + n; };

function toolIdentity(message) {
  // The web-search extension's details describe this usage. Generic tool details
  // (especially codemode aggregates) do not guarantee per-model attribution.
  if (message.toolName !== "web_search") return [null, null];
  const details = message.details;
  if (!details || typeof details !== "object") return [null, null];
  const provider = details.provider;
  const model = identityString(details.model);
  if (!model) return [null, null];
  const slash = model.indexOf("/");
  if (slash < 1) return [null, null];
  const prefix = model.slice(0, slash);
  if ((provider === "codex" && ["openai", "openai-codex"].includes(prefix)) ||
      (provider === "anthropic" && prefix === "anthropic")) {
    return [prefix, model.slice(slash + 1)];
  }
  return [null, null];
}

function accountingRecord(entry, stats) {
  let usage, provider, model, source;
  if (entry.type === "message") {
    const message = entry.message;
    if (!message || typeof message !== "object") return;
    if (message.role === "toolResult" && message.toolName === "web_search" && !message.usage && !message.isError) {
      count(stats, "searchWithoutUsage");
    }
    if (!["assistant", "toolResult"].includes(message.role)) return;
    usage = message.usage;
    if (!usage) return;
    source = message.role === "assistant" ? "response" : "tool";
    provider = identityString(message.provider);
    model = identityString(message.model);
    if (source === "tool" && (!provider || !model)) [provider, model] = toolIdentity(message);
  } else if (["usage", "compaction", "branch_summary"].includes(entry.type)) {
    usage = entry.usage;
    if (!usage) return;
    source = entry.type === "usage" ? `usage:${identityString(entry.kind) ?? "other"}` : entry.type;
    provider = identityString(entry.provider);
    model = identityString(entry.model);
  } else return;

  const timestamp = Date.parse(entry.timestamp);
  if (!identityString(entry.id) || !Number.isFinite(timestamp) || typeof usage !== "object" ||
      !counters.every(key => nonnegative(usage[key])) || !nonnegative(usage.totalTokens)) {
    count(stats, "invalidUsage");
    return;
  }
  const totalTokens = counters.reduce((sum, key) => sum + usage[key], 0);
  if (!Number.isFinite(totalTokens) || totalTokens !== usage.totalTokens) {
    count(stats, "invalidUsage");
    return;
  }
  const recordedCost = usage.cost?.total;
  // A positive-token zero from an unknown/zero-filled catalog is not evidence
  // of free API usage. Keep the tokens and expose the estimate as unavailable.
  const cost = nonnegative(recordedCost) && (recordedCost > 0 || totalTokens === 0) ? recordedCost : null;
  const reasoning = nonnegative(usage.reasoning) ? usage.reasoning : null;
  return {
    id: entry.id, timestamp, source, provider, model,
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite, totalTokens, reasoning, cost,
  };
}

async function readAccountingFile(path) {
  const records = [], stats = {};
  let header = null;
  const parseLine = (line, final = false) => {
    if (!line.trim()) return;
    let entry;
    try { entry = JSON.parse(line); }
    catch { count(stats, final ? "partialLines" : "malformedLines"); return; }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      count(stats, "malformedLines"); return;
    }
    if (entry.type === "session") {
      header = { version: entry.version, id: identityString(entry.id), parentSession: identityString(entry.parentSession) };
      return;
    }
    if (entry.type === "custom") {
      if (entry.customType === "web-search-results") count(stats, "legacySearchResults");
      if (entry.customType === "subagents:record") count(stats, "legacyAgentReports");
      return; // UI snapshots and reports are never additional accounting rows.
    }
    const record = accountingRecord(entry, stats);
    if (record) records.push(record);
  };

  let pending = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    pending += chunk;
    let start = 0, newline;
    while ((newline = pending.indexOf("\n", start)) !== -1) {
      parseLine(pending.slice(start, newline));
      start = newline + 1;
    }
    pending = pending.slice(start);
  }
  if (pending) parseLine(pending, true);
  if (!header?.id || header.version !== 3) {
    count(stats, "unsupportedFiles");
    return { header, records: [], stats };
  }
  return { header, records, stats };
}

async function discover(directory, files, stats) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code !== "ENOENT") count(stats, "unreadableDirectories");
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    // Derived debug transcripts are copies, not primary child sessions.
    if (entry.isDirectory() && entry.name !== "subagent-artifacts") await discover(path, files, stats);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
}

/** Cache only extracted accounting metadata; no prompts, responses or credentials. */
export function createScanner(agentDir) {
  const cache = new Map();
  return {
    async scan() {
      const files = [], stats = {};
      await discover(join(agentDir, "sessions"), files, stats);
      await discover(join(agentDir, "subagents"), files, stats);
      files.sort();
      const existing = new Set(files);
      for (const path of cache.keys()) if (!existing.has(path)) cache.delete(path);
      const unique = new Map();
      for (const path of files) {
        let metadata;
        try {
          const info = await stat(path);
          const prior = cache.get(path);
          if (prior && prior.size === info.size && prior.mtimeMs === info.mtimeMs) {
            metadata = prior.data;
            count(stats, "cachedFiles");
          } else {
            metadata = await readAccountingFile(path);
            cache.set(path, { size: info.size, mtimeMs: info.mtimeMs, data: metadata });
            count(stats, "readFiles");
          }
        } catch {
          cache.delete(path);
          count(stats, "unreadableFiles");
          continue;
        }
        for (const [key, value] of Object.entries(metadata.stats)) count(stats, key, value);
        const parent = metadata.header?.parentSession;
        if (parent && !existing.has(resolve(dirname(path), parent))) count(stats, "unresolvedParents");
        for (const record of metadata.records) {
          // Fork copies retain id/time/accounting but can change parentId.
          // Include accounting in the key so unrelated short-ID collisions survive.
          const key = JSON.stringify([record.id, record.timestamp, record.source, record.provider, record.model,
            record.input, record.output, record.cacheRead, record.cacheWrite, record.reasoning, record.cost]);
          if (unique.has(key)) count(stats, "duplicates");
          else unique.set(key, record);
        }
      }
      return { records: [...unique.values()], stats: { ...stats, files: files.length }, refreshedAt: new Date() };
    },
  };
}

/** @returns {Totals} */
function emptyTotals() {
  return { records: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, reasoning: null, cost: 0, unpriced: 0 };
}

function add(totals, record) {
  totals.records++;
  for (const key of [...counters, "totalTokens"]) totals[key] += record[key];
  if (record.reasoning !== null) totals.reasoning = (totals.reasoning ?? 0) + record.reasoning;
  if (record.cost === null) totals.unpriced++;
  else totals.cost += record.cost;
}

/** Local calendar boundaries; use date arithmetic, not fixed-duration DST assumptions. */
export function periodRange(period, offset = 0, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "month") start.setDate(1);
  else start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === "month") start.setMonth(start.getMonth() + offset);
  else start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + 7);
  return { start, end };
}

function providerGroup(provider, model) {
  if (!provider || !model) return "unattributed";
  if (["openai", "openai-codex"].includes(provider)) return "codex";
  if (provider === "anthropic") return "anthropic";
  return "other";
}

/** @returns {UsageReport} */
export function aggregate(snapshot, period = "month", offset = 0, monthlyFee = 100, now = new Date()) {
  const { start, end } = periodRange(period, offset, now);
  const labels = { codex: "Codex", anthropic: "Anthropic", other: "Other", unattributed: "Unattributed overhead" };
  const rows = new Map(["codex", "anthropic"].map(key => [key, { key, label: labels[key], ...emptyTotals(), modelMap: new Map() }]));
  for (const record of snapshot.records) {
    if (record.timestamp < start.getTime() || record.timestamp >= end.getTime()) continue;
    const key = providerGroup(record.provider, record.model);
    if (!rows.has(key)) rows.set(key, { key, label: labels[key], ...emptyTotals(), modelMap: new Map() });
    const row = rows.get(key);
    add(row, record);
    const provider = record.provider ?? "unattributed";
    const model = record.model ?? (record.source === "compaction" ? "Compaction (model not recorded)" : "Helper (model not recorded)");
    const modelKey = JSON.stringify([provider, model]);
    if (!row.modelMap.has(modelKey)) row.modelMap.set(modelKey, { provider, model, ...emptyTotals() });
    add(row.modelMap.get(modelKey), record);
  }
  const s = snapshot.stats;
  const coverage = [
    `${s.files} saved session files; ${snapshot.records.length.toLocaleString()} unique accounting records across all history.`,
    `${(s.duplicates ?? 0).toLocaleString()} copied accounting records excluded across scanned history.`,
    "Sources: main sessions and background-agent transcripts; deleted history is not retained.",
    "OpenAI labels are grouped as your subscription usage; historical auth mode is not recorded.",
    "Costs are recorded catalog estimates, not invoices or a historical price archive.",
    "Reasoning is an output subset; any shown reasoning sum covers only records supplying that field.",
    "Unattributed compaction/helper usage is not assigned to a provider or included in its cost comparison.",
  ];
  const warnings = [
    ["unreadableDirectories", "unreadable directories"], ["unreadableFiles", "unreadable files"],
    ["unsupportedFiles", "files without supported v3 headers"], ["malformedLines", "malformed records skipped"],
    ["partialLines", "incomplete final lines deferred until refresh"], ["invalidUsage", "invalid usage records skipped"],
    ["unresolvedParents", "parent sessions absent from the scan"],
    ["searchWithoutUsage", "non-error web-search results without usage metadata"],
    ["legacySearchResults", "legacy search metadata records (not additional accounting)"],
    ["legacyAgentReports", "legacy worker reports without canonical accounting"],
  ];
  for (const [key, label] of warnings) if (s[key]) coverage.push(`Scanned-history coverage: ${s[key].toLocaleString()} ${label}.`);
  return {
    period, start, end, monthlyFee, refreshedAt: snapshot.refreshedAt, coverage,
    rows: [...rows.values()].map(({ modelMap, ...row }) => ({
      ...row, models: [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model)),
    })),
  };
}
