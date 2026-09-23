/*
 * DeepL API (Free and Pro).
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * https://developers.deepl.com/docs/api-reference/translate
 */
import {
  ProviderOptions,
  TranslationError,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  baseLanguage,
} from '../types';
import { HttpResponse, postJson, serverMessage } from './http';

export const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate';
export const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate';

/** Free API keys end with ":fx". */
export function deeplEndpoint(apiKey: string): string {
  return apiKey.trim().endsWith(':fx') ? DEEPL_FREE_URL : DEEPL_PRO_URL;
}

/**
 * DeepL target codes are upper case, and English/Portuguese need a variant
 * ("EN" alone is deprecated as a target).
 */
export function deeplTargetLanguage(language: string): string {
  const code = language.trim().replace('_', '-').toUpperCase();
  if (code === 'EN') {
    return 'EN-US';
  }
  if (code === 'PT') {
    return 'PT-PT';
  }
  return code;
}

/** Selections this short get their language detected from the context. */
const SHORT_SELECTION_WORDS = 3;

interface DeepLResponse {
  translations?: Array<{ detected_source_language?: string; text?: string }>;
}

export class DeepLProvider implements TranslationProvider {
  readonly id = 'deepl';
  readonly displayName = 'DeepL';
  readonly requiresApiKey = true;

  constructor(private readonly options: ProviderOptions) {}

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      throw new TranslationError('missingKey', 'No DeepL API key is set.');
    }
    const target = deeplTargetLanguage(request.targetLanguage);
    const context = request.context?.trim();
    // `context` is not billed and improves the translation. For very short
    // selections the context is also translated once, only to read its
    // detected language, which is far more reliable than on a single word.
    const detectFromContext =
      !!context &&
      context !== request.text.trim() &&
      request.text.trim().split(/\s+/).length <= SHORT_SELECTION_WORDS;

    const texts = detectFromContext ? [request.text, context] : [request.text];
    let translations = await this.call(apiKey, { text: texts, target_lang: target, context }, signal);
    let detected = translations[detectFromContext ? 1 : 0]?.detected_source_language ?? '';

    const selectionDetected = translations[0]?.detected_source_language ?? '';
    if (detectFromContext && detected && selectionDetected && detected !== selectionDetected) {
      // The word alone was misdetected: translate it again from the
      // language of its sentence.
      translations = await this.call(
        apiKey,
        { text: [request.text], target_lang: target, source_lang: detected, context },
        signal,
      );
    }

    const text = translations[0]?.text;
    if (typeof text !== 'string') {
      throw new TranslationError('server', 'DeepL returned an unexpected response.');
    }
    const detectedLanguage = baseLanguage(detected || selectionDetected);
    const sameLanguage = detectedLanguage === baseLanguage(target);
    return {
      text: sameLanguage ? request.text : text,
      detectedLanguage,
      sameLanguage,
    };
  }

  private async call(
    apiKey: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<NonNullable<DeepLResponse['translations']>> {
    const response = await postJson(
      this.options.fetch,
      deeplEndpoint(apiKey),
      payload,
      { Authorization: `DeepL-Auth-Key ${apiKey}` },
      this.options.timeoutMs,
      'DeepL',
      signal,
    );
    if (response.status !== 200) {
      throw deeplError(response);
    }
    return (response.body as DeepLResponse | undefined)?.translations ?? [];
  }
}

function deeplError(response: HttpResponse): TranslationError {
  const detail = serverMessage(response);
  switch (response.status) {
    case 401:
    case 403:
      return new TranslationError(
        'invalidKey',
        'DeepL rejected the API key. Check it, and that Free keys end with ":fx".',
        response.status,
      );
    case 456:
      return new TranslationError(
        'quota',
        'DeepL character quota exceeded for this billing period.',
        response.status,
      );
    case 429:
      return new TranslationError(
        'rateLimit',
        'Too many requests to DeepL. Wait a moment and try again.',
        response.status,
      );
    case 400:
      return new TranslationError(
        'badRequest',
        `DeepL could not process the request${detail ? `: ${detail}` : ''}. Check the target language.`,
        response.status,
      );
    default:
      return new TranslationError(
        'server',
        `DeepL error ${response.status}${detail ? `: ${detail}` : ''}.`,
        response.status,
      );
  }
}
