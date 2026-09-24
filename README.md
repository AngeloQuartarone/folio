<p align="center"><img src="media/icon.png" width="96" alt=""></p>

# Folio — a calm Markdown reader

**Folio** is a Markdown preview for Visual Studio Code made for *reading*:
quiet themes in the colors of paper, your editor or the night; a table of
contents that follows you; focus mode; notes in the margin; and **offline
translation** of whatever you select — no account, no API key, no cloud.

It is an independent project derived from
[Markdown Preview Enhanced](https://github.com/shd101wyy/vscode-markdown-preview-enhanced)
(see [Credits](#credits)).

## Features

### Reading

- **Themes**: Light, Dark (in the colors of your VS Code theme) and a warm
  **Sepia** paper theme, with a centred reading column and soft typography.
  Light/Dark can follow the editor or the system.
- **Typography**: text size, line spacing, column width and font (the
  theme's, sans-serif, serif, or two bundled fonts designed for legibility:
  Atkinson Hyperlegible and OpenDyslexic). Paragraphs can be justified,
  with long words hyphenated in the document's language.
- **Table of contents**: a button in the top-left corner opens the headings,
  with the section you are reading highlighted; click one to go there. It
  opens as a sidebar beside the text, which moves over to make room. When
  the preview is too narrow for that, Folio widens it the first time you
  open the table of contents, taking room from the editor beside it (which
  keeps at least 260 pixels); set `folio.reading.outlineFit` to `always` to
  also give the room back when it closes, or `never`. In a preview left
  narrow the table of contents floats over the text, and a click on the
  text closes it.
- **Reading time and progress**: "8 min read" above the document, the time
  left in the table of contents, and a progress bar at the top.
- **Focus mode**: everything but the section you are reading (a heading
  with everything below it up to the next heading, cut into parts only when
  it does not fit in the window)
  fades and blurs a little (soft, medium or strong:
  `folio.reading.focusStrength`); or keep a single block (a paragraph, a
  list item, a table), or the sentence, clear (`folio.reading.focusScope`). One notch of the mouse
  wheel, `↑`/`↓` or `j`/`k` moves the focus to the next or previous part and
  brings it to the reading line; set
  `folio.reading.focusNavigation` to `scroll` to have the focus follow the
  page instead. Press `f` with the pointer on the preview to turn it on or
  off (`folio.reading.focusKey`), or give *Folio: Toggle Focus Mode* a
  shortcut of your own.
- **Fold sections**: the arrow left of a heading folds its section; what is
  folded is remembered for each document.
- **Previews on hover**: rest the pointer on a footnote to read it, on a
  link to a heading to see the start of that section, on a link to another
  Markdown file to see the start of that file.
- **Back**: after following a link (to a heading or to another Markdown
  file), the mouse's back button, `Alt+←` or the **Back** button next to the
  table of contents button takes you back to where you were.
- **Keyboard**: `j`/`k` next/previous paragraph, `J`/`K` next/previous
  heading, `g`/`G` top/bottom, `t` table of contents.
- **Resume reading**: each document reopens where you stopped (when the
  preview is not following an editor).

### Understanding

- **Translate a selection, offline**: select words in the preview and their
  translation appears right below, labelled *detected language → target
  language*. The selection is translated inside its sentence, so words get
  the meaning that fits (*bank* in "the river bank" → riva). 11 languages,
  with the [Bergamot](https://browser.mt/) engine behind Firefox's offline
  translations.
- **Other meanings** of a single word, one click away, from an offline
  Wiktionary dictionary.
- **Translate the whole document**, offline: every paragraph, heading, list
  item and table cell gets its translation right below it, in a quieter
  colour, with its bold, italics and links; code and math stay as they are.
  The part you are looking at is translated first, and each translation
  appears as soon as it is ready. Start it from the settings panel
  (**Translate document**) or with *Folio: Translate Document*; the small
  pill at the top shows the progress, and its × shows the original only.

### Reader tab

- **Folio Reader**: open a Markdown file as the reading view in its own
  tab, without the text editor: **Open With… › Folio Reader**, *Folio: Open
  in Reader*, or the explorer's context menu. **Open Source** in its title
  bar opens the text. Set `folio.openInReader` to open every Markdown file
  this way (off by default).

### Working with the document

- **Notes in the margin**: select text, choose **Add note**, write. The text
  is highlighted with a pin in the margin; click it to read the note and its
  replies, reply, resolve, edit or delete it. All notes are listed in the
  table of contents, and follow their text when the document changes.
- **Notes that travel with the document, and that your AI reads**: notes are
  kept in one HTML comment at the end of the Markdown file. GitHub, VS Code's
  own preview, Obsidian and Pandoc do not show it, so the document looks the
  same everywhere; anyone opening the file with Folio sees the notes, and an
  AI assistant reading the file finds them, with a line explaining how to
  answer (a reply) or close them (`"status": "resolved"`). Folio shows those
  replies in the note's card. **Copy for AI** (in the Notes tab, or the
  command *Folio: Copy Notes for AI*) copies the notes as a message ready to
  paste into a chat. Adding a note is an ordinary edit of the document: it
  can be undone, and a document without unsaved changes is saved right
  away. Prefer a separate file? Set `folio.notes.storage` to `sidecar`
  (`<file>.folio.json`); notes already in such a file are offered to be
  moved into the document.
- **Selection sync**: text selected in the preview is selected and
  highlighted in the source, when the file is open in an editor next to it
  (the file is never opened for this).
- **Copy buttons** on code blocks, **image zoom** on click.
- **Copy as formatted text**: the whole document, ready to paste into an
  email, Word or Google Docs.
- **Export PDF** (with your installed Chrome/Edge/Chromium/Brave) and
  **Export HTML** (one self-contained file), always in the Light theme.

### Everything GitHub renders

Tables, task lists, fenced code with syntax highlighting (Prism, ~400
languages, 24 code themes), footnotes, emoji `:smile:`, `~sub~`/`^sup^`/`==mark==`,
definition lists, abbreviations, GitHub alerts (`> [!NOTE]` …), raw HTML
(sanitized), heading anchors, **math** with KaTeX and **Mermaid** diagrams.
Images resolve relative to the Markdown file (and `/path` to the workspace
root). Scroll sync works in both directions.

And a few things GitHub does not:

- **Wiki links**, as Obsidian writes them: `[[Page]]`, `[[Page|text]]`,
  `[[Page#Heading]]`, `[[#Heading]]`, and `![[image.png]]` to show an image.
  A page is the Markdown file of that name, next to the document or
  anywhere in the workspace.
- **Front matter** hidden, or shown as a quiet header with one row per
  entry and lists as tags (`folio.frontMatter`).
- **Your own stylesheet** (`folio.customCss`), applied after Folio's styles
  in the preview and in exports, and reloaded when you save it.

## Usage

| Command | Default shortcut |
| --- | --- |
| Folio: Open Preview to the Side | `Ctrl+K V` / `Cmd+K V` |
| Folio: Open Preview | `Ctrl+Shift+V` / `Cmd+Shift+V` |
| Folio: Open in Reader | |
| Folio: Open Source | |
| Folio: Translate Document | |
| Folio: Toggle Focus Mode | |
| Folio: Copy Notes for AI | |
| Folio: Select Preview Theme | |
| Folio: Select Code Block Theme | |
| Folio: Sync Preview to Cursor | |
| Folio: Toggle Scroll Sync | |
| Folio: Export PDF | |
| Folio: Export HTML | |
| Folio: Manage Offline Languages | |
| Folio: Set Target Language | |
| Folio: Toggle Translation Tooltips | |

The preview button is also in the editor title bar, and the export commands in
the editor context menu. Exports are written next to the Markdown file.

**Inside the preview**, move the mouse and two quiet buttons appear: the
table of contents (top left) and the settings (top right). The settings
panel holds the everyday settings — theme, target language, translation and
scroll sync — with export and copy. **All settings…** opens a settings
window with every option in sections: Appearance, Reading, Translation,
Offline languages, Preview and Export.

## Translation

Everything happens on your computer. The only time the extension uses the
network is to download a language model or a dictionary, **once, and only
when you ask**:

1. Open a preview and select some text.
2. The first time for a language pair the tooltip says the model is not
   installed and offers **Download (22 MB)**. Click it: the model is
   downloaded (SHA-256 verified) and the translation appears.
3. From then on that pair works offline.

You can also download or remove languages in advance, in **All settings → Offline languages** or with **Folio: Manage Offline
Languages**. Installing a language
downloads its two models (to and from English); English itself is built in.
Pairs without a direct model (e.g. German → Italian) go through English and
need both models (German → English and English → Italian).

**Translation in context**: the selection is translated inside its
sentence, and only the matching part of the translation is shown, so the
model picks the meaning that fits (*bank* in "the river bank" → riva, not
banca; *bold* in "text in bold" → grassetto).

**Other meanings of a word**: when you select a single word, a discreet
**Other meanings** button under the translation opens its other meanings
from a dictionary (e.g. *bold* → grassetto, and also audace · ardito ·
coraggioso). The
dictionary of each language pair (from [WikDict](https://www.wikdict.com),
built from Wiktionary; 1–27 MB, e.g. English → Italian 15 MB) is downloaded
the first time you click **Other meanings** in the tooltip, and is removed
with its language. Dictionaries are direct (French → Italian needs no
English step) and exist for every language except Estonian and Ukrainian.
They list base forms, so *banks* or *went* only get the main translation.
Needs VS Code 1.101 or later (for its built-in SQLite). To stay offline, put
`<from>-<to>.sqlite3` files from
`https://download.wikdict.com/dictionaries/sqlite/2/` in a `dictionaries/`
subfolder of the models folder.

**Never touch the network**: download the model files yourself (the URLs are
in [`src/translation/offline/models.json`](src/translation/offline/models.json)),
put them in a folder with one subfolder per pair — e.g. `enit/model.enit.intgemm.alphas.bin`,
`enit/lex.50.50.enit.s2t.bin`, `enit/vocab.enit.spm` — and set
`folio.translation.modelsPath` to that folder. Folio then only reads from it.

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
| `folio.previewTheme` | `github-light.css` | `github-light.css` (Light), `github-dark.css` (Dark) or `sepia.css`. |
| `folio.previewColorScheme` | `selectedPreviewTheme` | Keep the theme you pick, or follow the editor (`editorColorScheme`) or the OS (`systemColorScheme`). |
| `folio.codeBlockTheme` | `auto.css` | Code block theme; `auto` matches the preview theme. |
| `folio.reading.fontSize` | `16` | Text size in pixels (13–24). |
| `folio.reading.lineHeight` | `comfortable` | `compact`, `comfortable` or `airy`. |
| `folio.reading.width` | `medium` | Reading column: `narrow`, `medium`, `wide` or `full`. |
| `folio.reading.font` | `theme` | `theme`, `sans`, `serif`, `hyperlegible` (Atkinson Hyperlegible) or `dyslexic` (OpenDyslexic). |
| `folio.reading.justify` | `false` | Justify paragraphs and hyphenate long words. |
| `folio.reading.outline` | `true` | Table of contents button. |
| `folio.reading.outlineFit` | `once` | Widen a narrow preview so the table of contents fits beside the text: `once` (the first time in each preview), `always` (and give the room back when it closes) or `never`. |
| `folio.reading.outlineAutoClose` | `true` | Close the table of contents with a click on the text when it floats over it. |
| `folio.reading.collapsible` | `true` | Fold a section with the arrow next to its heading. |
| `folio.reading.hoverPreviews` | `true` | Footnotes and link targets on hover. |
| `folio.reading.keyboard` | `true` | `j`/`k`, `J`/`K`, `g`/`G`, `t` and `Alt+←` move through the document. |
| `folio.reading.progress` | `true` | Reading time and progress bar. |
| `folio.reading.focusMode` | `false` | Dim everything but the paragraph being read. |
| `folio.reading.focusScope` | `section` | What focus mode keeps clear: `section` (a heading with its paragraphs), `paragraph` or `sentence`. |
| `folio.reading.focusNavigation` | `step` | `step`: the wheel, `↑`/`↓` and `j`/`k` move the focus paragraph by paragraph; `scroll`: it follows the page. |
| `folio.reading.focusStrength` | `medium` | How much the rest fades: `soft`, `medium` (and a slight blur) or `strong`. |
| `folio.reading.focusKey` | `f` | Key that toggles focus mode with the pointer on the preview (empty: none). |
| `folio.reading.resume` | `true` | Reopen documents where you stopped reading. |
| `folio.notes.enabled` | `true` | Notes on selected text. |
| `folio.notes.storage` | `document` | Where notes are kept: `document` (a comment at the end of the Markdown file) or `sidecar` (`<file>.folio.json`). |
| `folio.notes.author` | *(empty)* | Your name on notes and replies; empty uses your Git `user.name`, else your system user name. |
| `folio.translation.enabled` | `true` | Show the translation tooltip on selection. |
| `folio.translation.targetLanguage` | `it` | Language to translate into (one of the 11 above). |
| `folio.translation.sourceLanguage` | `auto` | Language of your documents, or `auto` to detect it. |
| `folio.translation.modelsPath` | `""` | Folder with the models and dictionaries; empty = extension storage. |
| `folio.scrollSync` | `true` | Synchronize editor and preview scrolling. |
| `folio.liveUpdateDebounceMs` | `300` | Delay before the preview updates after an edit. |
| `folio.breakOnSingleNewLine` | `false` | Render single line breaks as `<br>`. |
| `folio.math.enabled` | `true` | Render math with KaTeX. |
| `folio.mermaid.enabled` | `true` | Render Mermaid diagrams. |
| `folio.wikiLinks` | `true` | Render `[[wiki links]]`. |
| `folio.frontMatter` | `hide` | Front matter: `hide`, or `show` as a header. |
| `folio.customCss` | *(empty)* | A CSS file of yours for the preview and exports (absolute, `~/…` or relative to the workspace folder). |
| `folio.openInReader` | `false` | Open Markdown files in the Folio Reader tab instead of the text editor (sets `workbench.editorAssociations`). |
| `folio.hideBuiltInPreviewButton` | `true` | Hide VS Code's own Markdown preview button. |
| `folio.chromePath` | `""` | Browser used for PDF export; detected automatically when empty. |

Coming from **Markdown Translate Preview** (Folio's former name)? Your
`markdownTranslate.*` settings and downloaded models are carried over the
first time Folio starts.

## Installation

Folio is distributed as a single file, `folio-<version>.vsix`
(e.g. `folio-0.1.0.vsix`). You need VS Code 1.85 or later (1.101 or later
for the **Other meanings** dictionary); nothing else.

1. Save the `.vsix` file somewhere on your computer.
2. In VS Code, open the **Extensions** view: click the Extensions icon in
   the Activity Bar, or press <kbd>Ctrl+Shift+X</kbd> / <kbd>Cmd+Shift+X</kbd>.
3. Click the **`…`** (Views and More Actions) button at the top right of the
   Extensions view.
4. Choose **Install from VSIX…** and pick the `.vsix` file.
5. Wait for the "Completed installing extension" message. If VS Code asks
   to reload the window, accept.

To check that it works, open any `.md` file and press <kbd>Ctrl+K V</kbd> /
<kbd>Cmd+K V</kbd>: the Folio preview opens beside the editor. Select a
sentence in it: the first time, the tooltip offers to download the model for
that language pair (see [Translation](#translation)).

Folio takes over the <kbd>Ctrl+Shift+V</kbd> / <kbd>Cmd+Shift+V</kbd> and
<kbd>Ctrl+K V</kbd> / <kbd>Cmd+K V</kbd> shortcuts in Markdown files; VS Code's
built-in preview stays available from the Command Palette
(**Markdown: Open Preview**).

**Update**: install the new `.vsix` the same way; it replaces the old
version and keeps your settings and downloaded models.
**Uninstall**: find **Folio** in the Extensions view → gear icon →
**Uninstall**.

### Build from source

Requires Node.js 18 or later.

```sh
npm install
npm run build          # bundle into dist/
npm test               # type check + unit tests
npm run test:integration   # runs the extension inside a downloaded VS Code
npm run package        # creates folio-<version>.vsix
```

Press **F5** in VS Code to start an Extension Development Host (the `npm: watch`
task rebuilds on change).

## Known limitations

- Selections are limited to about 500 characters.
- Offline models cover 11 languages; other languages show a clear message.
  Quality is good for sentences; on lists of loose words (no real sentence)
  the engine can repeat or drop words.
- Language detection on a very short sentence can be wrong; set
  `folio.translation.sourceLanguage` if your documents are always in the
  same language.
- The model list is the Bergamot registry of 2022 shipped with the
  extension; newer or additional models are not picked up automatically.
- Each model uses about 22 MB on disk and roughly 100 MB of memory while
  the engine is running.
- PDF export needs a Chromium-based browser installed locally. Page size
  follows the browser default (A4 or Letter depending on locale); margins are
  fixed. Exports always use the Light theme, whatever the preview shows.
- The HTML export is a single self-contained file: styles, KaTeX fonts and,
  when the document has diagrams, Mermaid are inlined (the file gets about
  5 MB larger in that case).
- Scripts inside the Markdown never run: the preview and the exports use a
  strict Content Security Policy, and raw HTML is sanitized in the preview.
- Only one preview panel at a time (it follows the active Markdown editor).
- A note whose text was deleted from the document is listed as not found.
  Notes in the document are one line each; if two people add notes to the
  same file at the same time, Git may ask to merge those lines. A plain
  text editor (not a Markdown viewer) shows the notes comment at the end of
  the file. The `sidecar` storage needs a document saved on disk.
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
Markdown pipeline come from those projects. Folio is not
affiliated with or endorsed by their author.

See [LICENSE.md](LICENSE.md), [UPSTREAM.md](UPSTREAM.md) (exact upstream
versions) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

University of Illinois/NCSA Open Source License — see [LICENSE.md](LICENSE.md).
