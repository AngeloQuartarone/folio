/*
 * Offline TranslationProvider: local language detection + Bergamot models.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { languageName } from '../languages';
import {
  TranslationError,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  baseLanguage,
} from '../types';
import { Detection, detectLanguage } from './detect';
import type { TranslationEngine } from './engine';
import { ModelPair, SUPPORTED_LANGUAGES, formatSize, modelChain } from './registry';

export interface OfflineProviderDeps {
  engine: Pick<TranslationEngine, 'translate'>;
  store: { missing(pairs: ModelPair[]): ModelPair[] };
  detect?: (text: string) => Detection;
}

export class OfflineProvider implements TranslationProvider {
  readonly id = 'offline';
  readonly displayName = 'Offline (Bergamot)';

  constructor(private readonly deps: OfflineProviderDeps) {}

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const target = baseLanguage(request.targetLanguage);
    if (!SUPPORTED_LANGUAGES.includes(target)) {
      throw new TranslationError(
        'unsupportedLanguage',
        `Offline translation into ${languageName(target)} is not available. ` +
          `Supported: ${SUPPORTED_LANGUAGES.map((code) => languageName(code)).join(', ')}.`,
      );
    }

    const source = this.sourceLanguage(request);
    if (!source) {
      throw new TranslationError(
        'undetected',
        'Could not detect the language of the selection. Set "markdownTranslate.sourceLanguage".',
      );
    }
    if (source === target) {
      return { text: request.text, detectedLanguage: source, sameLanguage: true };
    }
    const chain = SUPPORTED_LANGUAGES.includes(source) ? modelChain(source, target) : undefined;
    if (!chain) {
      throw new TranslationError(
        'unsupportedLanguage',
        `${languageName(source)} → ${languageName(target)} is not available offline.`,
      );
    }

    const missing = this.deps.store.missing(chain);
    if (missing.length) {
      const size = missing.reduce((total, pair) => total + pair.size, 0);
      const names = missing.map((pair) => `${languageName(pair.from)} → ${languageName(pair.to)}`);
      throw new TranslationError(
        'modelMissing',
        `The ${names.join(' and ')} model${missing.length > 1 ? 's are' : ' is'} not installed ` +
          `(${formatSize(size)}, downloaded once, then everything works offline).`,
        missing.map((pair) => pair.key),
      );
    }

    const text = /\s/.test(request.text.trim())
      ? await this.deps.engine.translate(source, target, request.text, signal)
      : await this.translateWord(chain, request.text.trim(), signal);
    return { text, detectedLanguage: source, sameLanguage: false };
  }

  /**
   * The models copy a lone capitalized word as if it were a name ("Poison"
   * stays "Poison"), so single words are lower-cased — except German input,
   * where every noun is capitalized — and the pivot hops run separately so
   * the intermediate English word can be lower-cased too.
   */
  private async translateWord(chain: ModelPair[], word: string, signal?: AbortSignal): Promise<string> {
    let current = chain[0].from === 'de' ? word : lowerCapitalized(word);
    for (let i = 0; i < chain.length; i++) {
      current = await this.deps.engine.translate(chain[i].from, chain[i].to, current, signal);
      if (i < chain.length - 1) {
        current = lowerCapitalized(current);
      }
    }
    return current;
  }

  /** Fixed by the user, else detected on the context, else on the whole document. */
  private sourceLanguage(request: TranslationRequest): string {
    const fixed = request.sourceLanguage && baseLanguage(request.sourceLanguage);
    if (fixed && fixed !== 'auto') {
      return fixed;
    }
    const detect = this.deps.detect ?? detectLanguage;
    const local = detect(request.context || request.text);
    if (local.reliable) {
      return local.language;
    }
    if (request.fallbackText) {
      const document = detect(request.fallbackText);
      if (document.language) {
        return document.language;
      }
    }
    return local.language;
  }
}

/** "Poison" → "poison"; "NASA", "iPhone" and multi-word text are left alone. */
export function lowerCapitalized(word: string): string {
  return /^\p{Lu}\p{Ll}+$/u.test(word) ? word.charAt(0).toLowerCase() + word.slice(1) : word;
}
