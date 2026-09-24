# Changelog

## 0.1.0 (unreleased)

- **Folio**: the extension's new name and identity, a calm Markdown reader
  (formerly Markdown Translate Preview). Settings are now `folio.*` and
  commands `Folio: …`; former settings and downloaded models are carried
  over on first start.
- Reading: typography settings (text size, line spacing, column width,
  font), a table of contents with the current section highlighted, reading
  time and a progress bar, focus mode, and resume reading where you stopped.
  The table of contents opens as a sidebar beside the text (the text moves
  over and keeps your place). A preview too narrow for it is widened the
  first time the table of contents opens, taking room from the editor
  beside it (`folio.reading.outlineFit`: `once`, `always` to also give the
  room back when it closes, or `never`); where it still floats over the
  text, a click on the text closes it (`folio.reading.outlineAutoClose`).
- Reading, more: fold sections from their heading; footnotes and link
  targets (a heading, another Markdown file) previewed on hover; Back after
  following a link, with the mouse's back button, Alt+← or a Back button;
  keys to move through the document (j/k, J/K, g/G, t); focus on the
  sentence being read; Atkinson Hyperlegible and OpenDyslexic fonts
  (bundled); justified, hyphenated text.
- Folio Reader: Markdown files as the reading view in their own tab
  (Open With…, *Folio: Open in Reader*; `folio.openInReader` for every file,
  off by default), with *Folio: Open Source* back to the text.
- Translate the whole document offline, each translation below its
  original (bold, italics and links kept; code and math left alone), the
  visible part first; from the settings panel or *Folio: Translate
  Document*.
- Rendering: `[[wiki links]]` (pages found anywhere in the workspace,
  `![[image]]` embeds), front matter shown as a header on request, and a
  stylesheet of your own for the preview and exports.
- Notes in the margin: highlight selected text with a note; notes follow
  their text when the document changes and are listed in the table of
  contents.
- Notes are kept in the document itself, in one HTML comment at its end
  that other Markdown viewers hide: they travel with the file, and an AI
  reading it can answer them (replies) or resolve them; Folio shows the
  replies and dims resolved notes. Reply, Resolve and Reopen in the note's
  card. "Copy for AI" copies the notes as a ready-made message. The block is
  never rendered, exported or copied. `folio.notes.storage: sidecar` keeps
  them in `<file>.folio.json` instead; notes already there are offered to be
  moved. `folio.notes.author` sets the name on notes.
- Copy buttons on code blocks, image zoom, and "Copy as formatted text" of
  the whole document (for email, Word or Google Docs; math as TeX).
- First version, derived from Markdown Preview Enhanced 0.8.36 / crossnote 0.9.39
  (see UPSTREAM.md) and rebuilt on a minimal markdown-it engine.
- Preview with live update, scroll sync, 3 preview themes (Light, Dark in the VS Code theme
  colors, Sepia) and
  24 code block themes.
- Text selected in the preview is selected and highlighted in the source
  editor, when that editor is visible (the file is never opened for it).
- KaTeX math, Mermaid diagrams, GitHub alerts, footnotes, emoji, task lists.
- Offline translation of selected text in a tooltip: Bergamot WASM engine in
  a worker thread, local language detection (eld), 11 languages, models
  downloaded once on request (or supplied in a folder), in-memory cache.
  No API keys and no cloud services.
- PDF and HTML exports always use the Light theme.
- Clicking a link in the preview no longer also opens its internal
  vscode-resource address in the browser.
- Scroll sync no longer drifts the preview down on its own: only scrolls
  made by the user are synced, and the editor does not echo them back.
- Selections are translated inside their sentence, so words get the meaning
  that fits the context (the sentence is part of the cache key).
- Single words can also show their other meanings, behind an "Other
  meanings" button, from an offline Wiktionary dictionary (WikDict),
  downloaded on request.
- A calmer, macOS-like interface: translucent tooltip and panels, segmented
  theme picker, a settings window with sections; a centred reading column
  and softer typography in the preview.
- Quick settings panel in the preview (discreet gear button): theme, target
  language, translation and scroll sync toggles, exports; and a full settings
  view with every setting in sections, including the offline languages
  (download or remove each one).
- The built-in Markdown preview button is hidden (configurable).
- Export to PDF (local Chrome/Edge/Chromium/Brave) and self-contained HTML.
