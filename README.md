# Markdown Translate Preview

A lean Markdown preview for Visual Studio Code with carefully styled themes,
editor ↔ preview scroll sync and PDF/HTML export.

It is an independent, slimmed-down project derived from
[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
(see [Credits](#credits)).

## Features

- **Live preview** in a side panel that follows the active Markdown editor and
  updates as you type.
- **Everything GitHub renders**: tables, task lists, fenced code with syntax
  highlighting (Prism, ~400 languages), footnotes, emoji `:smile:`,
  `~sub~`/`^sup^`/`==mark==`, definition lists, abbreviations, GitHub alerts
  (`> [!NOTE]` …), raw HTML (sanitized), heading anchors, front matter (hidden).
- **Math** with KaTeX: `$…$`, `$$…$$` and ```` ```math ```` blocks.
- **Mermaid** diagrams in ```` ```mermaid ```` blocks (loaded only when a
  document contains one).
- **Images relative to the Markdown file** (and `/path` relative to the
  workspace root).
- **Scroll sync** in both directions.
- **Themes**: 17 preview themes including GitHub light/dark, a warm
  **Sepia** reading theme, Newsprint, Solarized, One, Atom and a `vscode`
  theme that follows your editor colors; 24 code block themes, or `auto` to
  match the preview theme. Light/dark variants can follow the editor or the OS.
- **Export PDF** (via your installed Chrome/Edge/Chromium/Brave, no extra
  download) and **Export HTML** (single self-contained file).

## Usage

| Command | Default shortcut |
| --- | --- |
| Markdown Translate: Open Preview to the Side | `Ctrl+K V` / `Cmd+K V` |
| Markdown Translate: Open Preview | `Ctrl+Shift+V` / `Cmd+Shift+V` |
| Markdown Translate: Select Preview Theme | |
| Markdown Translate: Select Code Block Theme | |
| Markdown Translate: Sync Preview to Cursor | |
| Markdown Translate: Toggle Scroll Sync | |
| Markdown Translate: Export PDF | |
| Markdown Translate: Export HTML | |

The preview button is also in the editor title bar, and the export commands in
the editor context menu. Exports are written next to the Markdown file.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `markdownTranslate.previewTheme` | `github-light.css` | Preview theme. |
| `markdownTranslate.codeBlockTheme` | `auto.css` | Code block theme; `auto` matches the preview theme. |
| `markdownTranslate.previewColorScheme` | `editorColorScheme` | Switch paired themes (github, atom, one, solarized) to light/dark following the editor (`editorColorScheme`), the OS (`systemColorScheme`), or never (`selectedPreviewTheme`). |
| `markdownTranslate.scrollSync` | `true` | Synchronize editor and preview scrolling. |
| `markdownTranslate.liveUpdateDebounceMs` | `300` | Delay before the preview updates after an edit. |
| `markdownTranslate.breakOnSingleNewLine` | `false` | Render single line breaks as `<br>`. |
| `markdownTranslate.math.enabled` | `true` | Render math with KaTeX. |
| `markdownTranslate.mermaid.enabled` | `true` | Render Mermaid diagrams. |
| `markdownTranslate.chromePath` | `""` | Browser used for PDF export; detected automatically when empty. |

## Installation

From a `.vsix` file: **Extensions** view → `…` menu → **Install from VSIX…**,
or `code --install-extension markdown-translate-preview-<version>.vsix`.

### Build from source

Requires Node.js 18 or later.

```sh
npm install
npm run build          # bundle into dist/
npm test               # type check + unit tests
npm run test:integration   # runs the extension inside a downloaded VS Code
npm run package        # creates markdown-translate-preview-<version>.vsix
```

Press **F5** in VS Code to start an Extension Development Host (the `npm: watch`
task rebuilds on change).

## Known limitations

- PDF export needs a Chromium-based browser installed locally. Page size
  follows the browser default (A4 or Letter depending on locale); margins are
  fixed. When the theme follows the editor/OS, exports use the light variant.
- The HTML export loads Mermaid from the jsDelivr CDN when the document has
  diagrams; everything else (styles, KaTeX fonts) is inlined.
- Scripts inside the Markdown never run: the preview and the exports use a
  strict Content Security Policy, and raw HTML is sanitized in the preview.
- Only one preview panel at a time (it follows the active Markdown editor).
- Not available in VS Code for the Web.

## Credits

This project is based on **[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)**
by **Yiyi Wang ([shd101wyy](https://github.com/shd101wyy))** and on its
rendering engine **[crossnote](https://github.com/shd101wyy/crossnote)**, both
released under the University of Illinois/NCSA Open Source License. The
preview and code block themes, the scroll sync algorithm and parts of the
Markdown pipeline come from those projects. Markdown Translate Preview is not
affiliated with or endorsed by their author.

See [LICENSE.md](LICENSE.md), [UPSTREAM.md](UPSTREAM.md) (exact upstream
versions) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

University of Illinois/NCSA Open Source License — see [LICENSE.md](LICENSE.md).
