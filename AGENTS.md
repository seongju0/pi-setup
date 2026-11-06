# Developing pi-setup

This repository is the source of the reusable Pi foundation. Installed Pi files,
sessions, credentials, and workplace additions are not development targets.
This file guides repository development; `agent/AGENTS.md` is the separate
instruction file installed for Pi consumers.

- Edit source under `agent/`, not a live agent directory.
- Keep resource inclusion explicit in `manifests/resources.json`.
- Own only custom Pi resources, guidance, and explicit preference defaults.
  Do not install or offer external apps, tools, packages, or upstream companion skills;
  document feature dependencies instead.
- Do not copy credentials, MCP configuration, workplace policy, or runtime data.
- Preserve compatibility with existing persisted state and tool names.
- Reconcile missing declared links and missing preference leaves only, with one
  safe-change preview and approval. Preserve existing settings, skip/report resource
  conflicts, and never prune or replace resources. Settings remain a regular local file.
- Run `npm test`. Tests must use temporary state and no real service calls.
- Do not run live setup, reload/restart Pi or Herdr, or publish without authorization.
- Prefer the smallest complete change; avoid new frameworks and unrelated refactors.

See `README.md` for the supported environment and development commands.
