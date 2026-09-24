/*
 * Connects the preview's notes to their file next to the document.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import * as vscode from 'vscode';
import { getReadingConfig } from '../config';
import { WebviewMessage } from '../messages';
import { PreviewManager } from '../preview/previewManager';
import { Note, changeNotes, readNotes, validNote, writeNotes } from './notesStore';

export class NotesController {
  constructor(private readonly preview: PreviewManager) {
    preview.onDidReceiveMessage((message) => this.onMessage(message));
  }

  private onMessage(message: WebviewMessage): void {
    const uri = this.preview.activeSourceUri;
    // Notes need a file to sit next to (not an untitled document).
    if (!uri || uri.scheme !== 'file' || !getReadingConfig().notes) {
      return;
    }
    if (message.type === 'ready') {
      this.send(uri, readNotes(uri.fsPath));
      return;
    }
    if (message.type !== 'note' || message.sourceUri !== uri.toString()) {
      return;
    }
    const note = validNote(message.note);
    if (!note || !['add', 'update', 'delete'].includes(message.action)) {
      return;
    }
    try {
      const notes = changeNotes(readNotes(uri.fsPath), message.action, note);
      writeNotes(uri.fsPath, notes);
      this.send(uri, notes);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not save the note: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private send(uri: vscode.Uri, notes: Note[]): void {
    this.preview.postMessage({ type: 'notes', sourceUri: uri.toString(), notes });
  }
}
