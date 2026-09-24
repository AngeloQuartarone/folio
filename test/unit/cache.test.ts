import * as assert from 'node:assert/strict';
import { TranslationCache } from '../../src/translation/cache';
import { TranslationService } from '../../src/translation/translationService';
import { TranslationError, TranslationProvider, TranslationResult } from '../../src/translation/types';

const result = (text: string): TranslationResult => ({ text, detectedLanguage: 'en', sameLanguage: false });

describe('TranslationCache', () => {
  it('keys on text and target language', () => {
    const cache = new TranslationCache();
    cache.set('cat', 'it', result('gatto'));
    assert.equal(cache.get('cat', 'it')?.text, 'gatto');
    assert.equal(cache.get('cat', 'IT')?.text, 'gatto', 'language is case-insensitive');
    assert.equal(cache.get('cat', 'de'), undefined);
    assert.equal(cache.get('Cat', 'it'), undefined, 'text is case-sensitive');
  });

  it('keys on the sentence around the text', () => {
    const cache = new TranslationCache();
    cache.set('bank', 'it', result('riva'), 'The river bank.');
    assert.equal(cache.get('bank', 'it', 'The river bank.')?.text, 'riva');
    assert.equal(cache.get('bank', 'it', 'Money in the bank.'), undefined);
  });

  it('evicts the least recently used entry', () => {
    const cache = new TranslationCache(2);
    cache.set('a', 'it', result('1'));
    cache.set('b', 'it', result('2'));
    cache.get('a', 'it'); // a is now the most recent
    cache.set('c', 'it', result('3'));
    assert.equal(cache.size, 2);
    assert.ok(cache.get('a', 'it'));
    assert.equal(cache.get('b', 'it'), undefined);
    assert.ok(cache.get('c', 'it'));
  });

  it('clears', () => {
    const cache = new TranslationCache();
    cache.set('a', 'it', result('1'));
    cache.clear();
    assert.equal(cache.size, 0);
  });
});

describe('TranslationService', () => {
  function countingProvider(): TranslationProvider & { calls: number } {
    return {
      id: 'fake',
      displayName: 'Fake',
      calls: 0,
      async translate(request) {
        this.calls++;
        return result(`[${request.targetLanguage}] ${request.text}`);
      },
    };
  }

  it('serves repeated selections from the cache', async () => {
    const provider = countingProvider();
    const service = new TranslationService(async () => provider);
    const first = await service.translate({ text: ' hello ', targetLanguage: 'it' });
    const second = await service.translate({ text: 'hello', targetLanguage: 'it' });
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.equal(second.text, '[it] hello');
    assert.equal(provider.calls, 1);
    await service.translate({ text: 'hello', targetLanguage: 'de' });
    assert.equal(provider.calls, 2, 'another target language is another entry');
  });

  it('does not cache failures', async () => {
    let fail = true;
    const service = new TranslationService(async () => ({
      id: 'flaky',
      displayName: 'Flaky',
      async translate() {
        if (fail) {
          throw new TranslationError('engine', 'worker crashed');
        }
        return result('ok');
      },
    }));
    await assert.rejects(service.translate({ text: 'x', targetLanguage: 'it' }));
    fail = false;
    assert.equal((await service.translate({ text: 'x', targetLanguage: 'it' })).text, 'ok');
  });

  it('rejects empty and over-long selections', async () => {
    const service = new TranslationService(async () => countingProvider());
    await assert.rejects(service.translate({ text: '  ', targetLanguage: 'it' }), /Nothing/);
    await assert.rejects(service.translate({ text: 'x'.repeat(501), targetLanguage: 'it' }), /500/);
  });

  it('passes the source language and the document sample to the provider', async () => {
    let seen: unknown;
    const service = new TranslationService(async () => ({
      id: 'spy',
      displayName: 'Spy',
      async translate(request) {
        seen = [request.sourceLanguage, request.fallbackText];
        return result('x');
      },
    }));
    await service.translate({ text: 'x', targetLanguage: 'it', sourceLanguage: 'de', fallbackText: 'doc' });
    assert.deepEqual(seen, ['de', 'doc']);
  });

  it('truncates the context passed to the provider', async () => {
    let seen = '';
    const service = new TranslationService(async () => ({
      id: 'spy',
      displayName: 'Spy',
      async translate(request) {
        seen = request.context ?? '';
        return result('x');
      },
    }));
    await service.translate({ text: 'x', context: 'y'.repeat(5000), targetLanguage: 'it' });
    assert.equal(seen.length, 1000);
  });
});
