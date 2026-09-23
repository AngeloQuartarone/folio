/*
 * LibreTranslate (self-hosted or libretranslate.com).
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * https://docs.libretranslate.com/guides/api_usage/
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

export interface LibreTranslateOptions extends ProviderOptions {
  /** Server base URL, e.g. "https://libretranslate.com" or "http://localhost:5000". */
  url: string;
}

interface DetectResponse {
  language?: string;
  confidence?: number;
}

interface TranslateResponse {
  translatedText?: string;
  detectedLanguage?: DetectResponse;
}

export class LibreTranslateProvider implements TranslationProvider {
  readonly id = 'libretranslate';
  readonly displayName = 'LibreTranslate';
  readonly requiresApiKey = false;

  constructor(private readonly options: LibreTranslateOptions) {}

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const target = request.targetLanguage.trim().toLowerCase();
    // LibreTranslate has no context parameter: detect the language on the
    // surrounding sentence, then translate the selection from it.
    const source = await this.detect(request.context?.trim() || request.text, signal);
    if (source && baseLanguage(source) === baseLanguage(target)) {
      return { text: request.text, detectedLanguage: baseLanguage(source), sameLanguage: true };
    }

    const response = await this.post(
      '/translate',
      { q: request.text, source: source || 'auto', target, format: 'text' },
      signal,
    );
    const body = response.body as TranslateResponse | undefined;
    if (typeof body?.translatedText !== 'string') {
      throw new TranslationError('server', 'LibreTranslate returned an unexpected response.');
    }
    const detectedLanguage = baseLanguage(source || body.detectedLanguage?.language || '');
    return {
      text: body.translatedText,
      detectedLanguage,
      sameLanguage: detectedLanguage === baseLanguage(target),
    };
  }

  private async detect(text: string, signal?: AbortSignal): Promise<string | undefined> {
    const response = await this.post('/detect', { q: text }, signal);
    const candidates = response.body as DetectResponse[] | undefined;
    if (!Array.isArray(candidates) || !candidates.length) {
      return undefined;
    }
    const best = [...candidates].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    return typeof best.language === 'string' ? best.language : undefined;
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    const base = this.options.url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) {
      throw new TranslationError(
        'config',
        'Set "markdownTranslate.libreTranslateUrl" to the http(s) URL of a LibreTranslate server.',
      );
    }
    const apiKey = this.options.apiKey?.trim();
    const response = await postJson(
      this.options.fetch,
      base + path,
      apiKey ? { ...payload, api_key: apiKey } : payload,
      {},
      this.options.timeoutMs,
      'LibreTranslate',
      signal,
    );
    if (response.status !== 200) {
      throw libreTranslateError(response, !!apiKey);
    }
    return response;
  }
}

function libreTranslateError(response: HttpResponse, hasKey: boolean): TranslationError {
  const detail = serverMessage(response);
  const mentionsKey = /api[ _]?key/i.test(detail);
  if (response.status === 403 || (response.status === 400 && mentionsKey)) {
    return hasKey
      ? new TranslationError('invalidKey', `LibreTranslate rejected the API key${detail ? `: ${detail}` : '.'}`, response.status)
      : new TranslationError('missingKey', `This LibreTranslate server requires an API key${detail ? `: ${detail}` : '.'}`, response.status);
  }
  if (response.status === 429) {
    return new TranslationError(
      'quota',
      `LibreTranslate limit reached${detail ? `: ${detail}` : ''}. Wait or use another server/key.`,
      response.status,
    );
  }
  if (response.status === 400) {
    return new TranslationError(
      'badRequest',
      `LibreTranslate could not process the request${detail ? `: ${detail}` : ''}. Check the target language.`,
      response.status,
    );
  }
  return new TranslationError(
    'server',
    `LibreTranslate error ${response.status}${detail ? `: ${detail}` : ''}.`,
    response.status,
  );
}
