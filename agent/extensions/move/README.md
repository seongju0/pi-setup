# Move session

Run `/move` to pick a destination, or `/move <path>` to move directly using the existing path behavior.

## Configuration

Optionally create `~/.pi/agent/extensions/move/config.json` (under Pi's agent directory if overridden):

```json
{
  "root": "~/Work"
}
```

Setup links only `index.ts` into this local extension directory; it does not link
or replace the whole directory. Keep `config.json` here, not in the checkout.
An existing configuration survives setup and later reinitialization.

The default is `~/Work` when the file or `root` field is absent. The picker reads configuration each time it opens and creates the root directory recursively if needed. It does not create the configuration file.

`root` accepts `~`, paths beginning with `~/`, or absolute paths. Relative paths, invalid JSON, and invalid root values produce an error rather than falling back to another destination. `/move <path>` bypasses picker configuration and root creation.

## Picker

- **Root** is the first option and selects the configured root itself, even when it has no child directories.
- Only immediate subdirectories appear; dot-prefixed directories and files are excluded.
- Type to fuzzy-search directory names using Pi's built-in matcher. Matching is case-insensitive; characters need not be consecutive. Results are ranked by match quality.
- An empty query restores alphabetical order and selects Root. A nonempty query selects the best matching directory, with Root still available above the results. If there are no matches, only Root remains.
- **↑/↓** navigate, **Enter** selects, **Escape** cancels.

Changes to extension code require `/reload`; changes to configuration do not.
