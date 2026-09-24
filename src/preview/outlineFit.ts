/*
 * Room for the table of contents: when it opens in a preview too narrow to
 * show it beside the text, the preview's editor group is widened, taking
 * room from the editors beside it (folio.reading.outlineFit).
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * VS Code has no API to resize one editor group, but its layout commands
 * read and apply the whole editor layout with pixel sizes: the same layout
 * is applied again with the preview's group wider.
 */
import * as vscode from 'vscode';
import { getOutlineFit } from '../config';
import type { WebviewMessage } from '../messages';
import { EditorLayout, countGroups, sameLayout, widenGroup } from './editorLayout';
import type { PreviewManager } from './previewManager';

/** Editors beside the preview keep at least this width (VS Code's own minimum is 220). */
export const NEIGHBOUR_MIN = 260;

type FitRequest = Extract<WebviewMessage, { type: 'fitOutline' }>;

const getLayout = () => vscode.commands.executeCommand<EditorLayout | undefined>('vscode.getEditorLayout');
const setLayout = (layout: EditorLayout) => vscode.commands.executeCommand('vscode.setEditorLayout', layout);

export class OutlineFit {
  /** The preview panel that was widened already ("once"). */
  private fitted: vscode.WebviewPanel | undefined;
  /** "always": the layout to go back to when the table of contents closes. */
  private undo: { panel: vscode.WebviewPanel; before: EditorLayout; after: EditorLayout } | undefined;
  /** Requests are handled one after the other: each reads the layout the last one left. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(preview: PreviewManager) {
    preview.onDidReceiveMessage((message, panel) => {
      if (message.type === 'fitOutline') {
        this.enqueue(() => this.widen(panel, message));
      } else if (message.type === 'outlineClosed') {
        this.enqueue(() => this.restore(panel));
      }
    });
  }

  private enqueue(task: () => Promise<void>): void {
    // A layout that cannot be read or applied leaves the preview as it is.
    this.queue = this.queue.then(task).catch(() => undefined);
  }

  private async widen(panel: vscode.WebviewPanel, request: FitRequest): Promise<void> {
    const mode = getOutlineFit();
    const { width, wanted, needed } = request;
    const valid = [width, wanted, needed].every((value) => Number.isFinite(value) && value > 0 && value < 100_000);
    if (mode === 'never' || (mode === 'once' && this.fitted === panel) || !valid || !panel.viewColumn) {
      return;
    }
    const before = await getLayout();
    // Another window's groups would not be in this layout: then leave it alone.
    if (!before || countGroups(before) !== vscode.window.tabGroups.all.length) {
      return;
    }
    const wider = widenGroup(before, panel.viewColumn - 1, {
      width,
      by: wanted - width,
      atLeast: needed - width,
      neighbourMin: NEIGHBOUR_MIN,
    });
    if (!wider) {
      return;
    }
    await setLayout(wider);
    this.fitted = panel;
    const after = mode === 'always' ? await getLayout() : undefined;
    this.undo = after ? { panel, before, after } : undefined;
  }

  /** "always": give the room back, unless the layout changed since it was widened. */
  private async restore(panel: vscode.WebviewPanel): Promise<void> {
    const undo = this.undo;
    this.undo = undefined;
    if (!undo || undo.panel !== panel || getOutlineFit() !== 'always') {
      return;
    }
    const current = await getLayout();
    if (current && sameLayout(current, undo.after)) {
      await setLayout(undo.before);
    }
  }
}
