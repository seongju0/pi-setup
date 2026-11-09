# Move session

Run `/move` to pick a destination, or `/move <path>` to move directly using the existing path behavior. The picker is interactive-only; moving requires a saved session.

## Configuration

Optionally create `~/.pi/agent/extensions/move/config.json` (under Pi's agent directory if overridden):

```json
{
  "scope": ["~/Work", "~/Projects"]
}
```

`scope` accepts one nonempty absolute or home-relative path (`~` or `~/…`), or an array of those paths. It limits ordinary fuzzy discovery, not which explicit destination you may select. With no scope, the picker uses the working directory captured when it opens. An explicit `"scope": []` also means that working directory.

Existing `{"root":"~/Work"}` configurations remain supported without rewriting: `root` supplies the scope only when `scope` is absent. A supplied `scope` takes precedence, including `[]`. Invalid JSON, non-object configuration, empty/relative/NUL-containing paths, and invalid value types report an error instead of falling back to broader discovery.

Setup links only `index.ts` into this local extension directory; it does not link or replace the whole directory. Keep `config.json` here, not in the checkout. An existing configuration survives setup and later reinitialization. The picker never creates configuration or configured directories. Configuration is read on each opening.

`/move <path>` bypasses picker configuration and discovery. Its existing path interpretation is unchanged (including no new shell/tilde parsing).

## Picker

- **Scope** rows select the configured directories themselves. Ordinary text fuzzy-searches nested directory paths using Pi's built-in matcher; matching results are ranked, without pinning Scope above better matches.
- Discovery uses an existing `fd` on `PATH`, falling back to Pi's `bin/fd` only when the executable is missing. Nothing is downloaded or installed. `fd` is required for recursive discovery, not for explicit-path selection.
- Each scope is scanned once per opening, not per keystroke. Hidden and ignored directories are included; `.git`, `node_modules`, files, and recursive symlink traversal are excluded.
- Snapshots retain at most 20,000 directories per scope; matching choices are capped at 50 with 10 visible rows. Processes have a 10-second timeout and an 8 MiB output bound. Scan errors, stderr (even after successful exit), and incomplete results are reported in the picker; valid results from other scopes remain usable.
- Type an explicit absolute or `~/…` path to complete directories outside the configured scopes. `~/Wo` offers matching immediate children of home; `~/Work/` lists Work's children. Parent listings are nonrecursive, bounded to 20,000 entries, and cached for that dialog. Ordinary search does not scan home or disk dynamically. Files, `.git`, and `node_modules` are excluded from these suggestions too.
- **Use path** is first for explicit paths. It selects the typed path; normal directory validation still applies. **↑/↓** navigate, **Enter** selects, **Escape** cancels. Async completion never replaces results for a stale parent or updates a closed picker.

Selecting the current directory is a no-op. A move waits for idle, forks the saved history into the destination, and switches sessions. A cancelled switch deletes its unused fork; cancelling the picker leaves the original session unchanged. No session metadata is added.

Changes to extension code require `/reload`; changes to configuration do not.

## Checks

`node agent/extensions/move/tests/test.mjs` exercises the registered command with real Pi components, temporary files and sessions, and controlled host/fd-process boundaries. `npm test` also discovers this suite. The suite does not launch a live Pi session or establish terminal/IME rendering behavior; real-fd integration is a separate check.
