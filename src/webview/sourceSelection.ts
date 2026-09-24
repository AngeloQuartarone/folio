/*
 * Where a selection in the preview comes from in the Markdown source.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The host looks the text up between the block's first and last source
 * lines; `occurrence` tells which match it is when the text appears more
 * than once in the block ("the bank ... the river bank").
 */

const MAX_TEXT = 1000;

/**
 * Text the renderer adds, which the Markdown source does not contain: the
 * title of an alert ("Warning" for `> [!WARNING]`) and footnote marks.
 */
const GENERATED = '.markdown-alert-title, .footnote-ref, .footnote-backref, .folio-reading-time, .folio-copy';

export interface SelectionInSource {
  /** 0-based first line of the block where the selection starts. */
  line: number;
  /** 0-based line after the block where the selection ends. */
  endLine: number;
  /** Selected text, whitespace collapsed. */
  text: string;
  /** How many times `text` appears in the block before the selection. */
  occurrence: number;
}

/** The current selection inside `root`, or undefined when there is none. */
export function selectionInSource(root: HTMLElement): SelectionInSource | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return undefined;
  }
  const text = collapseSpaces(sourceText(range)).trim();
  const start = sourceBlock(range.startContainer, root);
  if (!text || text.length > MAX_TEXT || !start) {
    return undefined;
  }
  const end = sourceBlock(range.endContainer, root) ?? start;
  const line = Number(start.dataset['sourceLine']) - 1;
  const endLine = Math.max(Number(end.dataset['sourceEnd']), Number(start.dataset['sourceEnd']));
  if (!Number.isInteger(line) || !Number.isInteger(endLine)) {
    return undefined;
  }
  const before = document.createRange();
  before.selectNodeContents(start);
  before.setEnd(range.startContainer, range.startOffset);
  const whole = document.createRange();
  whole.selectNodeContents(start);
  const occurrence = occurrencesBefore(
    collapseSpaces(sourceText(whole)),
    text,
    collapseSpaces(sourceText(before)).length,
  );
  return { line, endLine, text, occurrence };
}

/** Matches of `needle` in `haystack` that start before `offset`. */
export function occurrencesBefore(haystack: string, needle: string, offset: number): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1 && at < offset; at = haystack.indexOf(needle, at + 1)) {
    count++;
  }
  return count;
}

/** The text of `range` without the parts the renderer generated. */
function sourceText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(GENERATED).forEach((element) => element.remove());
  return fragment.textContent ?? '';
}

function sourceBlock(node: Node, root: HTMLElement): HTMLElement | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest<HTMLElement>('[data-source-line][data-source-end]');
  return block && root.contains(block) ? block : undefined;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ');
}
