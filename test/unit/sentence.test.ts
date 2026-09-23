import * as assert from 'node:assert/strict';
import { languageName } from '../../src/translation/languages';
import { sentenceAround } from '../../src/webview/sentence';

describe('sentenceAround', () => {
  const text = 'First sentence here. The cat sleeps on the sofa. Last one!';

  it('returns the sentence containing the selection', () => {
    const start = text.indexOf('cat');
    assert.equal(sentenceAround(text, start, start + 3), 'The cat sleeps on the sofa.');
  });

  it('joins sentences spanned by the selection', () => {
    const start = text.indexOf('here');
    const end = text.indexOf('cat') + 3;
    assert.equal(sentenceAround(text, start, end), 'First sentence here. The cat sleeps on the sofa.');
  });

  it('bounds very long text', () => {
    const long = 'word '.repeat(1000);
    assert.ok(sentenceAround(long, 2500, 2504).length <= 1000);
  });

  it('handles empty input', () => {
    assert.equal(sentenceAround('', 0, 0), '');
  });
});

describe('languageName', () => {
  it('names languages in the display locale', () => {
    assert.equal(languageName('en', 'en'), 'English');
    assert.equal(languageName('EN-US', 'it'), 'Inglese');
    assert.equal(languageName('de', 'it'), 'Tedesco');
  });

  it('falls back to the code', () => {
    assert.equal(languageName('', 'en'), '?');
    assert.equal(languageName('qq', 'en'), 'QQ');
  });
});
