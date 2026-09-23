import * as assert from 'node:assert/strict';
import { LibreTranslateProvider } from '../../src/translation/providers/libreTranslate';
import { TranslationError } from '../../src/translation/types';
import { fakeFetch } from './fakeFetch';

function provider(fetch: ReturnType<typeof fakeFetch>, apiKey?: string, url = 'http://lt.local:5000/') {
  return new LibreTranslateProvider({ url, apiKey, fetch, timeoutMs: 5000 });
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TranslationError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('LibreTranslateProvider', () => {
  it('detects on the context, then translates from that language', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith('/detect')
        ? { json: [{ language: 'fr', confidence: 90 }, { language: 'en', confidence: 10 }] }
        : { json: { translatedText: 'gatto' } },
    );
    const result = await provider(fetch).translate({
      text: 'chat',
      context: 'Le chat dort sur le canapé.',
      targetLanguage: 'it',
    });
    assert.deepEqual(result, { text: 'gatto', detectedLanguage: 'fr', sameLanguage: false });
    assert.equal(fetch.calls[0].url, 'http://lt.local:5000/detect');
    assert.equal(fetch.calls[0].body.q, 'Le chat dort sur le canapé.');
    assert.equal(fetch.calls[1].url, 'http://lt.local:5000/translate');
    assert.deepEqual(fetch.calls[1].body, { q: 'chat', source: 'fr', target: 'it', format: 'text' });
  });

  it('sends the optional API key', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith('/detect') ? { json: [{ language: 'en', confidence: 99 }] } : { json: { translatedText: 'ciao' } },
    );
    await provider(fetch, 'secret').translate({ text: 'hello', targetLanguage: 'it' });
    assert.equal(fetch.calls[0].body.api_key, 'secret');
    assert.equal(fetch.calls[1].body.api_key, 'secret');
  });

  it('skips translation when already in the target language', async () => {
    const fetch = fakeFetch(() => ({ json: [{ language: 'it', confidence: 95 }] }));
    const result = await provider(fetch).translate({ text: 'ciao', targetLanguage: 'it' });
    assert.equal(result.sameLanguage, true);
    assert.equal(fetch.calls.length, 1);
  });

  it('falls back to source "auto" when detection returns nothing', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith('/detect')
        ? { json: [] }
        : { json: { translatedText: 'ciao', detectedLanguage: { language: 'en', confidence: 80 } } },
    );
    const result = await provider(fetch).translate({ text: 'hello', targetLanguage: 'it' });
    assert.equal(fetch.calls[1].body.source, 'auto');
    assert.equal(result.detectedLanguage, 'en');
  });

  it('asks for a key when the server requires one', async () => {
    const fetch = fakeFetch(() => ({ status: 400, json: { error: 'Visit https://portal.libretranslate.com to get an API key' } }));
    await rejectsWith(provider(fetch).translate({ text: 'x', targetLanguage: 'it' }), 'missingKey');
  });

  it('reports a rejected key', async () => {
    const fetch = fakeFetch(() => ({ status: 403, json: { error: 'Invalid API key' } }));
    await rejectsWith(provider(fetch, 'bad').translate({ text: 'x', targetLanguage: 'it' }), 'invalidKey');
  });

  it('maps rate limits to quota', async () => {
    const fetch = fakeFetch(() => ({ status: 429, json: { error: 'Slowdown: 20 per 1 minute' } }));
    await rejectsWith(provider(fetch).translate({ text: 'x', targetLanguage: 'it' }), 'quota');
  });

  it('maps network failures', async () => {
    const fetch = fakeFetch(() => new TypeError('ECONNREFUSED'));
    await rejectsWith(provider(fetch).translate({ text: 'x', targetLanguage: 'it' }), 'network');
  });

  it('rejects a missing or non-http URL', async () => {
    const fetch = fakeFetch(() => ({ json: {} }));
    await rejectsWith(provider(fetch, undefined, '').translate({ text: 'x', targetLanguage: 'it' }), 'config');
    assert.equal(fetch.calls.length, 0);
  });
});
