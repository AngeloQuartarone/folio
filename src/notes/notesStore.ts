/*
 * Notes on a document: the note model, its validation, the changes the
 * preview asks for, and the file next to the document (`<file>.folio.json`,
 * the "sidecar" storage, and where notes lived before they could be kept in
 * the document itself, see notesBlock.ts).
 * No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * A note is anchored to the text it was written on: the quoted text, a
 * little of what comes before and after it (to tell repeated quotes apart)
 * and the source line of its block (a hint, the text may have moved).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/** An answer to a note, by a person or an AI. */
export interface Reply {
  author: string;
  text: string;
  created: string;
}

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
  author?: string;
  /** Absent while the note is open. */
  status?: 'resolved';
  replies?: Reply[];
}

/** What the preview (or a command) asks to do with the notes. */
export type NoteChange =
  | { action: 'add'; note: Note }
  | { action: 'edit'; id: string; text: string }
  | { action: 'delete'; id: string }
  | { action: 'reply'; id: string; reply: Reply }
  | { action: 'resolve'; id: string }
  | { action: 'reopen'; id: string };

export const NOTE_LIMITS = { quote: 1000, context: 64, text: 5000, author: 100, replies: 100 };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export function notesPath(documentPath: string): string {
  return `${documentPath}.folio.json`;
}

const isText = (text: unknown, max: number): text is string => typeof text === 'string' && text.length <= max;

function validReply(value: unknown, now: string): Reply | undefined {
  const reply = value as Partial<Reply> | null;
  if (!reply || typeof reply !== 'object' || !isText(reply.text, NOTE_LIMITS.text) || !reply.text.trim()) {
    return undefined;
  }
  return {
    author: isText(reply.author, NOTE_LIMITS.author) && reply.author.trim() ? reply.author.trim() : 'Unknown',
    text: reply.text,
    created: typeof reply.created === 'string' ? reply.created : now,
  };
}

/**
 * `value` as a note if it is a well-formed one, else undefined. `lenient`
 * is for notes read from a document, which people and AIs edit by hand: a
 * note added there may have no context, line or dates.
 */
export function validNote(value: unknown, lenient = false): Note | undefined {
  const note = value as Partial<Note> | null;
  if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !ID.test(note.id)) {
    return undefined;
  }
  const context = (text: unknown) => (lenient && text === undefined ? '' : text);
  const prefix = context(note.prefix);
  const suffix = context(note.suffix);
  const line = lenient && note.line === undefined ? 1 : note.line;
  if (
    !isText(note.quote, NOTE_LIMITS.quote) ||
    !note.quote.trim() ||
    !isText(prefix, NOTE_LIMITS.context) ||
    !isText(suffix, NOTE_LIMITS.context) ||
    !isText(note.text, NOTE_LIMITS.text) ||
    !Number.isInteger(line) ||
    (line as number) < 1
  ) {
    return undefined;
  }
  const now = new Date().toISOString();
  const result: Note = {
    id: note.id,
    quote: note.quote,
    prefix,
    suffix,
    line: line as number,
    text: note.text,
    created: typeof note.created === 'string' ? note.created : now,
    updated: typeof note.updated === 'string' ? note.updated : typeof note.created === 'string' ? note.created : now,
  };
  if (isText(note.author, NOTE_LIMITS.author) && note.author.trim()) {
    result.author = note.author.trim();
  }
  if (note.status === 'resolved') {
    result.status = 'resolved';
  }
  if (Array.isArray(note.replies)) {
    const replies = note.replies
      .slice(0, NOTE_LIMITS.replies)
      .map((reply) => validReply(reply, now))
      .filter((reply): reply is Reply => !!reply);
    if (replies.length) {
      result.replies = replies;
    }
  }
  return result;
}

/** The notes of a document; none when the file is missing or unreadable. */
export function readNotes(documentPath: string): Note[] {
  const path = notesPath(documentPath);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { notes?: unknown[] };
    return (data.notes ?? []).map((note) => validNote(note)).filter((note): note is Note => !!note);
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

/** Apply a change to the notes of a document (unknown ids change nothing). */
export function changeNotes(notes: Note[], change: NoteChange, now = new Date().toISOString()): Note[] {
  if (change.action === 'add') {
    const others = notes.filter((existing) => existing.id !== change.note.id);
    return [...others, { ...change.note, created: now, updated: now }].sort((a, b) => a.line - b.line);
  }
  if (change.action === 'delete') {
    return notes.filter((existing) => existing.id !== change.id);
  }
  return notes.map((note) => {
    if (note.id !== change.id) {
      return note;
    }
    switch (change.action) {
      case 'edit':
        return { ...note, text: change.text, updated: now };
      case 'reply':
        return { ...note, replies: [...(note.replies ?? []), change.reply], updated: now };
      case 'resolve':
        return { ...note, status: 'resolved' as const, updated: now };
      case 'reopen': {
        const { status: _status, ...open } = note;
        return { ...open, updated: now };
      }
    }
  });
}

/** Notes from two places, without duplicates (`first` wins). */
export function mergeNotes(first: Note[], second: Note[]): Note[] {
  const ids = new Set(first.map((note) => note.id));
  return [...first, ...second.filter((note) => !ids.has(note.id))].sort((a, b) => a.line - b.line);
}
