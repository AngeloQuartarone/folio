import * as assert from 'node:assert/strict';
import { frontMatterHtml, parseFrontMatter } from '../../src/render/frontMatter';
import { MarkdownRenderer } from '../../src/render/markdownRenderer';
import { parseWikiLink } from '../../src/render/wikiLinks';

const renderer = (options: Partial<ConstructorParameters<typeof MarkdownRenderer>[0]> = {}) =>
  new MarkdownRenderer({ breaks: false, math: false, mermaid: false, wikiLinks: true, ...options });

describe('wiki links', () => {
  it('reads the forms Obsidian writes', () => {
    assert.deepEqual(parseWikiLink('Page'), { href: 'Page.md', label: 'Page', image: false });
    assert.deepEqual(parseWikiLink('My Page|see this'), { href: 'My%20Page.md', label: 'see this', image: false });
    assert.deepEqual(parseWikiLink('Page#Getting Started'), { href: 'Page.md#getting-started', label: 'Page › Getting Started', image: false });
    assert.deepEqual(parseWikiLink('#Local heading'), { href: '#local-heading', label: 'Local heading', image: false });
    assert.deepEqual(parseWikiLink('notes/todo.md'), { href: 'notes/todo.md', label: 'notes/todo.md', image: false });
    assert.deepEqual(parseWikiLink('diagram.png', true), { href: 'diagram.png', label: 'diagram.png', image: true });
    assert.equal(parseWikiLink(' '), undefined);
    assert.equal(parseWikiLink('a]b'), undefined);
  });

  it('renders links and images, but not inside code', () => {
    const html = renderer().render('See [[Other#Second|there]] and ![[image.svg]], not `[[code]]`.').html;
    assert.match(html, /<a href="Other\.md#second" class="folio-wikilink">there<\/a>/);
    assert.match(html, /<img src="image\.svg" alt="image\.svg"/);
    assert.match(html, /<code>\[\[code\]\]<\/code>/);
  });

  it('can be turned off', () => {
    assert.match(renderer({ wikiLinks: false }).render('[[Page]]').html, /\[\[Page\]\]/);
  });
});

describe('front matter header', () => {
  const text = '---\ntitle: "A guide"\ntags: [reading, vscode]\nauthors:\n  - Ada\n  - Linus\ndraft:\nnested:\n  key: value\n---\n# Body\n';

  it('reads simple entries and lists', () => {
    const front = parseFrontMatter(text)!;
    assert.equal(front.lines, 10);
    assert.deepEqual(front.entries, [
      { key: 'title', value: 'A guide' },
      { key: 'tags', value: ['reading', 'vscode'] },
      { key: 'authors', value: ['Ada', 'Linus'] },
      { key: 'nested', value: 'key: value' },
    ]);
    assert.equal(parseFrontMatter('# No front matter'), undefined);
    assert.deepEqual(parseFrontMatter('+++\ntitle = "T"\n+++\n')?.entries, [{ key: 'title', value: 'T' }]);
  });

  it('is escaped, and keeps the lines of the body where they were', () => {
    const html = frontMatterHtml({ lines: 3, entries: [{ key: 'x', value: '<script>' }] });
    assert.match(html, /&lt;script&gt;/);
    const rendered = renderer({ frontMatter: 'show' }).render(text).html;
    assert.match(rendered, /<dl class="folio-front-matter" data-source-line="1" data-source-end="10">/);
    assert.match(rendered, /<span class="folio-tag">vscode<\/span>/);
    assert.match(rendered, /<h1 id="body" data-source-line="11"/);
    assert.doesNotMatch(renderer().render(text).html, /folio-front-matter/, 'hidden by default');
  });
});
