/*
 * Standalone HTML documents for "Export HTML" and "Export PDF".
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * This module must not import `vscode`: it is shared with the unit tests.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RenderResult } from '../render/markdownRenderer';
import { CodeBlockTheme, ColorScheme, PreviewTheme } from '../themes';

export interface StandaloneOptions {
  /** Absolute path of the extension's `dist/` directory. */
  distDir: string;
  title: string;
  rendered: RenderResult;
  previewTheme: PreviewTheme;
  codeBlockTheme: CodeBlockTheme;
  colorScheme: ColorScheme;
  /**
   * `html`: a portable file saved next to the Markdown (relative URLs keep
   * working, Mermaid comes from a CDN).
   * `pdf`: a temporary file printed by Chrome (relative URLs resolve against
   * `baseDir`, Mermaid is loaded from the extension).
   */
  target: 'html' | 'pdf';
  /** Directory of the Markdown file; used as `<base>` for PDF export. */
  baseDir: string;
  mermaidVersion: string;
}

export function buildStandaloneHtml(options: StandaloneOptions): string {
  const { distDir, rendered } = options;
  const nonce = randomBytes(16).toString('base64');
  const read = (...segments: string[]) => readFileSync(join(distDir, ...segments), 'utf8');

  const styles = [
    read('styles', 'preview_theme', options.previewTheme),
    read('styles', 'prism_theme', options.codeBlockTheme),
    read('styles', 'style-template.css'),
    read('styles', 'preview.css'),
    options.target === 'pdf' ? PDF_CSS : HTML_CSS,
  ];
  if (rendered.hasMath) {
    styles.unshift(inlineKatexFonts(read('katex', 'katex.min.css'), join(distDir, 'katex')));
  }

  let scripts = '';
  if (rendered.hasMermaid) {
    const mermaidSrc =
      options.target === 'pdf'
        ? pathToFileURL(join(distDir, 'mermaid', 'mermaid.min.js')).toString()
        : `https://cdn.jsdelivr.net/npm/mermaid@${options.mermaidVersion}/dist/mermaid.min.js`;
    scripts = `<script nonce="${nonce}" src="${mermaidSrc}"></script>
<script nonce="${nonce}">
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${JSON.stringify(
      options.colorScheme === 'dark' ? 'dark' : 'default',
    )} });
mermaid.run({ querySelector: '.mermaid', suppressErrors: true });
</script>`;
  }

  // Raw HTML in the Markdown is kept, but no script of the document runs:
  // only nonce-tagged scripts are allowed.
  const csp = [
    "default-src 'none'",
    'img-src * data: blob: file:',
    "style-src 'unsafe-inline'",
    'font-src data:',
    `script-src 'nonce-${nonce}'`,
    "base-uri 'self' file:",
    "form-action 'none'",
  ].join('; ');

  const base =
    options.target === 'pdf'
      ? `<base href="${escapeAttribute(pathToFileURL(options.baseDir + '/').toString())}">\n`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${base}<title>${escapeHtmlText(options.title)}</title>
<style>
${styles.join('\n')}
</style>
</head>
<body class="preview-container" for="html-export" data-color-scheme="${options.colorScheme}">
<div class="crossnote markdown-preview" data-for="preview">
${rendered.html}
</div>
${scripts}
</body>
</html>
`;
}

/** Replace `url(fonts/X.woff2)` with data URIs; other formats are dropped. */
function inlineKatexFonts(css: string, katexDir: string): string {
  return css.replace(/src:([^;}]*)/g, (_match, sources: string) => {
    const woff2 = /url\((?:["']?)fonts\/([^"')]+\.woff2)(?:["']?)\)/.exec(sources);
    if (!woff2) {
      return `src:${sources}`;
    }
    const data = readFileSync(join(katexDir, 'fonts', woff2[1])).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
}

// Centering for the HTML export comes from style-template.css
// (body[for="html-export"]).
const HTML_CSS = '';

// Page margins are painted by the page content itself (padding cloned on
// every page fragment), so the theme background covers the whole sheet.
const PDF_CSS = `
@page { margin: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html body[for='html-export'] .crossnote.markdown-preview[data-for='preview'] {
  min-height: 0 !important;
  padding: 16mm 14mm !important;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
`;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
