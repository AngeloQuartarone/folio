# Markdown Translate Preview

A lean Markdown preview for Visual Studio Code with carefully styled themes,
editor ↔ preview scroll sync, PDF/HTML export and **on-the-fly translation**:
select words in the preview and their translation appears right below.

It is an independent, slimmed-down project derived from
[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
(see [Credits](#credits)).

## Features

- **Translate a selection**: select one or more words in the preview with the
  mouse and a tooltip shows the translation, labelled
  *detected language → target language*. The source language is detected
  automatically (using the surrounding sentence, so single words are detected
  reliably); you choose the target language. Providers: **DeepL** (API Free and
  Pro) and **LibreTranslate** (any server, API key optional).
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
| Markdown Translate: Set API Key | |
| Markdown Translate: Set Target Language | |
| Markdown Translate: Toggle Translation Tooltips | |

The preview button is also in the editor title bar, and the export commands in
the editor context menu. Exports are written next to the Markdown file.

## Translation

1. Choose a provider with `markdownTranslate.provider` (`deepl` by default).
2. Run **Markdown Translate: Set API Key** and paste your key.
   - **DeepL**: create a free or paid key at <https://www.deepl.com/pro-api>.
     Keys ending in `:fx` use the Free endpoint (`api-free.deepl.com`), all
     others the Pro endpoint (`api.deepl.com`).
   - **LibreTranslate**: set `markdownTranslate.libreTranslateUrl` to your
     server (for example `http://localhost:5000` for a
     [self-hosted](https://github.com/LibreTranslate/LibreTranslate) instance).
     The key is optional; `libretranslate.com` requires one.
3. Set the target language (`markdownTranslate.targetLanguage`, default `it`),
   open a preview and select some text.

The tooltip closes when you click elsewhere, press <kbd>Esc</kbd> or make a new
selection. If the text is already in the target language, a small
"Already in …" note is shown instead.

**Privacy and security.** API keys are stored with VS Code's SecretStorage
(the OS keychain), never in `settings.json`. The preview webview never
connects to the network: it sends the selection to the extension, which calls
the provider and sends the result back. Only the selected text and its
sentence are sent to the provider. Translations are cached in memory (per text
and target language) until VS Code is restarted or the provider/key changes.

**Errors** are shown in the tooltip: missing or rejected key (with a
**Set API Key** button), network failures and timeouts, exhausted quota or rate
limits, invalid target language.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `markdownTranslate.enabled` | `true` | Show the translation tooltip on selection. |
| `markdownTranslate.targetLanguage` | `it` | Language to translate into (`it`, `en`, `de`, `pt-BR`, `ja`, …). |
| `markdownTranslate.provider` | `deepl` | `deepl` or `libretranslate`. |
| `markdownTranslate.libreTranslateUrl` | `https://libretranslate.com` | LibreTranslate server URL. |
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

- Selections are limited to about 500 characters.
- With DeepL, for selections of up to three words the surrounding sentence is
  also sent for translation (to read its detected language), so it counts
  toward your character quota. The `context` parameter itself is free.
- LibreTranslate has no context parameter: the language is detected on the
  sentence, then the selection is translated on its own, so word sense may be
  less accurate than with DeepL.
- Target language codes are passed to the provider as they are (DeepL:
  `en` → `EN-US`, `pt` → `PT-PT`); unsupported codes produce an error in the
  tooltip.
- The in-memory cache is not persisted.
- PDF export needs a Chromium-based browser installed locally. Page size
  follows the browser default (A4 or Letter depending on locale); margins are
  fixed. When the theme follows the editor/OS, exports use the light variant.
- The HTML export loads Mermaid from the jsDelivr CDN when the document has
  diagrams; everything else (styles, KaTeX fonts) is inlined.
- Scripts inside the Markdown never run: the preview and the exports use a
  strict Content Security Policy, and raw HTML is sanitized in the preview.
- Only one preview panel at a time (it follows the active Markdown editor).
- Not available in VS Code for the Web.

## Adding a translation provider

Implement `TranslationProvider` (`src/translation/types.ts`), register it in
`src/translation/providers/index.ts` and add its id to the
`markdownTranslate.provider` enum in `package.json`. Providers receive the
text, its context sentence and the target language, and throw a
`TranslationError` with a code (`missingKey`, `invalidKey`, `quota`,
`network`, …) that the tooltip turns into a clear message.

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
