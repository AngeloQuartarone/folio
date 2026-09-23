/*
 * Human-readable language names.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { baseLanguage } from './types';

/**
 * "en" → "English" (or "Inglese" when `displayLocale` is "it"). Falls back
 * to the upper-case code when the runtime has no name for it.
 */
export function languageName(code: string, displayLocale = 'en'): string {
  const base = baseLanguage(code);
  if (!base) {
    return '?';
  }
  try {
    const name = new Intl.DisplayNames([displayLocale, 'en'], { type: 'language' }).of(base);
    if (name && name.toLowerCase() !== base) {
      return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1);
    }
  } catch {
    // Invalid code or locale: fall through.
  }
  return base.toUpperCase();
}
