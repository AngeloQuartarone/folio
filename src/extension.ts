/*
 * Folio — entry point.
 * Copyright (c) 2026 Angelo Quartarone.
 * Based on Markdown Preview Enhanced by Yiyi Wang (University of
 * Illinois/NCSA License). See LICENSE.md and UPSTREAM.md.
 */
import * as vscode from 'vscode';
import { SECTION } from './config';
import { exportDocument } from './export/exportCommands';
import { migrateLegacyModels, migrateLegacySettings } from './legacy';
import { NotesController } from './notes/notesController';
import { OutlineFit } from './preview/outlineFit';
import { PreviewManager, isMarkdownDocument } from './preview/previewManager';
import { WebviewMessage } from './messages';
import { isKnownSetting, pathSetting, validSetting } from './settingsView';
import { CODE_BLOCK_THEMES, PREVIEW_THEMES, PREVIEW_THEME_LABELS } from './themes';
import { languageName } from './translation/languages';
import { SUPPORTED_LANGUAGES } from './translation/offline/registry';
import { TranslationController } from './translation/translationController';

export interface ExtensionApi {
  preview: PreviewManager;
  translation: TranslationController;
  notes: NotesController;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  migrateLegacyModels(context);
  void migrateLegacySettings(context);
  const preview = new PreviewManager(context.extensionUri, context.workspaceState);
  const translation = new TranslationController(context, preview);
  const notes = new NotesController(preview);
  new OutlineFit(preview);
  context.subscriptions.push(preview, translation, notes);

  // VS Code's built-in Markdown extension hides its own preview buttons
  // (editor title, explorer and tab context menus) when this is set.
  const updateBuiltInPreviewButtons = () =>
    vscode.commands.executeCommand(
      'setContext',
      'hasCustomMarkdownPreview',
      vscode.workspace.getConfiguration(SECTION).get<boolean>('hideBuiltInPreviewButton', true),
    );
  void updateBuiltInPreviewButtons();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.hideBuiltInPreviewButton`)) {
        void updateBuiltInPreviewButtons();
      }
    }),
  );

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
    pickSetting('previewTheme', PREVIEW_THEMES, 'Preview theme', PREVIEW_THEME_LABELS),
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

  command('manageOfflineLanguages', () => translation.manageLanguages());

  // Translate the whole document in the preview (again: show the original only).
  command('translateDocument', async (uri?: vscode.Uri) => {
    if (!preview.webviewPanel) {
      const target = markdownUri(uri);
      if (!target) {
        return;
      }
      const ready = new Promise<void>((resolve) =>
        preview.onDidReceiveMessage((message) => message.type === 'ready' && resolve()),
      );
      preview.show(target, vscode.ViewColumn.Beside, true);
      await ready;
    }
    preview.postMessage({ type: 'toggleDocumentTranslation' });
  });

  command('copyNotesForAI', (uri?: vscode.Uri) => notes.copyForAI(markdownUri(uri, preview.activeSourceUri)));

  command('toggleTranslation', async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    const value = !config.get<boolean>('translation.enabled', true);
    await config.update('translation.enabled', value, vscode.ConfigurationTarget.Global);
    void vscode.window.setStatusBarMessage(`Translation tooltips ${value ? 'on' : 'off'}`, 2000);
  });

  command('setTargetLanguage', async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    const current = config.get<string>('translation.targetLanguage', 'it');
    const picked = await vscode.window.showQuickPick(
      SUPPORTED_LANGUAGES.map((code) => ({
        label: languageName(code),
        description: code === current ? `${code} (current)` : code,
        code,
      })),
      { title: 'Translate into' },
    );
    if (picked) {
      await config.update('translation.targetLanguage', picked.code, vscode.ConfigurationTarget.Global);
    }
  });

  preview.onDidReceiveMessage((message) => void onSettingsMessage(message, context.extension.id));

  return { preview, translation, notes };
}

/**
 * Settings requests from the preview. Values are checked against the
 * settings description; paths are only chosen with VS Code's dialog.
 */
async function onSettingsMessage(message: WebviewMessage, extensionId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const target = vscode.ConfigurationTarget.Global;
  switch (message.type) {
    case 'setSetting': {
      const value = validSetting(message.key, message.value);
      if (value !== undefined) {
        await config.update(message.key, value, target);
      }
      break;
    }
    case 'resetSetting':
      if (isKnownSetting(message.key)) {
        await config.update(message.key, undefined, target);
      }
      break;
    case 'choosePath': {
      const path = pathSetting(message.key);
      if (!path) {
        break;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: path.folder,
        canSelectFiles: !path.folder,
        canSelectMany: false,
        openLabel: 'Select',
      });
      if (picked?.[0]) {
        await config.update(message.key, picked[0].fsPath, target);
      }
      break;
    }
    case 'command':
      switch (message.command) {
        case 'exportPdf':
        case 'exportHtml':
        case 'manageOfflineLanguages':
          await vscode.commands.executeCommand(`${SECTION}.${message.command}`);
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`);
          break;
      }
      break;
  }
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

async function pickSetting(
  key: string,
  values: readonly string[],
  title: string,
  labels: Record<string, string> = {},
): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const current = config.get<string>(key);
  const label = (value: string) => labels[value] ?? value.replace(/\.css$/, '');
  const items = values.map((value) => ({
    label: label(value),
    description: value === current ? 'current' : undefined,
    value,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: current && label(current),
  });
  if (picked) {
    await config.update(key, picked.value, vscode.ConfigurationTarget.Global);
  }
}
