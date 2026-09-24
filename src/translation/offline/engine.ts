/*
 * The Bergamot WASM translation engine, run in a worker thread of the
 * extension host. Models are read from the ModelStore; nothing here uses
 * the network.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import {
  CancelledError,
  LatencyOptimisedTranslator,
  SupersededError,
  TranslatorBacking,
} from '../../vendor/bergamot/translator.js';
import { TranslationError } from '../types';
import { MODEL_PAIRS, PIVOT_LANGUAGE } from './registry';
import { ModelStore } from './modelStore';

/** Backing that serves the registry and model files from the local store. */
class LocalBacking extends TranslatorBacking {
  private store!: ModelStore;

  static create(store: ModelStore, workerPath: string): LocalBacking {
    // The options are also posted to the worker, so they must be cloneable
    // (no functions): the error handler is set afterwards.
    const backing = new LocalBacking({ workerUrl: workerPath, pivotLanguage: PIVOT_LANGUAGE });
    backing.onerror = (error: unknown) => console.error('[folio] engine error:', error);
    backing.store = store;
    return backing;
  }

  async loadModelRegistery() {
    // Called from the base constructor; wait a tick so `store` is set.
    await Promise.resolve();
    return MODEL_PAIRS.map((pair) => ({
      from: pair.from,
      to: pair.to,
      files: {
        ...Object.fromEntries(
          pair.files.map((file) => [
            file.part,
            { name: this.store.filePath(pair, file), size: file.size, expectedSha256Hash: file.sha256 },
          ]),
        ),
        ...(Object.keys(pair.config).length ? { config: pair.config } : {}),
      },
    }));
  }

  async fetch(path: string): Promise<ArrayBuffer> {
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
}

export interface TranslationEngine {
  /** With `html`, tags in `text` are carried over to the matching words of the translation. */
  translate(from: string, to: string, text: string, signal?: AbortSignal, html?: boolean): Promise<string>;
  dispose(): void;
}

export class BergamotEngine implements TranslationEngine {
  private translator: LatencyOptimisedTranslator | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: ModelStore,
    private readonly workerPath: string,
    /** Free the worker (and its ~100 MB of models) after this idle time. */
    private readonly idleMs = 5 * 60_000,
  ) {}

  async translate(from: string, to: string, text: string, signal?: AbortSignal, html = false): Promise<string> {
    clearTimeout(this.idleTimer);
    this.translator ??= new LatencyOptimisedTranslator(
      {},
      LocalBacking.create(this.store, this.workerPath),
    );
    try {
      const response = await this.translator.translate(
        { from, to, text, html, qualityScores: false },
        { signal },
      );
      return response.target.text;
    } catch (error) {
      if (error instanceof SupersededError || error instanceof CancelledError || signal?.aborted) {
        throw new TranslationError('cancelled', 'Translation cancelled.');
      }
      // A broken worker is recreated on the next request.
      this.dispose();
      throw new TranslationError(
        'engine',
        `The offline translation engine failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.idleTimer = setTimeout(() => this.dispose(), this.idleMs);
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    const translator = this.translator;
    this.translator = undefined;
    void translator?.delete().catch(() => undefined);
  }
}
