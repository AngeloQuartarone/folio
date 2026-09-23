/*
 * In-memory LRU cache of translations.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { TranslationResult } from './types';

export class TranslationCache {
  private readonly entries = new Map<string, TranslationResult>();

  constructor(private readonly maxEntries = 500) {}

  static key(text: string, targetLanguage: string): string {
    return `${targetLanguage.trim().toLowerCase()}\u0000${text}`;
  }

  get(text: string, targetLanguage: string): TranslationResult | undefined {
    const key = TranslationCache.key(text, targetLanguage);
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(text: string, targetLanguage: string, value: TranslationResult): void {
    const key = TranslationCache.key(text, targetLanguage);
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
