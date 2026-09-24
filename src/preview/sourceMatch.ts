/*
 * Find text selected in the preview inside the Markdown source.
 * No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The rendered text lacks the Markdown syntax (`**bold**`, `[link](url)`,
 * line breaks, `> ` and list markers), so the selection is turned into a
 * pattern that tolerates that syntax between its characters.
 */

/** Inline syntax that can sit between two rendered characters. */
const MARKUP = String.raw`[*_~\x60\\]|\[\^[^\]\n]+\]|\]\([^)\n]*\)|\]\[[^\]\n]*\]|\[|\]|<[^>\n]*>`;

/**
 * What a space in the rendered text can be in the source: whitespace and
 * line breaks, block markers (quote, heading, list, table cell) and markup.
 */
const GAP = String.raw`(?:\s|[>#|+-]|\d+[.)](?=\s)|${MARKUP})+`;

const MAX_TEXT = 1000;

export interface SourceMatch {
  /** Offsets in `source`, end exclusive. */
  start: number;
  end: number;
}

/**
 * The `occurrence`-th (0-based) place where `text` appears in `source`,
 * or the last one when there are fewer; undefined when there is none.
 */
export function findRenderedText(source: string, text: string, occurrence: number): SourceMatch | undefined {
  const pattern = renderedTextPattern(text);
  if (!pattern) {
    return undefined;
  }
  let found: SourceMatch | undefined;
  let count = 0;
  for (const match of source.matchAll(pattern)) {
    found = { start: match.index, end: match.index + match[0].length };
    if (count++ === occurrence) {
      break;
    }
  }
  return found;
}

function renderedTextPattern(text: string): RegExp | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT) {
    return undefined;
  }
  let source = '';
  let previous = '';
  for (const char of trimmed) {
    if (/\s/.test(char)) {
      if (!/\s/.test(previous)) {
        source += GAP;
      }
    } else {
      if (previous && !/\s/.test(previous)) {
        source += `(?:${MARKUP})*`;
      }
      source += char.replace(/[\\^$.*+?()[\]{}|/]/, '\\$&');
    }
    previous = char;
  }
  return new RegExp(source, 'gu');
}
