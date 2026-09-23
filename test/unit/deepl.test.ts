import * as assert from 'node:assert/strict';
import {
  DEEPL_FREE_URL,
  DEEPL_PRO_URL,
  DeepLProvider,
  deeplEndpoint,
  deeplTargetLanguage,
} from '../../src/translation/providers/deepl';
import { TranslationError } from '../../src/translation/types';
import { fakeFetch } from './fakeFetch';

const ok = (...items: Array<[string, string]>) => ({
  json: { translations: items.map(([lang, text]) => ({ detected_source_language: lang, text })) },
});

function provider(fetch: ReturnType<typeof fakeFetch>, apiKey = 'abc:fx') {
  return new DeepLProvider({ apiKey, fetch, timeoutMs: 5000 });
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TranslationError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('DeepLProvider', () => {
  it('picks the Free endpoint for ":fx" keys and Pro otherwise', () => {
    assert.equal(deeplEndpoint('123:fx'), DEEPL_FREE_URL);
    assert.equal(deeplEndpoint('123'), DEEPL_PRO_URL);
  });

  it('normalizes target languages', () => {
    assert.equal(deeplTargetLanguage('it'), 'IT');
    assert.equal(deeplTargetLanguage('en'), 'EN-US');
    assert.equal(deeplTargetLanguage('pt'), 'PT-PT');
    assert.equal(deeplTargetLanguage('pt_br'), 'PT-BR');
  });

  it('translates and sends the key, target and context', async () => {
    const fetch = fakeFetch(() => ok(['EN', 'Il gatto dorme sul divano.']));
    const result = await provider(fetch).translate({
      text: 'The cat sleeps on the sofa.',
      context: 'The cat sleeps on the sofa. It is tired.',
      targetLanguage: 'it',
    });
    assert.deepEqual(result, {
      text: 'Il gatto dorme sul divano.',
      detectedLanguage: 'en',
      sameLanguage: false,
    });
    const [call] = fetch.calls;
    assert.equal(call.url, DEEPL_FREE_URL);
    assert.equal(call.headers['Authorization'], 'DeepL-Auth-Key abc:fx');
    assert.equal(call.body.target_lang, 'IT');
    assert.deepEqual(call.body.text, ['The cat sleeps on the sofa.']);
    assert.equal(call.body.context, 'The cat sleeps on the sofa. It is tired.');
  });

  it('detects the language of short selections from their sentence', async () => {
    const fetch = fakeFetch((call) =>
      call.body.source_lang
        ? ok(['DE', 'regalo'])
        : ok(['EN', 'regalo?'], ['DE', 'Das ist ein Geschenk für dich.']),
    );
    const result = await provider(fetch).translate({
      text: 'Gift',
      context: 'Das ist ein Gift für dich.',
      targetLanguage: 'it',
    });
    assert.equal(fetch.calls.length, 2, 'retranslated with the sentence language');
    assert.deepEqual(fetch.calls[0].body.text, ['Gift', 'Das ist ein Gift für dich.']);
    assert.equal(fetch.calls[1].body.source_lang, 'DE');
    assert.equal(result.detectedLanguage, 'de');
    assert.equal(result.text, 'regalo');
  });

  it('does a single request when word and sentence agree', async () => {
    const fetch = fakeFetch(() => ok(['EN', 'gatto'], ['EN', 'Il gatto dorme.']));
    const result = await provider(fetch).translate({
      text: 'cat',
      context: 'The cat sleeps.',
      targetLanguage: 'it',
    });
    assert.equal(fetch.calls.length, 1);
    assert.equal(result.text, 'gatto');
  });

  it('reports when the text already is in the target language', async () => {
    const fetch = fakeFetch(() => ok(['IT', 'Ciao mondo']));
    const result = await provider(fetch).translate({ text: 'Ciao mondo', targetLanguage: 'it' });
    assert.equal(result.sameLanguage, true);
    assert.equal(result.text, 'Ciao mondo');
  });

  it('fails with missingKey without calling the API', async () => {
    const fetch = fakeFetch(() => ok(['EN', 'x']));
    await rejectsWith(provider(fetch, '').translate({ text: 'x', targetLanguage: 'it' }), 'missingKey');
    assert.equal(fetch.calls.length, 0);
  });

  it('maps HTTP errors', async () => {
    const cases: Array<[number, string]> = [
      [403, 'invalidKey'],
      [456, 'quota'],
      [429, 'rateLimit'],
      [400, 'badRequest'],
      [503, 'server'],
    ];
    for (const [status, code] of cases) {
      const fetch = fakeFetch(() => ({ status, json: { message: 'nope' } }));
      await rejectsWith(provider(fetch).translate({ text: 'x', targetLanguage: 'it' }), code);
    }
  });

  it('maps network failures', async () => {
    const fetch = fakeFetch(() => new TypeError('fetch failed'));
    await rejectsWith(provider(fetch).translate({ text: 'x', targetLanguage: 'it' }), 'network');
  });

  it('maps timeouts', async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as any;
    const slow = new DeepLProvider({ apiKey: 'k', fetch: hang, timeoutMs: 20 });
    await rejectsWith(slow.translate({ text: 'x', targetLanguage: 'it' }), 'timeout');
  });

  it('maps cancellation', async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as any;
    const controller = new AbortController();
    const pending = new DeepLProvider({ apiKey: 'k', fetch: hang, timeoutMs: 5000 }).translate(
      { text: 'x', targetLanguage: 'it' },
      controller.signal,
    );
    controller.abort();
    await rejectsWith(pending, 'cancelled');
  });
});
