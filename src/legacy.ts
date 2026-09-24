/*
 * One-time move from the extension's former name, Markdown Translate
 * Preview: its settings (`markdownTranslate.*`) and the models it
 * downloaded into its own storage folder.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { SECTION } from './config';

const LEGACY_SECTION = 'markdownTranslate';
const LEGACY_NAME = 'markdown-translate-preview';
const DONE_KEY = 'folio.legacyMigrated';

/** Former key → current key (under `folio.`). */
const RENAMED: Record<string, string> = {
  enabled: 'translation.enabled',
  targetLanguage: 'translation.targetLanguage',
  sourceLanguage: 'translation.sourceLanguage',
  modelsPath: 'translation.modelsPath',
  previewTheme: 'previewTheme',
  codeBlockTheme: 'codeBlockTheme',
  previewColorScheme: 'previewColorScheme',
  scrollSync: 'scrollSync',
  liveUpdateDebounceMs: 'liveUpdateDebounceMs',
  breakOnSingleNewLine: 'breakOnSingleNewLine',
  'math.enabled': 'math.enabled',
  'mermaid.enabled': 'mermaid.enabled',
  chromePath: 'chromePath',
  hideBuiltInPreviewButton: 'hideBuiltInPreviewButton',
};

/** Copy the old models synchronously, before anything looks for them. */
export function migrateLegacyModels(context: vscode.ExtensionContext): void {
  if (context.globalState.get(DONE_KEY)) {
    return;
  }
  const publisher = context.extension.id.split('.')[0];
  const current = join(context.globalStorageUri.fsPath, 'models');
  const legacy = join(context.globalStorageUri.fsPath, '..', `${publisher}.${LEGACY_NAME}`, 'models');
  try {
    if (!existsSync(current) && existsSync(legacy)) {
      cpSync(legacy, current, { recursive: true });
    }
  } catch (error) {
    console.error('[folio] could not copy the models of Markdown Translate Preview:', error);
  }
}

/** Carry the user's former settings over (only those not set again since). */
export async function migrateLegacySettings(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(DONE_KEY)) {
    return;
  }
  const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION);
  const config = vscode.workspace.getConfiguration(SECTION);
  for (const [from, to] of Object.entries(RENAMED)) {
    const value = legacy.inspect(from)?.globalValue;
    if (value !== undefined && config.inspect(to)?.globalValue === undefined) {
      try {
        await config.update(to, value, vscode.ConfigurationTarget.Global);
      } catch {
        // An invalid old value: keep the default.
      }
    }
  }
  await context.globalState.update(DONE_KEY, true);
}
