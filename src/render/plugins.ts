/*
 * Small markdown-it plugins used by the preview.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * `sourceMap` is adapted from crossnote custom-markdown-it-features/sourcemap.ts
 * (University of Illinois/NCSA License, Copyright (c) 2017 ~ 2023 Yiyi Wang).
 */
import type { MarkdownIt } from 'markdown-it';
import { SlugRegistry } from './slugify';

/**
 * Tag every block-level opening tag with its first (`data-source-line`) and
 * last (`data-source-end`) source line, 1-based, so the webview can map
 * scroll positions and selections back to the editor.
 */
export function sourceMap(md: MarkdownIt): void {
  const renderToken = md.renderer.renderToken.bind(md.renderer);
  md.renderer.renderToken = (tokens, idx, options) => {
    const token = tokens[idx];
    if (token.type.endsWith('_open') && token.map) {
      token.attrSet('data-source-line', `${token.map[0] + 1}`);
      token.attrSet('data-source-end', `${token.map[1]}`);
    }
    return renderToken(tokens, idx, options);
  };
}

/** GitHub-style heading ids, unique within the document. */
export function headingIds(md: MarkdownIt): void {
  md.core.ruler.push('heading_ids', (state) => {
    const slugs = new SlugRegistry();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open' || tokens[i].attrGet('id')) {
        continue;
      }
      const inline = tokens[i + 1];
      const text = (inline.children ?? [])
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('');
      tokens[i].attrSet('id', slugs.unique(text));
    }
  });
}

const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i;

/**
 * GitHub alerts:
 *
 *     > [!WARNING]
 *     > Text
 */
export function githubAlerts(md: MarkdownIt): void {
  md.core.ruler.after('block', 'github_alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (
        tokens[i].type !== 'blockquote_open' ||
        tokens[i + 1].type !== 'paragraph_open' ||
        tokens[i + 2].type !== 'inline'
      ) {
        continue;
      }
      const inline = tokens[i + 2];
      const match = ALERT_MARKER.exec(inline.content);
      if (!match) {
        continue;
      }
      const type = match[1].toLowerCase() as (typeof ALERT_TYPES)[number];
      inline.content = inline.content.slice(match[0].length).replace(/^\r?\n/, '');

      tokens[i].attrJoin('class', `markdown-alert markdown-alert-${type}`);
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="markdown-alert-title">${
        type.charAt(0).toUpperCase() + type.slice(1)
      }</p>\n`;
      tokens.splice(i + 1, 0, title);

      if (inline.content.trim() === '') {
        // The marker was alone in its paragraph: drop the empty <p>.
        tokens[i + 2].hidden = true;
        tokens[i + 4].hidden = true;
      }
    }
  });
}

/**
 * Hide YAML/TOML front matter. The lines are blanked instead of removed so
 * `data-source-line` values keep matching the editor.
 */
export function stripFrontMatter(text: string): string {
  const match = /^(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!match) {
    return text;
  }
  const fence = match[1];
  const lines = text.split('\n');
  const closing = fence === '---' ? /^(---|\.\.\.)[ \t]*\r?$/ : /^\+\+\+[ \t]*\r?$/;
  for (let i = 1; i < lines.length; i++) {
    if (closing.test(lines[i])) {
      return lines.map((line, n) => (n <= i ? '' : line)).join('\n');
    }
  }
  return text;
}
