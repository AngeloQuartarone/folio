import * as assert from 'node:assert/strict';
import { MarkdownRenderer, parseFenceLanguage } from '../../src/render/markdownRenderer';
import { stripFrontMatter } from '../../src/render/plugins';
import { slugify } from '../../src/render/slugify';

const renderer = new MarkdownRenderer({ breaks: false, math: true, mermaid: true });
const render = (text: string) => renderer.render(text).html;

describe('MarkdownRenderer', () => {
  it('tags blocks with their 1-based first and last source line', () => {
    const html = render('# Title\n\nParagraph\non two lines\n\n- item');
    assert.match(html, /<h1 id="title" data-source-line="1" data-source-end="1">/);
    assert.match(html, /<p data-source-line="3" data-source-end="4">Paragraph/);
    assert.match(html, /<ul data-source-line="6" data-source-end="6">/);
  });

  it('renders GFM tables', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    assert.match(html, /<table data-source-line="1" data-source-end="3">/);
    assert.match(html, /<td>1<\/td>/);
  });

  it('highlights fenced code with Prism and keeps the source line', () => {
    const html = render('text\n\n```ts\nconst a = 1;\n```');
    assert.match(html, /<pre data-source-line="3" data-source-end="5" class="language-ts"><code class="language-ts">/);
    assert.match(html, /<span class="token keyword">const<\/span>/);
  });

  it('escapes code in unknown languages', () => {
    const html = render('```nope\n<b>x</b>\n```');
    assert.match(html, /class="language-text"/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  it('turns mermaid fences into diagram containers', () => {
    const result = renderer.render('```mermaid\ngraph TD; A-->B;\n```');
    assert.match(result.html, /<div class="mermaid" data-source-line="1" data-source-end="3">graph TD; A--&gt;B;/);
    assert.equal(result.hasMermaid, true);
  });

  it('leaves mermaid as code when disabled', () => {
    const plain = new MarkdownRenderer({ breaks: false, math: false, mermaid: false });
    const result = plain.render('```mermaid\ngraph TD;\n```');
    assert.equal(result.hasMermaid, false);
    assert.match(result.html, /<pre/);
  });

  it('renders inline and block math with KaTeX', () => {
    const result = renderer.render('$x^2$\n\n$$\n\\int x\n$$');
    assert.equal(result.hasMath, true);
    assert.match(result.html, /class="katex"/);
    assert.match(result.html, /class="katex-display"/);
  });

  it('renders task lists as disabled checkboxes', () => {
    const html = render('- [x] done\n- [ ] todo');
    assert.match(html, /class="task-list-item-checkbox" checked="" disabled=""/);
  });

  it('renders footnotes, emoji, sub/sup and mark', () => {
    const html = render('H~2~O x^2^ ==hi== :smile: [^1]\n\n[^1]: note');
    assert.match(html, /<sub>2<\/sub>/);
    assert.match(html, /<sup>2<\/sup>/);
    assert.match(html, /<mark>hi<\/mark>/);
    assert.match(html, /😄/);
    assert.match(html, /class="footnotes"/);
  });

  it('renders GitHub alerts', () => {
    const html = render('> [!WARNING]\n> Careful');
    assert.match(html, /<blockquote class="markdown-alert markdown-alert-warning"/);
    assert.match(html, /<p class="markdown-alert-title">Warning<\/p>/);
    assert.match(html, /Careful/);
    assert.doesNotMatch(html, /\[!WARNING\]/);
  });

  it('gives duplicate headings unique ids', () => {
    const html = render('# Intro\n# Intro');
    assert.match(html, /id="intro"/);
    assert.match(html, /id="intro-1"/);
  });

  it('hides front matter without shifting line numbers', () => {
    const result = renderer.render('---\ntitle: x\n---\n# Heading');
    assert.doesNotMatch(result.html, /title: x/);
    assert.match(result.html, /data-source-line="4"/);
    assert.equal(result.lineCount, 4);
  });

  it('passes image sources through resolveImageSrc', () => {
    const html = renderer.render('![a](/img.png)', {
      resolveImageSrc: (src) => `resolved:${src}`,
    }).html;
    assert.match(html, /src="resolved:\/img.png"/);
  });
});

describe('helpers', () => {
  it('parseFenceLanguage strips attributes', () => {
    assert.equal(parseFenceLanguage('js {.line-numbers}'), 'js');
    assert.equal(parseFenceLanguage('Python'), 'python');
    assert.equal(parseFenceLanguage(''), '');
  });

  it('slugify follows GitHub', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('Perché è così'), 'perché-è-così');
    assert.equal(slugify('a_b-c'), 'a_b-c');
  });

  it('hides the notes block and keeps the source lines', () => {
    const text = '# Title\n\nBody\n\n<!-- folio:notes v1\nNotes left with Folio.\n{"id":"a","quote":"Body","text":"x"}\n-->\n';
    const result = renderer.render(text);
    assert.equal(result.html.includes('folio'), false);
    assert.equal(result.lineCount, text.split('\n').length);
    assert.match(result.html, /<p data-source-line="3"/);
  });

  it('stripFrontMatter only strips a leading block', () => {
    assert.equal(stripFrontMatter('text\n---\na\n---'), 'text\n---\na\n---');
    assert.equal(stripFrontMatter('---\na: 1\n---\nbody'), '\n\n\nbody');
    assert.equal(stripFrontMatter('---\nunterminated'), '---\nunterminated');
  });
});
