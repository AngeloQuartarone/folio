/*
 * The user's own stylesheet (folio.customCss), added after Folio's styles in
 * the preview and in exports.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** A path from a setting: absolute, `~/…`, or relative to the first workspace folder. */
export function resolveUserPath(value: string): vscode.Uri | undefined {
  if (!value) {
    return undefined;
  }
  if (value === '~' || value.startsWith('~/')) {
    return vscode.Uri.file(path.join(homedir(), value.slice(1)));
  }
  if (path.isAbsolute(value)) {
    return vscode.Uri.file(value);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, value) : undefined;
}

/** The stylesheet's text, ready to go inside a <style> element ('' when there is none). */
export function readUserCss(setting: string): string {
  const uri = resolveUserPath(setting);
  if (!uri) {
    return '';
  }
  try {
    return readFileSync(uri.fsPath, 'utf8').replace(/<\/style/gi, '<\\/style');
  } catch {
    return '';
  }
}
