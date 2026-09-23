# Changelog

## 0.1.0 (unreleased)

- First version, derived from Markdown Preview Enhanced 0.8.36 / crossnote 0.9.39
  (see UPSTREAM.md) and rebuilt on a minimal markdown-it engine.
- Preview with live update, scroll sync, 17 preview themes (new: Sepia) and
  24 code block themes.
- KaTeX math, Mermaid diagrams, GitHub alerts, footnotes, emoji, task lists.
- Offline translation of selected text in a tooltip: Bergamot WASM engine in
  a worker thread, local language detection (eld), 11 languages, models
  downloaded once on request (or supplied in a folder), in-memory cache.
  No API keys and no cloud services.
- Quick settings panel in the preview (discreet gear button): theme, target
  language, translation and scroll sync toggles, exports.
- The built-in Markdown preview button is hidden (configurable).
- Export to PDF (local Chrome/Edge/Chromium/Brave) and self-contained HTML.
