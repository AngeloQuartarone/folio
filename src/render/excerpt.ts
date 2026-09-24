/*
 * The start of a Markdown text, for previews on hover. No VS Code API: unit
 * tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/**
 * The start of a Markdown text from line `from`: up to the next heading of
 * the same or a higher level (when `from` is a heading), and never more than
 * 40 lines. Front matter is left out.
 */
export function markdownExcerpt(text: string, from: number, maxLines = 40): string {
  const lines = text.split(/\r?\n/);
  let start = from;
  if (start === 0 && /^(---|\+\+\+)\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.|\+\+\+)\s*$/.test(line));
    start = end > 0 ? end + 1 : 0;
  }
  const own = /^(#{1,6})\s/.exec(lines[start] ?? '')?.[1].length ?? 0;
  const excerpt: string[] = [];
  let inFence = false;
  for (let i = start; i < lines.length && excerpt.length < maxLines; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const heading = !inFence && i > start ? /^(#{1,6})\s/.exec(line) : null;
    if (heading && own && heading[1].length <= own) {
      break;
    }
    excerpt.push(line);
  }
  return excerpt.join('\n');
}
