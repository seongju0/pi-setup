# Herdr session checks

From the repository root, run the deterministic suite:

```bash
node agent/extensions/herdr-session/tests/test.mjs
```

The suite uses Pi's real extension loader, generic Herdr tools, skill expansion, and agent context reconstruction. A fake `herdr` executable replaces the external CLI; synthetic in-process model responses replace provider calls. All runtime configuration/auth, workflow fixtures, and mailbox state use temporary directories; `PI_CODING_AGENT_DIR` is set to scratch and restored. Skills come from checkout `agent/skills`, not the user's installed skills. No analysis skill is required.

Coverage includes native startup prompts and exact child-session acknowledgement, delayed/working startup, preflight errors, cancellation, silent delivery failure, recovery identifiers, partial/failed research launches, physical-model validation without fallback, virtual-router rejection, mailbox ownership/reload/deduplication/follow-up, and persistent guidance through compaction. A scratch-only local adapter exercises independent handoff by default and explicit report-back by calling the actual generic tools through `ctx.executeTool`; it supplies synthetic guidance and model selection, not workplace policy. File-only reporting rejects inline findings, private paths, and symlink escapes, and delivers only `Shareable report: <path>` rather than arbitrary summaries or report contents. The silent-delivery timeout check intentionally takes about 15 seconds.

`PI_TEST_PACKAGE_ROOT` can point to an installed `@earendil-works/pi-coding-agent` package directory. Otherwise both scripts resolve it using `npm root -g`.

## Optional live smoke test

Only with explicit authorization, from a Herdr-managed pane:

```bash
node agent/extensions/herdr-session/tests/live.mjs
```

**This starts a real Pi tab and may incur provider charges.** It confirms that the initial prompt appears in the expected session and waits up to 60 seconds for `HERDR_NATIVE_HANDOFF_SMOKE_OK`. It sets its loader's `PI_CODING_AGENT_DIR` to a temporary directory and restores it afterward. The real child uses Pi defaults and its own runtime configuration. The child may read the brief but must not edit files, inspect repositories, call external tools, or start agents. Its tab and temporary brief are retained for inspection.

Launch acknowledgement means the child recorded the user prompt, not that the task completed successfully. Unconfirmed launches retain their agent/tab/pane IDs; inspect that session instead of blindly relaunching or resending. Only pre-start shell-busy failures are retried.
