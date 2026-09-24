/*
 * HTML shell of the preview webview.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { WebviewSettings } from '../messages';
import { CodeBlockTheme, ColorScheme, PreviewTheme } from '../themes';

export interface PageOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** Directory of the Markdown file: relative URLs resolve against it. */
  documentDir: vscode.Uri;
  previewTheme: PreviewTheme;
  codeBlockTheme: CodeBlockTheme;
  colorScheme: ColorScheme;
  settings: Omit<WebviewSettings, 'mermaidScriptUri'>;
}

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Build the webview document. The Markdown itself arrives later through
 * an `update` message and is sanitized inside the webview.
 *
 * CSP: scripts only with the per-load nonce; no network access other than
 * images. Inline styles are allowed because KaTeX and Mermaid emit them.
 */
export function buildPreviewPage(options: PageOptions): string {
  const { webview, extensionUri } = options;
  const nonce = createNonce();
  const asset = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...segments)).toString();
  const base = webview.asWebviewUri(options.documentDir).toString().replace(/\/?$/, '/');

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: http: data: blob:`,
    `media-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    `base-uri ${webview.cspSource}`,
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ');

  const reading = options.settings.reading;
  const settings: WebviewSettings = {
    ...options.settings,
    mermaidScriptUri: asset('mermaid', 'mermaid.min.js'),
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<base href="${escapeAttribute(base)}">
<meta id="preview-settings" data-settings="${escapeAttribute(JSON.stringify(settings))}">
<link rel="stylesheet" href="${asset('katex', 'katex.min.css')}">
<link rel="stylesheet" href="${asset('styles', 'preview_theme', options.previewTheme)}">
<link rel="stylesheet" href="${asset('styles', 'prism_theme', options.codeBlockTheme)}">
<link rel="stylesheet" href="${asset('styles', 'style-template.css')}">
<link rel="stylesheet" href="${asset('styles', 'preview.css')}">
</head>
<body class="preview-container" data-color-scheme="${options.colorScheme}" data-preview-theme="${options.previewTheme.replace(/\.css$/, '')}" data-reading-font="${reading.font}" data-line-height="${reading.lineHeight}" data-width="${reading.width}"${reading.justify ? ' data-justify' : ''}${reading.focusMode ? ` data-focus-mode data-focus-scope="${reading.focusScope}"` : ''} style="--folio-font-size: ${reading.fontSize}px">
<div class="crossnote markdown-preview" data-for="preview" id="preview"></div>
<script nonce="${nonce}" src="${asset('webview', 'preview.js')}"></script>
</body>
</html>`;
}

export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
