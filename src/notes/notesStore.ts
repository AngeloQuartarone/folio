/*
 * Notes on a document, kept next to it in `<file>.folio.json`.
 * No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * A note is anchored to the text it was written on: the quoted text, a
 * little of what comes before and after it (to tell repeated quotes apart)
 * and the source line of its block (a hint, the text may have moved).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export interface Note {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  /** 1-based source line of the block the quote was in. */
  line: number;
  text: string;
  created: string;
  updated: string;
}

const LIMITS = { quote: 1000, context: 64, text: 5000 };

export function notesPath(documentPath: string): string {
  return `${documentPath}.folio.json`;
}

/** `value` as a note if it is a well-formed one, else undefined. */
export function validNote(value: unknown): Note | undefined {
  const note = value as Partial<Note> | null;
  const isText = (text: unknown, max: number): text is string => typeof text === 'string' && text.length <= max;
  if (
    !note ||
    typeof note !== 'object' ||
    typeof note.id !== 'string' ||
    !/^[a-z0-9-]{1,40}$/.test(note.id) ||
    !isText(note.quote, LIMITS.quote) ||
    !note.quote.trim() ||
    !isText(note.prefix, LIMITS.context) ||
    !isText(note.suffix, LIMITS.context) ||
    !isText(note.text, LIMITS.text) ||
    !Number.isInteger(note.line) ||
    (note.line as number) < 1
  ) {
    return undefined;
  }
  const now = new Date().toISOString();
  return {
    id: note.id,
    quote: note.quote,
    prefix: note.prefix,
    suffix: note.suffix,
    line: note.line as number,
    text: note.text,
    created: typeof note.created === 'string' ? note.created : now,
    updated: typeof note.updated === 'string' ? note.updated : now,
  };
}

/** The notes of a document; none when the file is missing or unreadable. */
export function readNotes(documentPath: string): Note[] {
  const path = notesPath(documentPath);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { notes?: unknown[] };
    return (data.notes ?? []).map(validNote).filter((note): note is Note => !!note);
  } catch {
    return [];
  }
}

/** Save the notes; the file is removed when there are none left. */
export function writeNotes(documentPath: string, notes: Note[]): void {
  const path = notesPath(documentPath);
  if (!notes.length) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, `${JSON.stringify({ version: 1, notes }, null, 2)}\n`);
}

/** Apply an add, update or delete to the notes of a document. */
export function changeNotes(
  notes: Note[],
  action: 'add' | 'update' | 'delete',
  note: Note,
): Note[] {
  const others = notes.filter((existing) => existing.id !== note.id);
  if (action === 'delete') {
    return others;
  }
  const previous = notes.find((existing) => existing.id === note.id);
  const saved: Note = {
    ...note,
    created: previous?.created ?? note.created,
    updated: new Date().toISOString(),
  };
  return action === 'add' || previous ? [...others, saved].sort((a, b) => a.line - b.line) : notes;
}
