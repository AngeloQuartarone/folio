/*
 * Translation provider contract.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The built-in provider translates offline (offline/offlineProvider.ts).
 * Another engine only needs to implement `TranslationProvider`.
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
  /**
   * Source language fixed by the user, or undefined to detect it. When
   * detection on the context is unreliable, `fallbackText` (e.g. the whole
   * document) is used.
   */
  sourceLanguage?: string;
  fallbackText?: string;
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
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
}

export type TranslationErrorCode =
  /** The language models for this pair are not on disk yet. */
  | 'modelMissing'
  /** No offline model exists for the detected/target language. */
  | 'unsupportedLanguage'
  /** The source language could not be detected. */
  | 'undetected'
  | 'badRequest'
  /** Invalid or missing setting (target language, models folder). */
  | 'config'
  /** The translation engine failed. */
  | 'engine'
  | 'cancelled';

export class TranslationError extends Error {
  constructor(
    readonly code: TranslationErrorCode,
    message: string,
    /** For `modelMissing`: the model pairs to download, e.g. ["deen", "enit"]. */
    readonly pairs?: string[],
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

/** The subset of `fetch` used to download models; injectable for tests. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** "EN-US" → "en", "pt-BR" → "pt", "zh-Hans" → "zh". */
export function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}
