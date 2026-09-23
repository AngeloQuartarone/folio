/*
 * GitHub-compatible heading slugs.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/**
 * Turn heading text into an id the way GitHub does: lower case, drop
 * punctuation (keeping letters and digits of any script, `-` and `_`),
 * spaces become `-`.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Hands out unique slugs within one document: `a`, `a-1`, `a-2`, ... */
export class SlugRegistry {
  private readonly used = new Set<string>();

  unique(text: string): string {
    const base = slugify(text) || 'section';
    let slug = base;
    for (let n = 1; this.used.has(slug); n++) {
      slug = `${base}-${n}`;
    }
    this.used.add(slug);
    return slug;
  }
}
