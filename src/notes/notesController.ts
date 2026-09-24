/*
 * Connects the preview's notes to where they are kept: a comment at the end
 * of the Markdown file (notesBlock.ts, the default) or a file next to it
 * (notesStore.ts). Also "Copy Notes for AI".
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * Notes in the document are written with a WorkspaceEdit, like any other
 * edit: undo works, and unsaved changes to the document are kept. When the
 * document had no unsaved changes it is saved right away, as notes in the
 * file next to it always were.
 */
import { execFile } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NotesStorage, SECTION, getNotesConfig, getReadingConfig } from '../config';
import { WebviewMessage } from '../messages';
import { PreviewManager } from '../preview/previewManager';
import { notesEdit, parseNotesBlock } from './notesBlock';
import { notesPrompt } from './notesPrompt';
import { NOTE_LIMITS, Note, NoteChange, changeNotes, mergeNotes, notesPath, readNotes, validNote, writeNotes } from './notesStore';

type NoteMessage = Extract<WebviewMessage, { type: 'note' }>;

interface LoadedNotes {
  notes: Note[];
  /** Document storage: notes still only in the old `<file>.folio.json`. */
  pending: Note[];
}

export class NotesController implements vscode.Disposable {
  /** Changes are applied one after the other: each reads what the last wrote. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The notes last sent to the preview, to send only real changes. */
  private sent = '';
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private gitName: Promise<string | undefined> | undefined;
  /** Documents whose notes in `<file>.folio.json` were offered to be moved. */
  private readonly offered = new Set<string>();
  /** Notes deleted from a document while still in its old file next to it. */
  private readonly deleted = new Map<string, Set<string>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly preview: PreviewManager) {
    preview.onDidReceiveMessage((message) => this.onMessage(message));
    this.disposables.push(
      // Someone (or an AI) edited the notes in the document: show them.
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.preview.activeSourceUri?.toString()) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => void this.refresh(), 200);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => this.removeMovedSidecar(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.notes.storage`)) {
          void this.refresh();
        }
      }),
    );
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** Put the notes of the previewed document on the clipboard, as a message for an AI. */
  async copyForAI(uri = this.preview.activeSourceUri): Promise<void> {
    if (!uri) {
      void vscode.window.showInformationMessage('Open a Markdown file first.');
      return;
    }
    const storage = getNotesConfig().storage;
    const { notes } = await this.load(uri, storage);
    if (!notes.length) {
      void vscode.window.showInformationMessage('This document has no notes yet.');
      return;
    }
    const where = uri.scheme === 'file' ? vscode.workspace.asRelativePath(uri, false) : path.basename(uri.path);
    await vscode.env.clipboard.writeText(notesPrompt(notes, { path: where, storage }));
    void vscode.window.setStatusBarMessage('Notes copied — paste them into your AI chat', 3000);
  }

  private onMessage(message: WebviewMessage): void {
    const uri = this.preview.activeSourceUri;
    if (!uri || !getReadingConfig().notes) {
      return;
    }
    if (message.type === 'ready') {
      this.sent = '';
      void this.refresh(true);
    } else if (message.type === 'command' && message.command === 'copyNotesForAI') {
      void this.copyForAI(uri);
    } else if (message.type === 'note' && message.sourceUri === uri.toString()) {
      this.enqueue(() => this.change(uri, message));
    }
  }

  private supports(uri: vscode.Uri, storage: NotesStorage): boolean {
    // A file next to the document needs a document on disk.
    return uri.scheme === 'file' || (storage === 'document' && uri.scheme === 'untitled');
  }

  private async load(uri: vscode.Uri, storage: NotesStorage): Promise<LoadedNotes> {
    const sidecar = uri.scheme === 'file' ? readNotes(uri.fsPath) : [];
    if (storage === 'sidecar') {
      return { notes: sidecar, pending: [] };
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const inDocument = parseNotesBlock(document.getText()).notes;
    const deleted = this.deleted.get(uri.toString());
    const pending = sidecar.filter(
      (note) => !inDocument.some((other) => other.id === note.id) && !deleted?.has(note.id),
    );
    return { notes: mergeNotes(inDocument, pending), pending };
  }

  /** Send the notes to the preview if they changed; on load, offer to move old ones. */
  private async refresh(loading = false): Promise<void> {
    const uri = this.preview.activeSourceUri;
    const storage = getNotesConfig().storage;
    if (!uri || !getReadingConfig().notes || !this.supports(uri, storage)) {
      return;
    }
    try {
      const { notes, pending } = await this.load(uri, storage);
      this.send(uri, notes);
      if (loading && pending.length && !this.offered.has(uri.toString())) {
        this.offered.add(uri.toString());
        void this.offerMove(uri, pending.length);
      }
    } catch {
      // The document could not be read (deleted meanwhile): nothing to show.
    }
  }

  private async offerMove(uri: vscode.Uri, count: number): Promise<void> {
    const name = path.basename(uri.fsPath);
    const choice = await vscode.window.showInformationMessage(
      `${count === 1 ? 'A note' : `${count} notes`} on ${name} ${count === 1 ? 'is' : 'are'} in ${path.basename(notesPath(uri.fsPath))}. Move ${count === 1 ? 'it' : 'them'} into the document, so ${count === 1 ? 'it travels' : 'they travel'} with it?`,
      'Move into Document',
      'Not Now',
    );
    if (choice === 'Move into Document') {
      this.enqueue(async () => {
        const { notes } = await this.load(uri, 'document');
        await this.writeToDocument(uri, notes);
        this.send(uri, notes);
      });
    }
  }

  private async change(uri: vscode.Uri, message: NoteMessage): Promise<void> {
    const storage = getNotesConfig().storage;
    if (!this.supports(uri, storage)) {
      return;
    }
    const change = await this.toChange(uri, message);
    if (!change) {
      return;
    }
    const { notes } = await this.load(uri, storage);
    const next = changeNotes(notes, change);
    if (storage === 'sidecar') {
      writeNotes(uri.fsPath, next);
    } else {
      if (change.action === 'delete') {
        const deleted = this.deleted.get(uri.toString()) ?? new Set<string>();
        this.deleted.set(uri.toString(), deleted.add(change.id));
      }
      await this.writeToDocument(uri, next);
    }
    this.send(uri, next);
  }

  /** The change the preview asked for, checked, with the author and dates added. */
  private async toChange(uri: vscode.Uri, message: NoteMessage): Promise<NoteChange | undefined> {
    const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 40;
    const isText = (text: unknown): text is string => typeof text === 'string' && text.length <= NOTE_LIMITS.text;
    switch (message.action) {
      case 'add': {
        const note = validNote(message.note);
        return note ? { action: 'add', note: { ...note, author: await this.author(uri) } } : undefined;
      }
      case 'edit':
        return isId(message.id) && isText(message.text) ? { action: 'edit', id: message.id, text: message.text } : undefined;
      case 'reply':
        return isId(message.id) && isText(message.text) && message.text.trim()
          ? {
              action: 'reply',
              id: message.id,
              reply: { author: await this.author(uri), text: message.text.trim(), created: new Date().toISOString() },
            }
          : undefined;
      case 'delete':
      case 'resolve':
      case 'reopen':
        return isId(message.id) ? { action: message.action, id: message.id } : undefined;
      default:
        return undefined;
    }
  }

  private async writeToDocument(uri: vscode.Uri, notes: Note[]): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = notesEdit(text, { notes, extra: parseNotesBlock(text).extra }, eol);
    if (!edit) {
      return;
    }
    const wasDirty = document.isDirty;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(uri, new vscode.Range(document.positionAt(edit.from), document.positionAt(edit.to)), edit.insert);
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
      throw new Error('the document cannot be edited');
    }
    if (!wasDirty && !document.isUntitled) {
      await document.save();
    }
  }

  /**
   * Once a document with the notes moved into it is saved, its old file of
   * notes is removed — only if every note in it is now in the document (or
   * was deleted there), so nothing is lost.
   */
  private removeMovedSidecar(document: vscode.TextDocument): void {
    const uri = document.uri;
    if (uri.scheme !== 'file' || getNotesConfig().storage !== 'document') {
      return;
    }
    const sidecar = readNotes(uri.fsPath);
    if (!sidecar.length) {
      return;
    }
    const inDocument = new Set(parseNotesBlock(document.getText()).notes.map((note) => note.id));
    const deleted = this.deleted.get(uri.toString());
    if (sidecar.every((note) => inDocument.has(note.id) || deleted?.has(note.id))) {
      writeNotes(uri.fsPath, []);
      this.deleted.delete(uri.toString());
    }
  }

  /** Name on new notes and replies: the setting, else Git's user.name, else the system user. */
  private async author(uri: vscode.Uri): Promise<string> {
    const configured = getNotesConfig().author;
    if (configured) {
      return configured;
    }
    this.gitName ??= new Promise((resolve) => {
      const cwd = uri.scheme === 'file' ? path.dirname(uri.fsPath) : homedir();
      execFile('git', ['config', 'user.name'], { cwd, timeout: 3000 }, (error, stdout) =>
        resolve(error ? undefined : stdout.trim().slice(0, NOTE_LIMITS.author) || undefined),
      );
    });
    const name = await this.gitName;
    if (name) {
      return name;
    }
    try {
      return userInfo().username || 'Me';
    } catch {
      return 'Me';
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      void vscode.window.showErrorMessage(
        `Could not save the note: ${error instanceof Error ? error.message : String(error)}`,
      );
      void this.refresh();
    });
  }

  private send(uri: vscode.Uri, notes: Note[]): void {
    const key = `${uri.toString()}\n${JSON.stringify(notes)}`;
    if (key === this.sent) {
      return;
    }
    this.sent = key;
    this.preview.postMessage({ type: 'notes', sourceUri: uri.toString(), notes });
  }
}
