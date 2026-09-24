/*
 * Markdown to HTML for the preview and exports.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Code block highlighting is adapted from crossnote
 * render-enhancers/code-block-styling.ts (University of Illinois/NCSA
 * License, Copyright (c) 2017 ~ 2023 Yiyi Wang).
 *
 * This module must not import `vscode`: it is shared with the unit tests.
 */
import katex from 'katex';
import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import abbr from 'markdown-it-abbr';
import deflist from 'markdown-it-deflist';
import { full as emoji } from 'markdown-it-emoji';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';
import Prism from '../vendor/prism/prism.js';
import { stripNotesBlock } from '../notes/notesBlock';
import { githubAlerts, headingIds, sourceMap, stripFrontMatter } from './plugins';

export interface RendererOptions {
  /** Render a single newline as `<br>` (GitHub does not). */
  breaks: boolean;
  /** Render `$...$`, `$$...$$` and ```math blocks with KaTeX. */
  math: boolean;
  /** Emit ```mermaid blocks as diagrams (rendered by mermaid.js in the page). */
  mermaid: boolean;
}

export interface RenderEnv {
  [key: string | symbol]: unknown;
  /**
   * Rewrites the `src` of Markdown images. Relative paths are left to the
   * page's `<base href>`; this hook exists for paths that need more (e.g.
   * `/img.png`, relative to the workspace root).
   */
  resolveImageSrc?: (src: string) => string;
}

export interface RenderResult {
  html: string;
  /** Number of lines of the source, used by scroll sync. */
  lineCount: number;
  hasMath: boolean;
  hasMermaid: boolean;
}

const MAX_CACHED_BLOCK = 64 * 1024;
const MAX_CACHE_ENTRIES = 300;

export class MarkdownRenderer {
  private readonly md: MarkdownItInstance;
  /** Highlighted HTML keyed by language + code, so edits elsewhere are cheap. */
  private readonly highlightCache = new Map<string, string>();

  constructor(private readonly options: RendererOptions) {
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
      breaks: options.breaks,
    });
    this.md
      .use(footnote)
      .use(sub)
      .use(sup)
      .use(mark)
      .use(deflist)
      .use(abbr)
      .use(emoji)
      .use(taskLists, { enabled: false, label: false })
      .use(githubAlerts)
      .use(headingIds)
      .use(sourceMap);
    if (options.math) {
      this.md.use(markdownItKatex, {
        katex,
        throwOnError: false,
        enableFencedBlocks: true,
      });
    }
    this.installFenceRenderer();
    this.installImageRenderer();
  }

  render(text: string, env: RenderEnv = {}): RenderResult {
    // Front matter and Folio's notes block are never shown (nor exported).
    const html = this.md.render(stripNotesBlock(stripFrontMatter(text)), env);
    return {
      html,
      lineCount: text.split('\n').length,
      hasMath: html.includes('class="katex'),
      hasMermaid: html.includes('class="mermaid"'),
    };
  }

  private installFenceRenderer(): void {
    const fallback = this.md.renderer.rules.fence;
    this.md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const language = parseFenceLanguage(token.info);
      const line = sourceLines(token.map);

      if (language === 'mermaid' && this.options.mermaid) {
        return `<div class="mermaid"${line}>${escapeHtml(token.content)}</div>\n`;
      }
      if (language === 'math' && fallback) {
        // Rendered by the KaTeX plugin (enableFencedBlocks).
        return fallback(tokens, idx, options, env, self);
      }

      const grammarName = language && Prism.languages[language] ? language : '';
      const cssLanguage = grammarName || 'text';
      const code = grammarName
        ? this.highlight(token.content, grammarName)
        : escapeHtml(token.content);
      return (
        `<pre${line} class="language-${cssLanguage}">` +
        `<code class="language-${cssLanguage}">${code}</code></pre>\n`
      );
    };

    this.md.renderer.rules.code_block = (tokens, idx) => {
      const token = tokens[idx];
      const line = sourceLines(token.map);
      return `<pre${line} class="language-text"><code class="language-text">${escapeHtml(
        token.content,
      )}</code></pre>\n`;
    };
  }

  private installImageRenderer(): void {
    const defaultImage = this.md.renderer.rules.image!;
    this.md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet('src');
      const resolve = (env as RenderEnv | undefined)?.resolveImageSrc;
      if (typeof src === 'string' && resolve) {
        token.attrSet('src', resolve(src));
      }
      return defaultImage(tokens, idx, options, env, self);
    };
  }

  private highlight(code: string, language: string): string {
    const key = `${language}\u0000${code}`;
    const cached = this.highlightCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let html: string;
    try {
      html = Prism.highlight(code, Prism.languages[language], language);
    } catch {
      return escapeHtml(code);
    }
    if (code.length <= MAX_CACHED_BLOCK) {
      if (this.highlightCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.highlightCache.keys().next().value;
        if (oldest !== undefined) {
          this.highlightCache.delete(oldest);
        }
      }
      this.highlightCache.set(key, html);
    }
    return html;
  }
}

/** First word of the info string, without `{...}` attributes: "js {.x}" → "js". */
export function parseFenceLanguage(info: string): string {
  const word = info.trim().split(/[\s{]/)[0] ?? '';
  return word.toLowerCase();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sourceLines(map: [number, number] | null): string {
  return map ? ` data-source-line="${map[0] + 1}" data-source-end="${map[1]}"` : '';
}
