/*
 * Translation provider contract.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * To add a provider: implement `TranslationProvider`, register a factory in
 * providers/index.ts and add its id to the `markdownTranslate.provider` enum
 * in package.json.
 */

export interface TranslationRequest {
  /** The selected text (at most ~500 characters). */
  text: string;
  /**
   * The sentence(s) around the selection. Not translated; used to improve
   * language detection and word sense for short selections.
   */
  context?: string;
  /** Target language as configured by the user, e.g. "it", "en", "pt-BR". */
  targetLanguage: string;
}

export interface TranslationResult {
  text: string;
  /** Detected source language, lower case (e.g. "en", "de"). */
  detectedLanguage: string;
  /**
   * True when the source already is in the target language. `text` is then
   * the original selection.
   */
  sameLanguage: boolean;
}

export interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  /** Whether requests fail without an API key. */
  readonly requiresApiKey: boolean;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
}

export type TranslationErrorCode =
  | 'missingKey'
  | 'invalidKey'
  | 'quota'
  | 'rateLimit'
  | 'network'
  | 'timeout'
  | 'badRequest'
  /** Invalid or missing setting (server URL, target language). */
  | 'config'
  | 'server'
  | 'cancelled';

export class TranslationError extends Error {
  constructor(
    readonly code: TranslationErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

/** The subset of `fetch` the providers use; injectable for tests. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderOptions {
  apiKey?: string;
  fetch: FetchFn;
  /** Per-request timeout. */
  timeoutMs: number;
}

/** "EN-US" → "en", "pt-BR" → "pt", "zh-Hans" → "zh". */
export function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}
