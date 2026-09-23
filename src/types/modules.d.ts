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

declare module '*/vendor/bergamot/translator.js' {
  export interface BergamotRegistryEntry {
    from: string;
    to: string;
    files: Record<string, unknown>;
  }
  export class TranslatorBacking {
    constructor(options?: Record<string, unknown>);
    options: Record<string, unknown>;
    onerror: (error: unknown) => void;
    loadModelRegistery(): Promise<BergamotRegistryEntry[]>;
    fetch(url: string, checksum?: string, extra?: { signal?: AbortSignal }): Promise<ArrayBuffer>;
  }
  export class LatencyOptimisedTranslator {
    constructor(options: Record<string, unknown>, backing?: TranslatorBacking);
    translate(
      request: { from: string; to: string; text: string; html: boolean; qualityScores?: boolean },
      options?: { signal?: AbortSignal },
    ): Promise<{ target: { text: string } }>;
    delete(): Promise<void>;
  }
  export class SupersededError extends Error {}
  export class CancelledError extends Error {}
}
