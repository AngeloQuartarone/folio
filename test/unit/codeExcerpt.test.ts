import * as assert from 'node:assert/strict';
import { codeExcerpt, codeLanguage, formatSize, looksLikeText, parseLineFragment } from '../../src/render/codeExcerpt';

describe('code excerpts for link previews', () => {
  it('reads GitHub line fragments', () => {
    assert.deepEqual(parseLineFragment('L10'), { start: 10, end: 10 });
    assert.deepEqual(parseLineFragment('L10-L25'), { start: 10, end: 25 });
    assert.deepEqual(parseLineFragment('L10C3-L25C8'), { start: 10, end: 25 });
    assert.deepEqual(parseLineFragment('L10-25'), { start: 10, end: 25 });
    assert.deepEqual(parseLineFragment('l25-l10'), { start: 10, end: 25 });
    assert.equal(parseLineFragment('L0'), undefined);
    assert.equal(parseLineFragment('setup'), undefined);
    assert.equal(parseLineFragment(''), undefined);
  });

  it('shows the linked lines without their shared indentation', () => {
    const text = 'class A:\n    def f(self):\n        return 1\n\n    def g(self):\n        return 2\n';
    assert.deepEqual(codeExcerpt(text, { start: 2, end: 3 }), {
      code: 'def f(self):\n    return 1',
      start: 2,
      end: 3,
      total: 6,
    });
  });

  it('leaves out blank lines at either end of the linked lines', () => {
    const text = 'a\n\n  b\n  c\n\nd';
    assert.deepEqual(codeExcerpt(text, { start: 2, end: 5 }), { code: 'b\nc', start: 3, end: 4, total: 6 });
    assert.deepEqual(codeExcerpt('\n\n', { start: 1, end: 2 }), { code: '', start: 2, end: 2, total: 2 });
  });

  it('shows the start of a file linked without lines, and stays within the file', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const head = codeExcerpt(text);
    assert.equal(head.start, 1);
    assert.equal(head.end, 20);
    assert.equal(head.total, 50);
    assert.deepEqual(codeExcerpt(text, { start: 45, end: 99 }), {
      code: 'line 45\nline 46\nline 47\nline 48\nline 49\nline 50',
      start: 45,
      end: 50,
      total: 50,
    });
    assert.equal(codeExcerpt(text, { start: 1, end: 50 }).end, 40, 'at most 40 lines');
    assert.equal(codeExcerpt(text, { start: 99, end: 120 }).start, 50);
  });

  it('names the highlighting language of a file', () => {
    assert.equal(codeLanguage('app.ts'), 'ts');
    assert.equal(codeLanguage('build.mjs'), 'js');
    assert.equal(codeLanguage('main.rs'), 'rust');
    assert.equal(codeLanguage('Dockerfile'), 'dockerfile');
    assert.equal(codeLanguage('greet.py'), 'py');
    assert.equal(codeLanguage('LICENSE'), '');
  });

  it('tells text from binary files, and sizes', () => {
    assert.equal(looksLikeText(new TextEncoder().encode('plain text')), true);
    assert.equal(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])), false);
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(1536), '1.5 KB');
    assert.equal(formatSize(20 * 1024 * 1024), '20 MB');
  });
});
