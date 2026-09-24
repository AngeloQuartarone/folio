/*
 * Notes kept in the document itself: one HTML comment at the very end of
 * the Markdown file, which renderers (GitHub, VS Code, Obsidian, Pandoc…)
 * do not show, and which an AI reading the file finds and understands.
 * No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 *   <!-- folio:notes v1
 *   Notes on this document, written with Folio … (instructions)
 *   {"id":"…","quote":"…","text":"…",…}
 *   {"id":"…",…}
 *   -->
 *
 * One JSON object per line, so a note is one line in a diff and two people
 * adding notes rarely touch the same line. Lines that are not valid notes
 * are kept as they are when the block is written again.
 */
import { Note, validNote } from './notesStore';

export const NOTES_BLOCK_START = '<!-- folio:notes';
const END = '-->';

const HEADER = [
  `${NOTES_BLOCK_START} v1`,
  'Notes on this document, written with Folio (a Markdown reader for VS Code). Renderers hide this comment.',
  'One JSON object per line. "quote" is the exact text a note is about ("prefix", "suffix" and "line" help find it); "text" is the note.',
  'To answer a note, add {"author": "<your name>", "text": "<answer>"} to its "replies". To close it, set "status": "resolved".',
  'Keep each note on one line, leave "id", "quote", "prefix" and "suffix" as they are, and never write "--" followed by ">" in this block.',
];

/** Where the block is in `text` (offsets), when the document ends with one. */
export function findNotesBlock(text: string): { start: number; end: number } | undefined {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed.endsWith(END)) {
    return undefined;
  }
  let start = trimmed.lastIndexOf(NOTES_BLOCK_START);
  // At the start of a line; not the "<!-- folio:notes" of an example in the text.
  while (start > 0 && text[start - 1] !== '\n') {
    start = trimmed.lastIndexOf(NOTES_BLOCK_START, start - 1);
  }
  if (start < 0) {
    return undefined;
  }
  return { start, end: trimmed.length };
}

export interface NotesBlock {
  notes: Note[];
  /** Lines that looked like notes but are not valid ones: kept, not lost. */
  extra: string[];
}

/** The notes stored at the end of `text` (none without a block). */
export function parseNotesBlock(text: string): NotesBlock {
  const block = findNotesBlock(text);
  if (!block) {
    return { notes: [], extra: [] };
  }
  const body = text.slice(block.start + NOTES_BLOCK_START.length, block.end - END.length);
  const notes: Note[] = [];
  const extra: string[] = [];
  const ids = new Set<string>();
  for (const raw of body.split(/\r?\n/).slice(1)) {
    const line = raw.trim();
    if (!line.startsWith('{')) {
      continue; // the instructions, or blank lines
    }
    let note: Note | undefined;
    try {
      note = validNote(JSON.parse(line), true);
    } catch {
      note = undefined;
    }
    if (note && !ids.has(note.id)) {
      ids.add(note.id);
      notes.push(note);
    } else {
      extra.push(line);
    }
  }
  return { notes, extra };
}

/** One note as a line of the block. */
export function noteLine(note: Note): string {
  // Readable order: what the note is about and says first, anchoring last.
  const ordered = {
    id: note.id,
    ...(note.author && { author: note.author }),
    ...(note.status && { status: note.status }),
    quote: note.quote,
    text: note.text,
    ...(note.replies?.length && { replies: note.replies }),
    line: note.line,
    prefix: note.prefix,
    suffix: note.suffix,
    created: note.created,
    updated: note.updated,
  };
  // "-->" would end the HTML comment: escape its ">" (still valid JSON).
  return JSON.stringify(ordered).replace(/--(!?)>/g, '--$1\\u003e');
}

export function formatNotesBlock(block: NotesBlock, eol = '\n'): string {
  return [...HEADER, ...block.notes.map(noteLine), ...block.extra, END].join(eol);
}

/** A change to a text: replace `from`…`to` with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The edit that stores `block` at the end of `text`: the existing block is
 * replaced, a new one is added after a blank line, and the block is removed
 * (with the blank lines before it) when nothing is left in it. Nothing above
 * the block changes, so line numbers stay the same.
 */
export function notesEdit(text: string, block: NotesBlock, eol = '\n'): TextEdit | undefined {
  const existing = findNotesBlock(text);
  const empty = !block.notes.length && !block.extra.length;
  if (!existing) {
    if (empty) {
      return undefined;
    }
    const content = text.replace(/\s+$/, '');
    const insert = `${content ? eol + eol : ''}${formatNotesBlock(block, eol)}${eol}`;
    return { from: content.length, to: text.length, insert };
  }
  if (empty) {
    const content = text.slice(0, existing.start).replace(/\s+$/, '');
    return { from: content.length, to: text.length, insert: content ? eol : '' };
  }
  return { from: existing.start, to: existing.end, insert: formatNotesBlock(block, eol) };
}

export function applyEdit(text: string, edit: TextEdit | undefined): string {
  return edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text;
}

/**
 * `text` without the notes block, for rendering, exports and language
 * detection. The block's lines become empty lines (their line breaks stay),
 * so the source line numbers of everything else do not change.
 */
export function stripNotesBlock(text: string): string {
  const block = findNotesBlock(text);
  if (!block) {
    return text;
  }
  return text.slice(0, block.start) + text.slice(block.start, block.end).replace(/[^\n]+/g, '') + text.slice(block.end);
}
