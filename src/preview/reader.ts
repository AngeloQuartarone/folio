/*
 * Folio Reader: Markdown files opened as the reading view in their own tab,
 * without the text editor ("Open With… › Folio Reader", or for every
 * Markdown file with folio.openInReader). The tab is the Folio preview.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import * as vscode from 'vscode';
import { SECTION } from '../config';
import type { PreviewManager } from './previewManager';

export const READER_VIEW_TYPE = 'folio.reader';
const PATTERNS = ['*.md', '*.markdown'];

export function registerReader(preview: PreviewManager): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.window.registerCustomEditorProvider(
      READER_VIEW_TYPE,
      {
        resolveCustomTextEditor: (document, panel) => preview.adopt(panel, document.uri),
      },
      {
        webviewOptions: { enableFindWidget: true, retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.openInReader`)) {
        void syncEditorAssociations();
      }
    }),
  );
}

/**
 * folio.openInReader is carried out with VS Code's own editor associations
 * (workbench.editorAssociations): on, Markdown files open in the reader;
 * off, the association is removed again if it is still Folio's.
 */
export async function syncEditorAssociations(): Promise<void> {
  const on = vscode.workspace.getConfiguration(SECTION).get<boolean>('openInReader', false);
  const workbench = vscode.workspace.getConfiguration('workbench');
  const current = { ...workbench.get<Record<string, string>>('editorAssociations') };
  let changed = false;
  for (const pattern of PATTERNS) {
    if (on && current[pattern] !== READER_VIEW_TYPE) {
      current[pattern] = READER_VIEW_TYPE;
      changed = true;
    } else if (!on && current[pattern] === READER_VIEW_TYPE) {
      delete current[pattern];
      changed = true;
    }
  }
  if (changed) {
    await workbench.update('editorAssociations', current, vscode.ConfigurationTarget.Global);
  }
}
