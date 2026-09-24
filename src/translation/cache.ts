/*
 * In-memory LRU cache of translations.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { TranslationResult } from './types';

export class TranslationCache {
  private readonly entries = new Map<string, TranslationResult>();

  constructor(private readonly maxEntries = 500) {}

  /** The sentence around the text is part of the key: it changes the meaning. */
  static key(text: string, targetLanguage: string, context = ''): string {
    return `${targetLanguage.trim().toLowerCase()}\u0000${text}\u0000${context}`;
  }

  get(text: string, targetLanguage: string, context?: string): TranslationResult | undefined {
    const key = TranslationCache.key(text, targetLanguage, context);
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(text: string, targetLanguage: string, value: TranslationResult, context?: string): void {
    const key = TranslationCache.key(text, targetLanguage, context);
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
