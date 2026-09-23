/*
 * Provider registry.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { FetchFn, TranslationProvider } from '../types';
import { DeepLProvider } from './deepl';
import { LibreTranslateProvider } from './libreTranslate';

export interface ProviderSettings {
  apiKey?: string;
  libreTranslateUrl: string;
  fetch: FetchFn;
  timeoutMs: number;
}

type ProviderFactory = (settings: ProviderSettings) => TranslationProvider;

/** Add new providers here (and to the `markdownTranslate.provider` enum). */
export const PROVIDERS: Record<string, { displayName: string; create: ProviderFactory }> = {
  deepl: {
    displayName: 'DeepL',
    create: (s) => new DeepLProvider({ apiKey: s.apiKey, fetch: s.fetch, timeoutMs: s.timeoutMs }),
  },
  libretranslate: {
    displayName: 'LibreTranslate',
    create: (s) =>
      new LibreTranslateProvider({
        apiKey: s.apiKey,
        url: s.libreTranslateUrl,
        fetch: s.fetch,
        timeoutMs: s.timeoutMs,
      }),
  },
};

export type ProviderId = keyof typeof PROVIDERS;

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS;
}
