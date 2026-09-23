declare module 'markdown-it-footnote';
declare module 'markdown-it-sub';
declare module 'markdown-it-sup';
declare module 'markdown-it-mark';
declare module 'markdown-it-deflist';
declare module 'markdown-it-abbr';
declare module 'markdown-it-task-lists';
declare module 'markdown-it-emoji' {
  import type { MarkdownIt } from 'markdown-it';
  export const full: (md: MarkdownIt) => void;
}

declare module '*/vendor/prism/prism.js' {
  const Prism: {
    languages: Record<string, unknown>;
    highlight(text: string, grammar: unknown, language: string): string;
  };
  export = Prism;
}
