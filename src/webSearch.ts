/*
 * Web search for the text selected in the preview: the address opened in the
 * browser. No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** Used when folio.webSearch.url is empty or not a web address. */
export const DEFAULT_SEARCH_URL = 'https://www.google.com/search?q=%s';

/** Longest query sent, in characters: search engines ignore the rest anyway. */
export const MAX_QUERY = 500;

/**
 * The address searching `text` with `template` (folio.webSearch.url): `%s`
 * replaced by the text, URL-encoded, or the text appended when there is no
 * `%s`. Undefined when there is nothing to search.
 */
export function webSearchUrl(template: string, text: string): string | undefined {
  const query = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY)
    .replace(/[\uD800-\uDBFF]$/, ''); // half an emoji, cut by the slice
  if (!query) {
    return undefined;
  }
  const base = /^https?:\/\/[^\s/?#]+/i.test(template.trim()) ? template.trim() : DEFAULT_SEARCH_URL;
  const encoded = encodeURIComponent(query);
  return base.includes('%s') ? base.split('%s').join(encoded) : base + encoded;
}
