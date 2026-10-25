# Developing pi-setup

This repository is the source of the reusable Pi foundation. Installed Pi files,
sessions, credentials, and workplace additions are not development targets.
This file guides repository development; `agent/AGENTS.md` is the separate
instruction file installed for Pi consumers.

- Edit source under `agent/`, not a live agent directory.
- Keep resource inclusion explicit in `manifests/resources.json`.
- Use owner-native installers; do not vendor external package or tool installations.
- Do not copy credentials, MCP configuration, workplace policy, or runtime data.
- Preserve compatibility with existing persisted state and tool names.
- Run `npm test`. Tests must use temporary state and no real service calls.
- Do not run live setup, reload/restart Pi or Herdr, or publish without authorization.
- Prefer the smallest complete change; avoid new frameworks and unrelated refactors.

See `README.md` for the supported environment and development commands.
