# View in an editor

**`/view [path]` opens your current directory or a file in your editor without leaving Pi.** Defaults to Zed and expects the editor to be installed.

```text
/view                    open the current working directory
/view src/main.ts        open a relative path
/view /absolute/path     open an absolute path
```

## Choose an editor

Optionally configure your personal Pi settings (`~/.pi/agent/settings.json`):

```json
{
  "view": {
    "editor": "code",
    "args": ["--reuse-window"]
  }
}
```

`editor` is an executable name on `PATH` or an executable path. `args` are passed before the target path. Changes apply on the next `/view` invocation.

Zed is available through pi-setup's optional-tool checklist, using `brew install --cask zed`.
