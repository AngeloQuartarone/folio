/*
 * Context extraction for translations. No DOM access: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */

const MAX_CONTEXT = 1000;

/**
 * The sentence(s) of `text` that overlap the selection [start, end).
 * Uses `Intl.Segmenter` where available, else splits on . ! ? and newlines.
 */
export function sentenceAround(text: string, start: number, end: number, locale?: string): string {
  if (!text) {
    return '';
  }
  start = Math.max(0, Math.min(start, text.length));
  end = Math.max(start, Math.min(end, text.length));

  const pieces: string[] = [];
  for (const { index, segment } of sentences(text, locale)) {
    const segmentEnd = index + segment.length;
    const overlaps = segmentEnd > start && index < Math.max(end, start + 1);
    if (overlaps) {
      pieces.push(segment);
    }
  }
  const context = pieces.join('').replace(/\s+/g, ' ').trim();
  if (context.length <= MAX_CONTEXT) {
    return context;
  }
  // A very long "sentence" (e.g. a table cell or a list without periods):
  // keep a window around the selection.
  const from = Math.max(0, start - MAX_CONTEXT / 2);
  return text.slice(from, from + MAX_CONTEXT).replace(/\s+/g, ' ').trim();
}

function sentences(text: string, locale?: string): Array<{ index: number; segment: string }> {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(locale, { granularity: 'sentence' }).segment(text));
  }
  const result: Array<{ index: number; segment: string }> = [];
  const pattern = /[^.!?\n]*(?:[.!?]+|\n|$)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && match[0]) {
    result.push({ index: match.index, segment: match[0] });
  }
  return result;
}
