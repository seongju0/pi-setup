# Developing pi-setup

This repository holds copyable custom Pi extensions, skills, optional guidance
and example preferences. Installed Pi files, sessions, credentials and workplace
additions are not development targets. `agent/AGENTS.md` is consumer guidance to
selectively integrate into an existing file, not a replacement to install.

- Edit reusable source under `agent/`, not live agent directories.
- Keep the root README as the catalog. Document what to copy, repository-local
  dependencies and external prerequisites there and in relevant item READMEs.
- No installer, resource manifest, registry, provisioning or automatic migration.
  External apps, tools, packages and upstream skills stay with their owners.
- Preserve existing tool names, persisted-state paths and runtime behavior.
  Feature scripts are runtime code, not obsolete installation machinery.
- Never copy credentials, MCP configuration, workplace policy or runtime data.
- Treat settings as optional examples to merge, not defaults to enforce. Preserve
  user configuration when describing adoption or updates.
- Run `npm test`. Tests use temporary state and no real service calls.
- Do not install locally, reload/restart Pi or Herdr, or publish without authority.
- Prefer the smallest complete change; no unrelated refactors or new frameworks.

See `README.md` for the catalog and development commands.
