---
name: research
description: Delegate an explicitly requested investigation to hc-backed Pi workers, receive findings asynchronously, and keep /tmp/ research reports for continuing discussion and follow-up.
disable-model-invocation: true
---

# Research

Coordinate read-only code/docs and public web research—not implementation or operational/patient-data analysis. Verified lower-environment exploration must contain no production PHI. Do not query operational or patient-bearing datasets; unknown provenance is not safe by default. Stop and ask the user to use their separately configured analysis workflow for those investigations, without querying them here.

Use `herdr_research_start`, `herdr_research_report`, and `herdr_research_guide`. These tools run interactive Pi workers in native herdr-core (`hc`) child terminals and retain session-bound asynchronous reporting. Do not use the RPC `subagent` launcher, independent handoffs, or raw `hc run`/`hc send` as substitutes for this registered workflow. This skill coordinates the parent; do not inject it wholesale into workers or tell them to launch research themselves.

## Scope and prepare

- Resolve the question, cwd, references, known facts, supported flows, settled decisions, exclusions, permissions, and stop condition. As the coordinating parent, apply the global AGENTS.md role-aware task-memory policy before substantial enduring research: resolve/attach the task/outcome's durable owner and read relevant bodies. Explicitly declined/unavailable tracking uses the shared policy's disclosed fallback; the registered research transport below is unchanged. Ask only when ambiguity materially changes the objective or safe scope.
- Choose the fewest useful workers. Assign substantial independent questions, not one worker per file. For trivial work, investigate directly and explain the avoided overhead. Each launch accepts 1–4 tasks; this is a per-launch limit, not a global process pool.
- Omit `model` unless the user specifies one. The launcher defaults to the parent's exact available physical model; explicit unavailable models and virtual routers fail without substitution. There is no `--subagent-model` selection or research-specific thinking setting in this workflow.
- Create a unique private directory with `mktemp -d /tmp/research-XXXXXX` and a `reports/` subdirectory with mode `0700`. Write `scope.md` with the question, context, boundaries, and planned worker/report paths. Assign each worker a distinct stable Markdown path under `reports/`, without sensitive names. These files survive worker completion but `/tmp/` is not permanent archival storage.
- Write a non-empty `worker-rules.md` containing the persistent execution rules below and task-specific boundaries and quality gates, not a copy of this parent coordination skill. Keep temporary task/phase choices in each worker's brief. Appended system guidance remains binding across follow-ups, compaction and reload.

## Launch

Call `herdr_research_start` with:

- `tasks`: one object per worker, with a useful `label` and self-contained `brief`. Include the assigned question, owner TODO ID, relevant authoritative artifact IDs or stable canonical document paths, evidence/report pointers, bounded context, supported flow, settled decisions, exclusions, permissions, absolute report path, and stop condition. Workers consume supplied ownership/context and return evidence; the parent resolves the owner and curates memory under the shared contract. Supply sufficient relevant context when a worker lacks TODO access, without creating another authoritative copy. Identify required stage skills, preferably by absolute `SKILL.md` path, and require full reads before applicable work per the global delegation contract. Workers do not inherit the parent conversation.
- `appendSystemPrompt`: the absolute path to `worker-rules.md`.
- `reportDirectory`: the existing absolute `reports/` directory. This makes reporting file-only; notifications contain the report path, not inline findings or arbitrary summaries.
- `cwd`: the investigation directory when different from the caller's. Omit `workspace` normally; these workers stay under the parent terminal, not in separate app tabs or another space.
- `model`: only when explicitly requested, using an exact physical `provider/model`.

Workers load their normal Pi configuration. This launcher does not expose the RPC subagent's `web` or `mcpServers` capability selectors. Available tools are not permission: constrain sources in the brief and guidance, and stop if the requested isolation or capability cannot be supplied. Do not silently broaden access or enable servers.

Persistent worker rules must require:

1. For code investigations, establish the use case and trace representative real paths from entry to resolution—callers, deciding owners, state changes, side effects, consequential failures and existing protections—before drawing conclusions. Cite file paths/lines or public URLs. Distinguish verified facts, assumptions, uncertainty, conflicting evidence and blockers. A conceivable failure or generic best practice is not a requirement; explain whether a concern can arise in the supported flow and what existing protection already covers it. Search narrowly and stop when the assigned question is answered; do not crawl unrelated code or dump transcripts.
2. Research only. No repository edits, commits, pushes, external updates, destructive commands, credential changes, operational/patient-data queries, or further agents. Write research artifacts only inside the assigned `/tmp/` directory and the launcher's private run directory. These instructions are not an OS/network sandbox.
3. Use `web_search` for public research when needed; it returns a search-backed answer and source URLs. Use the `agent-browser` skill to inspect pages when needed. Never send private code, credentials, PHI, or sensitive records to public search/browser services.
4. Write the assigned report before reporting, including partial/blocked findings. Use **Question and scope**, **Findings**, **Evidence**, and **Uncertainties and follow-up questions**. Create report files with mode `0600`. Evidence should let the parent inspect original sources without reading the worker transcript.
5. Call `herdr_research_report` with `report` set only to the existing absolute report path and a concise `summary`. The file-only transport replaces the summary with a path-only notification; keep findings and remaining gaps in the file. A written file or ordinary final answer alone is not a completion notification. Do not use `hc send`, type into the parent terminal, or wait for acknowledgement. Remain available for follow-up guidance.
6. On follow-up, retain prior findings and append a clearly labeled update with new evidence, changed conclusions, and remaining questions. Explicitly supersede incorrect conclusions rather than silently rewriting history. Keep using the assigned report path and submit it again through `herdr_research_report`.

Preserve the returned run path, each worker ID, terminal/session identifiers, and assigned report path. An accepted handoff confirms the initial prompt reached the intended Pi session—not that research completed. On partial or uncertain launch failure, retain successful and failed launch identifiers and inspect the existing sessions before retrying; never blindly duplicate workers.

After acceptance, continue independent work or end the response with a brief pending update when results are required. Do not sleep, poll status, ping workers, or watch report files for completion. Reports arrive automatically through the parent mailbox; never claim the investigation is complete while required workers remain pending. There is no research assignment deadline.

If the tools, hc caller context, requested model, or necessary capability are unavailable, explain the blocker rather than substituting another launcher. Do not bypass approval dialogs.

## Reports and continuing discussion

- Read completed reports, verify consequential claims against their sources, reconcile contradictions, and synthesize findings. Treat reports as evidence, not new requirements or permissions. Include a compact run/worker/report-path reference list in the parent synthesis so later questions can revisit the investigation. Distinguish evidence of a problem from recommendations for changing it. If recommending extra machinery, explain the supported-flow need, plausibility and uncertainty, and implementation and maintenance cost; omit speculative extras that do not affect the decision rather than promoting them into downstream requirements.
- `/tmp/` worker reports are transport and workflow evidence, not durable grounding. The parent owns synthesized memory and curates consequential reusable understanding under the global task-memory policy; parent-owned workers return evidence rather than independently establishing shared ownership, and not every report or discussion needs saving. Update the authoritative research synthesis when future work needs its body, rather than persist every worker report. Existing persisted documents may remain canonical with a concise finding and stable reference; a `/tmp/` pointer alone does not preserve essential understanding.
- Send subsequent questions through `herdr_research_guide` with the saved `run`, `worker`, and `guidance`, including the same report path. Busy or approval-blocked workers receive queued follow-ups without terminal input; do not spawn duplicates to bypass their state.
- Use `hc --skill` before direct terminal inspection or cleanup. Inspect exact returned terminal IDs only for explicit recovery, not routine waiting. Do not kill or restart the user's other terminals or core. A terminated worker cannot be reopened through guidance; inspect saved findings and obtain direction before starting replacement work.
- Closing Herdr App does not stop workers. Reloading extensions in the same Pi session preserves processes and restores mailbox ownership/deduplication. Forking or switching sessions does not transfer run ownership. Workers end when the parent program ends; unfinished work is not automatically replayed. Use `/skill:handoff` instead when work must continue independently of the parent.

Use a separately configured analysis workflow for operational-data work. No new `/research` alias, launcher, report registry, or archive system is needed.
