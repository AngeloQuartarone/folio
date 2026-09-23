/*
 * Cache + provider orchestration. Independent of VS Code for testing.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { TranslationCache } from './cache';
import {
  TranslationError,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from './types';

export const MAX_SELECTION_LENGTH = 500;
export const MAX_CONTEXT_LENGTH = 1000;

export interface TranslationOutcome extends TranslationResult {
  fromCache: boolean;
}

export class TranslationService {
  readonly cache = new TranslationCache();

  constructor(private readonly getProvider: () => Promise<TranslationProvider>) {}

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationOutcome> {
    const text = request.text.trim();
    const targetLanguage = request.targetLanguage.trim();
    if (!text) {
      throw new TranslationError('badRequest', 'Nothing to translate.');
    }
    if (text.length > MAX_SELECTION_LENGTH) {
      throw new TranslationError(
        'badRequest',
        `Select at most ${MAX_SELECTION_LENGTH} characters to translate.`,
      );
    }
    if (!targetLanguage) {
      throw new TranslationError('config', 'Set "markdownTranslate.targetLanguage".');
    }

    const cached = this.cache.get(text, targetLanguage);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const provider = await this.getProvider();
    const result = await provider.translate(
      {
        text,
        context: request.context?.trim().slice(0, MAX_CONTEXT_LENGTH) || undefined,
        targetLanguage,
      },
      signal,
    );
    this.cache.set(text, targetLanguage, result);
    return { ...result, fromCache: false };
  }
}
