/*
 * Markdown Translate Preview — entry point.
 * Copyright (c) 2026 Angelo Quartarone.
 * Based on Markdown Preview Enhanced by Yiyi Wang (University of
 * Illinois/NCSA License). See LICENSE.md and UPSTREAM.md.
 */
import * as vscode from 'vscode';
import { SECTION } from './config';
import { exportDocument } from './export/exportCommands';
import { PreviewManager, isMarkdownDocument } from './preview/previewManager';
import { CODE_BLOCK_THEMES, PREVIEW_THEMES } from './themes';

export interface ExtensionApi {
  preview: PreviewManager;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const preview = new PreviewManager(context.extensionUri);
  context.subscriptions.push(preview);

  const command = (id: string, callback: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(`${SECTION}.${id}`, callback));

  command('openPreviewToTheSide', (uri?: vscode.Uri) => {
    const target = markdownUri(uri);
    if (target) {
      preview.show(target, vscode.ViewColumn.Beside, true);
    }
  });

  command('openPreview', (uri?: vscode.Uri) => {
    const target = markdownUri(uri);
    if (target) {
      preview.show(target, vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One, false);
    }
  });

  command('syncPreview', () => preview.syncToEditor());

  command('toggleScrollSync', async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    const value = !config.get<boolean>('scrollSync', true);
    await config.update('scrollSync', value, vscode.ConfigurationTarget.Global);
    void vscode.window.setStatusBarMessage(`Scroll sync ${value ? 'on' : 'off'}`, 2000);
  });

  command('selectPreviewTheme', () =>
    pickSetting('previewTheme', PREVIEW_THEMES, 'Preview theme'),
  );

  command('selectCodeBlockTheme', () =>
    pickSetting('codeBlockTheme', CODE_BLOCK_THEMES, 'Code block theme'),
  );

  command('exportPdf', (uri?: vscode.Uri) =>
    exportDocument(context, markdownUri(uri, preview.activeSourceUri), 'pdf'),
  );

  command('exportHtml', (uri?: vscode.Uri) =>
    exportDocument(context, markdownUri(uri, preview.activeSourceUri), 'html'),
  );

  return { preview };
}

export function deactivate(): void {
  // Disposables are released through context.subscriptions.
}

/**
 * The Markdown file a command applies to: the explicit argument (explorer
 * or editor title menus), else the active editor, else `fallback`.
 */
function markdownUri(uri?: vscode.Uri, fallback?: vscode.Uri): vscode.Uri | undefined {
  if (uri instanceof vscode.Uri) {
    return uri;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && isMarkdownDocument(editor.document)) {
    return editor.document.uri;
  }
  if (fallback) {
    return fallback;
  }
  void vscode.window.showInformationMessage('Open a Markdown file first.');
  return undefined;
}

async function pickSetting(key: string, values: readonly string[], title: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const current = config.get<string>(key);
  const items = values.map((value) => ({
    label: value.replace(/\.css$/, ''),
    description: value === current ? 'current' : undefined,
    value,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: current?.replace(/\.css$/, ''),
  });
  if (picked) {
    await config.update(key, picked.value, vscode.ConfigurationTarget.Global);
  }
}
