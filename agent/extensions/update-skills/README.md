# Skill inventory and updates

`/skills` lists skills available from the user root, the current project's `.pi/skills`, and installed npm Pi packages. It classifies ownership from each skill path and frontmatter:

| Owner | Recognition | `/skills update` behavior |
|---|---|---|
| Repository | Symlink into this checkout's `agent/skills/` | Edit through pi-setup; setup/reload explicitly, never auto-pull |
| GitHub | `github-repo` tracking metadata | Runs `gh skill update <managed names> --dir ~/.pi/agent/skills --unpin` |
| Pi package | Loaded from a configured npm Pi package | Runs targeted `pi update <package-source>` |
| GWS | Installed `gws-*` generated skill names | Reports its upstream/tool-managed status only |
| Symlink | Skill directory is a symlink | Shows its resolved target; does not mutate it |
| Personal | No recognized owner | Does not update it |

Commands:

```text
/skills
/skills details <name>
/skills update
```

`/skills update` only updates user-scoped GitHub skills and packages that provide currently listed skills. It reports the native updater output (including available versions/change notes when the owner provides them), reports skipped repository/tool/symlink/personal skills with their management instruction, and reloads only when output indicates a change. It never infers or runs an arbitrary command from a skill's frontmatter, adopts an untracked repository, or changes project skills.

GWS skills should remain tied to the installed `gws` tool. Update that tool first, then deliberately regenerate/select its skills; `gws generate-skills` writes a broad skill set in the current directory, so it is intentionally not called here.

## Checks

```sh
# From the repository root:
npm test
```
