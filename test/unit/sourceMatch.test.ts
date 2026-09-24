import * as assert from 'node:assert/strict';
import { findRenderedText } from '../../src/preview/sourceMatch';

function found(source: string, text: string, occurrence = 0): string | undefined {
  const match = findRenderedText(source, text, occurrence);
  return match && source.slice(match.start, match.end);
}

describe('findRenderedText', () => {
  it('finds the right occurrence of a word', () => {
    const source = 'I left my money at the bank. The river bank was covered in flowers.';
    const second = findRenderedText(source, 'bank', 1)!;
    assert.equal(second.start, source.indexOf('bank', source.indexOf('bank') + 1));
    assert.equal(source.slice(second.start, second.end), 'bank');
  });

  it('falls back to the last occurrence', () => {
    const source = 'one bank, two bank';
    assert.equal(findRenderedText(source, 'bank', 5)!.start, source.lastIndexOf('bank'));
  });

  it('skips emphasis, code and links', () => {
    assert.equal(
      found('Open it with **Cmd+K V** (or **Ctrl+K V**), then select', 'Cmd+K V (or Ctrl+K V), then'),
      'Cmd+K V** (or **Ctrl+K V**), then',
    );
    assert.equal(found('just one word: *library*, *window*', 'library,'), 'library*,');
    assert.equal(found('see [a link](https://example.com) now', 'a link now'), 'a link](https://example.com) now');
    assert.equal(found('run `npm test` first', 'npm test first'), 'npm test` first');
  });

  it('crosses line breaks and block markers', () => {
    assert.equal(found('to see their\ntranslation. The', 'see their translation.'), 'see their\ntranslation.');
    assert.equal(found('> line one\n> line two', 'one line'), 'one\n> line');
    assert.equal(found('- first\n- second', 'first second'), 'first\n- second');
    assert.equal(found('1. first\n2. second', 'first second'), 'first\n2. second');
    assert.equal(found('| bank | river bank |', 'bank river'), 'bank | river');
    assert.equal(found('text\r\nmore', 'text more'), 'text\r\nmore');
    assert.equal(found('A sentence with a footnote.[^1] More', 'footnote. More'), 'footnote.[^1] More');
    assert.equal(
      found('> [!WARNING]\n> Scroll near the bottom of the window', 'Scroll near the bottom'),
      'Scroll near the bottom',
    );
  });

  it('treats regex characters literally', () => {
    assert.equal(found('cost (a+b)*2 [x]', '(a+b)*2'), '(a+b)*2');
    assert.equal(found('price: $5.00 total', '$5.00'), '$5.00');
  });

  it('returns nothing when the text is not there', () => {
    assert.equal(findRenderedText('some text', 'other', 0), undefined);
    assert.equal(findRenderedText('some text', '   ', 0), undefined);
  });
});
