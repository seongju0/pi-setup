# Herdr session checks

From the repository root, run the deterministic suite:

```bash
node agent/extensions/herdr-session/tests/test.mjs
```

The suite uses Pi's real extension loader, generic Herdr tools, skill expansion, and agent context reconstruction. A fake `hc` executable replaces the external CLI; synthetic in-process model responses replace provider calls. All runtime configuration/auth, workflow fixtures, and mailbox state use temporary directories; `PI_CODING_AGENT_DIR` is set to scratch and restored. Skills come from checkout `agent/skills`, not the user's installed skills. No analysis skill is required.

Coverage includes public-SDK seeded sessions and exact child-session acknowledgement, interactive caller validation, launch lifecycle and placement, preflight errors, cancellation, recovery identifiers, partial/failed research launches, physical-model validation without fallback, virtual-router rejection, mailbox ownership/reload/deduplication/follow-up, and persistent guidance through compaction. A scratch-only local adapter exercises independent handoff by default and explicit report-back by calling the actual generic tools through `ctx.executeTool`; it supplies synthetic guidance and model selection, not workplace policy. File-only reporting rejects inline findings, private paths, and symlink escapes, and delivers only `Shareable report: <path>` rather than arbitrary summaries or report contents.

`PI_TEST_PACKAGE_ROOT` can point to an installed `@earendil-works/pi-coding-agent` package directory. Otherwise both scripts resolve it using `npm root -g`.

## Optional live smoke test

Only with explicit authorization, from an hc-managed interactive Pi terminal with a live `HC_TERMINAL_ID` and an app space:

```bash
node agent/extensions/herdr-session/tests/live.mjs
```

**This starts one real interactive Pi child in a visible, kept tab and may incur provider charges.** It uses a real Pi session manager for the caller context and leaves model selection to Pi defaults; it does not need a synthetic model registry. It confirms launch acceptance, uses native `hc wait` (up to 60 seconds) for child state rather than model-driven polling, then reads the known session file to verify the exact assistant reply `HERDR_NATIVE_HANDOFF_SMOKE_OK` and session ID.

Only the extension loader uses a temporary `PI_CODING_AGENT_DIR`. The script restores the original environment **before launch**, so the runtime's effective agent directory passed to the real child is the user's actual configuration, not the loader scratch directory. Normal model selection and authentication are not bypassed. The child's sole task is the synthetic reply; it must not edit files, inspect repositories, execute commands, call external tools, or start agents. Its tab, session file, and temporary brief are retained for inspection; the script does not close them.

Launch acknowledgement means the child recorded the user prompt, not that the task completed successfully. Unconfirmed launches retain known terminal/session/app-placement identifiers. A missing reply after `hc wait` is a smoke failure, not permission to relaunch or resend; inspect the retained session first. This script is not part of `npm test` and must not run without separate live-test authorization.
