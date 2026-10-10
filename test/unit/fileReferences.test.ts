import * as assert from 'node:assert/strict';
import { referenceHref } from '../../src/webview/fileReferences';

describe('file names written in the text', () => {
  it('reads paths and names with an extension', () => {
    assert.equal(referenceHref('docs/setup.md'), 'docs/setup.md');
    assert.equal(referenceHref('package.json'), 'package.json');
    assert.equal(referenceHref('./notes/today.md'), './notes/today.md');
    assert.equal(referenceHref('../README.md'), '../README.md');
    assert.equal(referenceHref('/src/extension.ts'), '/src/extension.ts');
    assert.equal(referenceHref('.github/workflows/ci.yml'), '.github/workflows/ci.yml');
    assert.equal(referenceHref(' src/webview/ '), 'src/webview/');
    assert.equal(referenceHref('src/webview'), 'src/webview');
  });

  it('turns a line or a range into a #L fragment', () => {
    assert.equal(referenceHref('src/app.ts:42'), 'src/app.ts#L42');
    assert.equal(referenceHref('src/app.ts:10-25'), 'src/app.ts#L10-L25');
    assert.equal(referenceHref('src/app.ts#L7'), 'src/app.ts#L7');
    assert.equal(referenceHref('src/app.ts#L7-L9'), 'src/app.ts#L7-L9');
  });

  it('leaves code that is not a file name alone', () => {
    for (const text of ['true', 'npm install', 'v1.2.3', '1.5', 'a.b()', 'x => x', 'https://example.com/a.md', 'foo bar.md', '.', '..', '/', '#L10']) {
      assert.equal(referenceHref(text), undefined, text);
    }
  });

  it('only proposes names: whether a file is there is for the host to say', () => {
    assert.equal(referenceHref('folio.reading.fontSize'), 'folio.reading.fontSize');
  });
});
