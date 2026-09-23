import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLanguage } from '../../src/translation/offline/detect';
import { ModelStore } from '../../src/translation/offline/modelStore';
import { OfflineProvider, lowerCapitalized } from '../../src/translation/offline/offlineProvider';
import {
  MODEL_PAIRS,
  ModelPair,
  SUPPORTED_LANGUAGES,
  modelChain,
  modelPair,
} from '../../src/translation/offline/registry';
import { TranslationError } from '../../src/translation/types';

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TranslationError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

describe('offline registry', () => {
  it('lists the Bergamot languages', () => {
    assert.deepEqual(SUPPORTED_LANGUAGES, ['bg', 'cs', 'de', 'en', 'es', 'et', 'fr', 'it', 'pt', 'ru', 'uk']);
    assert.equal(MODEL_PAIRS.length, 20);
  });

  it('chains through English when there is no direct model', () => {
    assert.deepEqual(modelChain('en', 'it')?.map((p) => p.key), ['enit']);
    assert.deepEqual(modelChain('de', 'it')?.map((p) => p.key), ['deen', 'enit']);
    assert.equal(modelChain('nl', 'it'), undefined);
  });

  it('parses files, sizes and extra config', () => {
    const enit = modelPair('enit')!;
    assert.deepEqual(enit.files.map((f) => f.part).sort(), ['lex', 'model', 'vocab']);
    assert.ok(enit.files.every((f) => f.url.startsWith('https://') && /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.ok(enit.size > 20_000_000);
    const uken = modelPair('uken')!;
    assert.equal(uken.config['gemm-precision'], 'int8shiftAll');
    assert.deepEqual(uken.files.map((f) => f.part).sort(), ['lex', 'model', 'srcvocab', 'trgvocab']);
  });
});

describe('ModelStore', () => {
  let dir: string;
  const payload = Buffer.from('model bytes');
  const pair: ModelPair = {
    key: 'xxyy',
    from: 'xx',
    to: 'yy',
    config: {},
    size: payload.length,
    files: [
      {
        part: 'model',
        url: 'https://example.invalid/xxyy/model.bin',
        fileName: 'model.bin',
        size: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
      },
    ],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtp-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('downloads, verifies and installs model files', async () => {
    const urls: string[] = [];
    const store = new ModelStore(dir, async (url) => {
      urls.push(url);
      return new Response(payload);
    });
    assert.equal(store.isInstalled(pair), false);
    const progress: number[] = [];
    await store.download(pair, (done) => progress.push(done));
    assert.deepEqual(urls, ['https://example.invalid/xxyy/model.bin']);
    assert.equal(store.isInstalled(pair), true);
    assert.equal(readFileSync(join(dir, 'xxyy', 'model.bin')).toString(), 'model bytes');
    assert.equal(progress.at(-1), payload.length);
    assert.equal(new TextDecoder().decode(store.read(pair, pair.files[0])), 'model bytes');
  });

  it('rejects a corrupted download and leaves nothing installed', async () => {
    const store = new ModelStore(dir, async () => new Response(Buffer.from('tampered!!!')));
    await assert.rejects(store.download(pair), /corrupted/);
    assert.equal(store.isInstalled(pair), false);
    assert.equal(existsSync(join(dir, 'xxyy', 'model.bin')), false);
  });

  it('never downloads files that are already present', async () => {
    mkdirSync(join(dir, 'xxyy'));
    writeFileSync(join(dir, 'xxyy', 'model.bin'), payload);
    const store = new ModelStore(dir, async () => {
      throw new Error('network used');
    });
    await store.download(pair);
    assert.equal(store.isInstalled(pair), true);
  });

  it('removes a pair', async () => {
    const store = new ModelStore(dir, async () => new Response(payload));
    await store.download(pair);
    store.remove(pair);
    assert.equal(store.isInstalled(pair), false);
  });
});

describe('OfflineProvider', () => {
  const allInstalled = { missing: () => [] };
  const echoEngine = {
    calls: [] as string[],
    async translate(from: string, to: string, text: string) {
      this.calls.push(`${from}>${to}`);
      return `[${from}>${to}] ${text}`;
    },
  };

  it('translates with the language detected on the context', async () => {
    const provider = new OfflineProvider({ engine: echoEngine, store: allInstalled });
    const result = await provider.translate({
      text: 'Gift',
      context: 'Das ist ein Geschenk für dich.',
      targetLanguage: 'it',
    });
    assert.equal(result.detectedLanguage, 'de');
    assert.equal(result.sameLanguage, false);
  });

  it('falls back to the document language when the context is unreliable', async () => {
    const provider = new OfflineProvider({ engine: echoEngine, store: allInstalled });
    const result = await provider.translate({
      text: 'sofa',
      context: 'sofa',
      targetLanguage: 'it',
      fallbackText: 'This document explains how to install and configure the extension on your computer.',
    });
    assert.equal(result.detectedLanguage, 'en');
  });

  it('lower-cases capitalized single words and pivots hop by hop', async () => {
    const seen: string[] = [];
    const engine = {
      async translate(from: string, to: string, text: string) {
        seen.push(`${from}>${to}:${text}`);
        return from === 'de' ? 'Poison' : 'veleno';
      },
    };
    const provider = new OfflineProvider({ engine, store: allInstalled });
    const result = await provider.translate({ text: 'Gift', targetLanguage: 'it', sourceLanguage: 'de' });
    assert.deepEqual(seen, ['de>en:Gift', 'en>it:poison']);
    assert.equal(result.text, 'veleno');

    seen.length = 0;
    await provider.translate({ text: 'Poison', targetLanguage: 'it', sourceLanguage: 'en' });
    assert.deepEqual(seen, ['en>it:poison']);
  });

  it('keeps acronyms and sentences as they are', () => {
    assert.equal(lowerCapitalized('NASA'), 'NASA');
    assert.equal(lowerCapitalized('iPhone'), 'iPhone');
    assert.equal(lowerCapitalized('Sofa'), 'sofa');
  });

  it('uses a fixed source language', async () => {
    const provider = new OfflineProvider({ engine: echoEngine, store: allInstalled });
    const result = await provider.translate({ text: 'Hallo Welt', targetLanguage: 'it', sourceLanguage: 'de' });
    assert.equal(result.text, '[de>it] Hallo Welt');
  });

  it('reports same language without translating', async () => {
    const engine = { translate: async () => assert.fail('engine called') };
    const provider = new OfflineProvider({ engine, store: allInstalled });
    const result = await provider.translate({ text: 'Il gatto dorme sul divano.', targetLanguage: 'it' });
    assert.equal(result.sameLanguage, true);
  });

  it('asks to download the missing models of the chain', async () => {
    const store = { missing: (pairs: ModelPair[]) => pairs };
    const provider = new OfflineProvider({ engine: echoEngine, store });
    await assert.rejects(
      provider.translate({ text: 'Hallo Welt', context: 'Hallo Welt, wie geht es dir heute?', targetLanguage: 'it' }),
      (error: unknown) => {
        assert.ok(error instanceof TranslationError);
        assert.equal(error.code, 'modelMissing');
        assert.deepEqual(error.pairs, ['deen', 'enit']);
        assert.match(error.message, /German → English and English → Italian models are not installed \(\d+ MB/);
        return true;
      },
    );
  });

  it('rejects unsupported target languages', async () => {
    const provider = new OfflineProvider({ engine: echoEngine, store: allInstalled });
    await rejectsWith(provider.translate({ text: 'hello', targetLanguage: 'ja' }), 'unsupportedLanguage');
  });

  it('reports undetectable text', async () => {
    const provider = new OfflineProvider({
      engine: echoEngine,
      store: allInstalled,
      detect: () => ({ language: '', reliable: false }),
    });
    await rejectsWith(provider.translate({ text: '12345', targetLanguage: 'it' }), 'undetected');
  });
});

describe('detectLanguage', () => {
  const sentences: Array<[string, string]> = [
    ['en', 'The cat sleeps on the sofa.'],
    ['it', 'Il gatto dorme sul divano.'],
    ['de', 'Das ist ein Geschenk für dich.'],
    ['fr', 'Le chat dort sur le canapé.'],
    ['es', 'El gato duerme en el sofá.'],
    ['pt', 'O gato dorme no sofá.'],
    ['uk', 'Кіт спить на дивані.'],
    ['bg', 'Котката спи на дивана.'],
    ['ru', 'Мы говорили об этом вчера вечером.'],
    ['cs', 'Kočka spí na gauči.'],
  ];
  for (const [language, text] of sentences) {
    it(`detects ${language}`, () => {
      assert.equal(detectLanguage(text).language, language);
    });
  }

  it('marks single words as unreliable', () => {
    assert.equal(detectLanguage('sofa').reliable, false);
  });
});
