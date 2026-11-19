# Reply visuals

Native terminal emphasis inspired by [pi-emphasis](https://github.com/johnlindquist/pi-emphasis), implemented with Pi's public Markdown transformer and existing parser rather than copying its reply template or code.

## Chat components

- Optional square status chips: `[[Done]]`, `[[Passed 12/12]]`, `[[Blocked]]`, `[[Needs you]]`, `[[Decision]]` and the vocabulary listed in `index.ts`.
- Theme-accented bold anchors, checks/crosses, arrows and tree connectors.
- Portable alert headers: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` (each in a blockquote).
- Pi continues to own task-list layout, tables, Mermaid, wrapping and streaming. Inline chips can appear in table cells.

The extension teaches the syntax only in interactive TUI runs. Use visuals when they help, not on every reply. Keep chip markers out of authored files, PRs, issues, commands and code. Labels state claims, not approvals or proof.

Task and durable TODO tool cards use shared foreground-only status styles. Their existing owners render actual result data; no new state, store, mutation control or UI tool is introduced. Task list counts describe the returned session board; single-task updates have no completion denominator. Durable discovery distinguishes open subsets from full lists and never presents search results as overall progress. Expanded views are bounded; use get/record/artifact tools for full data.

## Compatibility and limits

Requires Pi with `registerMarkdownTransformer`, explicit message-type filtering and tool render context (developed against 1.5.2). No external app, font package or rendering dependency is installed. Uses theme colors and ordinary Unicode, not Nerd Font glyphs. There are no settings/env switches or extra model calls.

The transformer skips parser-classified code, links, images, HTML and definitions. Unmappable nested source spans remain unchanged. Unknown/partial chip syntax is literal. Native Mermaid runs first; its inline-code rows remain protected. Native components stay readable without color.

Assistant decoration is display-only: stored/model text and `/copy` retain original Markdown; terminal selection copies what is displayed. HTML export does not run assistant Markdown transforms. Tool results retain original `content`, `details` and `structuredContent`; presentation cards do not promise identical formatting in external clients or exports. Historical result shapes fall back to original text.

Run `npm test`, or `node agent/extensions/reply-visuals/tests/test.mjs` with the project's supported Node version. Tests use the real installed Pi loader/TUI and temporary state, without model calls or live services.
