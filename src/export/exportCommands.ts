/*
 * "Export HTML" and "Export PDF" commands.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { mkdtempSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SECTION, editorColorScheme, getPreviewConfig } from '../config';
import { createRenderer } from '../preview/previewManager';
import {
  colorSchemeOfTheme,
  resolveCodeBlockTheme,
  resolvePreviewTheme,
  themesForExport,
} from '../themes';
import { findChrome, printToPdf } from './chrome';
import { buildStandaloneHtml } from './standaloneHtml';

/** Injected by scripts/build.mjs from node_modules/mermaid/package.json. */
declare const MERMAID_VERSION: string;

export type ExportTarget = 'html' | 'pdf';

export async function exportDocument(
  context: vscode.ExtensionContext,
  uri: vscode.Uri | undefined,
  target: ExportTarget,
): Promise<vscode.Uri | undefined> {
  if (!uri || uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Open a Markdown file saved on disk to export it.');
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const config = getPreviewConfig();

  // Exports are meant for paper and sharing: when the theme follows the
  // editor/system, paired themes use their light variant. A theme chosen
  // explicitly (selectedPreviewTheme, or an unpaired one like monokai) is kept.
  const editorScheme = editorColorScheme();
  const resolved = resolvePreviewTheme(config.previewTheme, config.previewColorScheme, 'light', 'light');
  const themes = themesForExport(resolved, resolveCodeBlockTheme(config.codeBlockTheme, resolved));
  const colorScheme = colorSchemeOfTheme(themes.previewTheme, editorScheme);

  const sourcePath = uri.fsPath;
  const baseDir = path.dirname(sourcePath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const rendered = createRenderer(config).render(document.getText(), {
    resolveImageSrc: (src) => {
      if (workspaceFolder && src.startsWith('/') && !src.startsWith('//')) {
        const absolute = path.join(workspaceFolder.uri.fsPath, src);
        return target === 'pdf'
          ? vscode.Uri.file(absolute).toString()
          : path.relative(baseDir, absolute).split(path.sep).join('/');
      }
      return src;
    },
  });

  const html = buildStandaloneHtml({
    distDir: vscode.Uri.joinPath(context.extensionUri, 'dist').fsPath,
    title: path.basename(sourcePath),
    rendered,
    ...themes,
    colorScheme,
    target,
    baseDir,
    mermaidVersion: MERMAID_VERSION,
  });

  const output = sourcePath.replace(/\.[^./\\]+$/, '') + (target === 'pdf' ? '.pdf' : '.html');

  if (target === 'html') {
    writeFileSync(output, html, 'utf8');
  } else {
    const chrome = findChrome(config.chromePath);
    if (!chrome) {
      const action = await vscode.window.showErrorMessage(
        'PDF export needs Google Chrome, Chromium, Microsoft Edge or Brave. ' +
          'Install one or set "markdownTranslate.chromePath".',
        'Open Settings',
      );
      if (action) {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `${SECTION}.chromePath`,
        );
      }
      return undefined;
    }
    const work = mkdtempSync(path.join(tmpdir(), 'mtp-export-'));
    try {
      const htmlPath = path.join(work, 'document.html');
      const pdfPath = path.join(work, 'document.pdf');
      writeFileSync(htmlPath, html, 'utf8');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Exporting PDF…' },
        () => printToPdf(chrome, htmlPath, pdfPath, rendered.hasMermaid ? 10_000 : 3_000),
      );
      moveFile(pdfPath, output);
    } catch (error) {
      void vscode.window.showErrorMessage(`PDF export failed: ${(error as Error).message}`);
      return undefined;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const outputUri = vscode.Uri.file(output);
  void vscode.window
    .showInformationMessage(`Exported ${path.basename(output)}`, 'Open', 'Reveal in Folder')
    .then((action) => {
      if (action === 'Open') {
        void vscode.env.openExternal(outputUri);
      } else if (action === 'Reveal in Folder') {
        void vscode.commands.executeCommand('revealFileInOS', outputUri);
      }
    });
  return outputUri;
}

/** rename(2) fails across devices (tmp is often another volume). */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}
