import * as assert from 'node:assert/strict';
import { markdownExcerpt } from '../../src/render/excerpt';
import { documentLanguage, proseSample } from '../../src/render/language';

describe('excerpt for previews on hover', () => {
  const text = [
    '---',
    'title: Guide',
    '---',
    '# Guide',
    'Intro.',
    '## Install',
    'Run it.',
    '```sh',
    '## not a heading',
    '```',
    '### Details',
    'More.',
    '## Use',
    'Open it.',
  ].join('\n');

  it('starts after the front matter', () => {
    assert.ok(markdownExcerpt(text, 0).startsWith('# Guide\nIntro.'));
  });

  it('keeps a section and its subsections, up to the next heading of its level', () => {
    const install = markdownExcerpt(text, 5);
    assert.ok(install.startsWith('## Install'));
    assert.ok(install.includes('### Details') && install.includes('## not a heading'), 'subsections and code stay');
    assert.ok(!install.includes('## Use'));
  });

  it('never takes more than the limit', () => {
    assert.equal(markdownExcerpt(text, 0, 3).split('\n').length, 3);
  });
});

describe('document language', () => {
  it('reads the prose, not the markup, code or notes', () => {
    const sample = proseSample('---\nlang: x\n---\n# Titolo\n\n```js\nconst x = 1;\n```\nTesto `code` [link](http://a.b).\n');
    assert.ok(!sample.includes('const') && !sample.includes('code') && !sample.includes('http'));
    assert.ok(sample.includes('Testo') && sample.includes('Titolo'));
  });

  it('detects the language of a document, and says nothing when unsure', () => {
    assert.equal(
      documentLanguage('Questo è un documento scritto in italiano, con frasi abbastanza lunghe da riconoscere la lingua senza dubbi.'),
      'it',
    );
    assert.equal(documentLanguage('```\ncode only\n```'), undefined);
  });
});
