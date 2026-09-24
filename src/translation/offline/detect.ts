/*
 * Offline language detection.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * eld (Efficient Language Detector, Apache-2.0) with its smallest n-gram
 * database, restricted to the languages that have translation models, plus
 * a letter-based tie-break for Cyrillic scripts, where short sentences are
 * often misread.
 */
import { eld } from 'eld/extrasmall';
import { SUPPORTED_LANGUAGES } from './registry';

eld.setLanguageSubset(SUPPORTED_LANGUAGES);

export interface Detection {
  /** ISO 639-1 code, or '' when nothing could be detected. */
  language: string;
  reliable: boolean;
}

const CYRILLIC = /[Ѐ-ӿ]/;

/** eld often calls one or two words "reliable" ("Sentences" → French). */
const MIN_RELIABLE_WORDS = 3;

/** Letters that only one of ru/uk/bg uses. */
function cyrillicLanguage(text: string): string | undefined {
  if (/[іїєґ]/i.test(text)) {
    return 'uk';
  }
  // Bulgarian has no ы/э/ё and uses ь only before о.
  if (/[ыэё]/i.test(text) || /ь(?!о)/i.test(text)) {
    return 'ru';
  }
  return undefined;
}

export function detectLanguage(text: string): Detection {
  const sample = text.trim().slice(0, 2000);
  if (!sample) {
    return { language: '', reliable: false };
  }
  if (CYRILLIC.test(sample)) {
    const byLetters = cyrillicLanguage(sample);
    if (byLetters) {
      return { language: byLetters, reliable: true };
    }
  }
  const result = eld.detect(sample);
  const words = sample.split(/\s+/).length;
  return {
    language: result.language,
    reliable: !!result.language && result.isReliable() && words >= MIN_RELIABLE_WORDS,
  };
}
