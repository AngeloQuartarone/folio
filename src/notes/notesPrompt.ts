/*
 * "Copy notes for AI": the notes of a document as a message to paste into a
 * chat with an AI assistant. No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { Note } from './notesStore';

export interface PromptOptions {
  /** The document's path as the AI will know it (relative to the workspace). */
  path: string;
  /** Where the notes are stored, which tells the AI how to answer them. */
  storage: 'document' | 'sidecar';
}

const quote = (text: string) => `"${text.replace(/\s+/g, ' ').trim()}"`;
/** Later lines of a multi-line text, indented under the first. */
const indent = (text: string) => text.trim().replace(/\r?\n/g, '\n   ');

export function notesPrompt(notes: Note[], options: PromptOptions): string {
  const open = notes.filter((note) => note.status !== 'resolved');
  const resolved = notes.length - open.length;
  const lines: string[] = [
    `I left notes in ${options.path}. Each note quotes the text it is about.`,
    'Please go through them: where a note asks for a change, make it in the document; otherwise answer it or tell me what you think.',
  ];
  if (options.storage === 'document') {
    lines.push(
      'The notes are also stored at the end of the file, in a "<!-- folio:notes" comment. To answer a note there, add a reply to it; to close it, set "status": "resolved" (the comment explains the format).',
    );
  }
  lines.push('');
  open.forEach((note, index) => {
    lines.push(`${index + 1}. On ${quote(note.quote)} (around line ${note.line})`);
    lines.push(`   Note${note.author ? ` from ${note.author}` : ''}: ${indent(note.text) || '(no text)'}`);
    for (const reply of note.replies ?? []) {
      lines.push(`   Reply from ${reply.author}: ${indent(reply.text)}`);
    }
  });
  if (!open.length) {
    lines.push('(All notes are resolved.)');
  }
  if (resolved) {
    lines.push('', `${resolved} resolved note${resolved === 1 ? ' is' : 's are'} not listed.`);
  }
  return lines.join('\n');
}
