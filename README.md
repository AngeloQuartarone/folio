# Markdown Translate Preview

A lean Markdown preview for Visual Studio Code with carefully styled themes,
editor ↔ preview scroll sync, PDF/HTML export and **offline translation**:
select words in the preview and their translation appears right below — no
account, no API key, no cloud service.

It is an independent, slimmed-down project derived from
[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
(see [Credits](#credits)).

## Features

- **Translate a selection, offline**: select one or more words in the preview
  and a tooltip shows the translation, labelled
  *detected language → target language*. Translation runs on your computer
  with the [Bergamot](https://browser.mt/) engine (the one behind Firefox's
  offline translations); the language is detected locally from the
  surrounding sentence. 11 languages: English, Italian, French, German,
  Spanish, Portuguese, Russian, Ukrainian, Bulgarian, Czech, Estonian.
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
| Markdown Translate: Manage Offline Languages | |
| Markdown Translate: Set Target Language | |
| Markdown Translate: Toggle Translation Tooltips | |

The preview button is also in the editor title bar, and the export commands in
the editor context menu. Exports are written next to the Markdown file.

## Translation

Everything happens on your computer. The only time the extension uses the
network is to download a language model, **once, and only when you ask**:

1. Open a preview and select some text.
2. The first time for a language pair the tooltip says the model is not
   installed and offers **Download (22 MB)**. Click it: the model is
   downloaded (SHA-256 verified) and the translation appears.
3. From then on that pair works offline.

You can also download or remove models in advance with
**Markdown Translate: Manage Offline Languages**. Pairs without a direct model
(e.g. German → Italian) go through English and need both models
(German → English and English → Italian).

**Never touch the network**: download the model files yourself (the URLs are
in [`src/translation/offline/models.json`](src/translation/offline/models.json)),
put them in a folder with one subfolder per pair — e.g. `enit/model.enit.intgemm.alphas.bin`,
`enit/lex.50.50.enit.s2t.bin`, `enit/vocab.enit.spm` — and set
`markdownTranslate.modelsPath` to that folder. The extension then only reads
from it.

How it works: the webview sends the selection to the extension; the
Bergamot WASM engine runs in a worker thread of the extension host and
answers in a few milliseconds (the first translation after start loads the
model and takes about a quarter of a second). The engine is stopped after 5
minutes of inactivity to free memory. Translations are cached in memory per
text and target language.

The tooltip closes when you click elsewhere, press <kbd>Esc</kbd> or make a new
selection. If the text is already in the target language a small
"Already in …" note is shown.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `markdownTranslate.enabled` | `true` | Show the translation tooltip on selection. |
| `markdownTranslate.targetLanguage` | `it` | Language to translate into (one of the 11 above). |
| `markdownTranslate.sourceLanguage` | `auto` | Language of your documents, or `auto` to detect it from the sentence (falling back to the whole document). |
| `markdownTranslate.modelsPath` | `""` | Folder with the models; empty = extension storage. |
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
- Offline models cover 11 languages; other languages show a clear message.
  Quality is good for sentences and lower for isolated words, which the
  engine translates without their context.
- Language detection on a very short sentence can be wrong; set
  `markdownTranslate.sourceLanguage` if your documents are always in the
  same language.
- The model list is the Bergamot registry of 2022 shipped with the
  extension; newer or additional models are not picked up automatically.
- Each model uses about 22 MB on disk and roughly 100 MB of memory while
  the engine is running.
- PDF export needs a Chromium-based browser installed locally. Page size
  follows the browser default (A4 or Letter depending on locale); margins are
  fixed. When the theme follows the editor/OS, exports use the light variant.
- The HTML export is a single self-contained file: styles, KaTeX fonts and,
  when the document has diagrams, Mermaid are inlined (the file gets about
  5 MB larger in that case).
- Scripts inside the Markdown never run: the preview and the exports use a
  strict Content Security Policy, and raw HTML is sanitized in the preview.
- Only one preview panel at a time (it follows the active Markdown editor).
- Not available in VS Code for the Web.

## Adding a translation engine

The tooltip talks to a `TranslationProvider` (`src/translation/types.ts`).
The built-in one is `OfflineProvider`
(`src/translation/offline/offlineProvider.ts`); another engine only needs to
implement `translate()` and throw a `TranslationError` with a code
(`modelMissing`, `unsupportedLanguage`, `undetected`, `engine`, …) that the
tooltip turns into a clear message.

## Credits

This project is based on **[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)**
by **Yiyi Wang ([shd101wyy](https://github.com/shd101wyy))** and on its
rendering engine **[crossnote](https://github.com/shd101wyy/crossnote)**, both
released under the University of Illinois/NCSA Open Source License.
Offline translation uses the [Bergamot translator](https://github.com/browsermt/bergamot-translator)
(MPL-2.0) and the Bergamot project's models (CC BY-SA 4.0), and
[eld](https://github.com/nitotm/efficient-language-detector-js) (Apache-2.0)
for language detection. The
preview and code block themes, the scroll sync algorithm and parts of the
Markdown pipeline come from those projects. Markdown Translate Preview is not
affiliated with or endorsed by their author.

See [LICENSE.md](LICENSE.md), [UPSTREAM.md](UPSTREAM.md) (exact upstream
versions) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

University of Illinois/NCSA Open Source License — see [LICENSE.md](LICENSE.md).
