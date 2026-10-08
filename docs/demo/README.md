# Recording the demo GIF

The animated GIF at the top of the README (`docs/images/demo.gif`) is a screen
recording of Folio on [`rivers.md`](rivers.md). It is not shipped in the
`.vsix`: the Marketplace and Open VSX load it from GitHub.

## Set up

- VS Code with a light, uncluttered theme; hide the Activity Bar, the minimap
  and the status bar; window about 1280×800.
- Folio: Sepia theme, translation target Italian (the English → Italian model
  already downloaded), focus mode off.
- Open `rivers.md` and **Folio: Open Preview to the Side** (`Cmd+K V`).

## Record (about 15 seconds)

Start with `Cmd+Shift+5` → *Record Selected Portion*, around the VS Code
window.

1. Scroll the preview a little: the progress bar moves.
2. Open the table of contents (top left), click **The middle course**.
3. Select *river bank* in "We sat on the river bank": the translation appears.
4. Press `f`: focus mode; scroll one notch to the next section, then `f` again.
5. Select "a fan of land", **Add note**, type *check the Nile delta*, save:
   the pin appears in the margin.

## Convert

```sh
node scripts/gif.mjs ~/Desktop/recording.mov
```

It writes `docs/images/demo.gif` (960 px wide, 12 fps). Keep it under about
5 MB; if it is larger, record a shorter clip or pass `--width 800`.
