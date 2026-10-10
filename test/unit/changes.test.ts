import * as assert from 'node:assert/strict';
import { commonLines, documentChanges, newWords } from '../../src/render/changes';

describe('changes since an earlier version', () => {
  it('finds a longest common subsequence', () => {
    const a = 'A B C A B B A'.split(' ');
    const b = 'C B A B A C'.split(' ');
    const pairs = commonLines(a, b)!;
    assert.equal(pairs.length, 4, 'the LCS of the classic Myers example has 4 items');
    for (const [x, y] of pairs) {
      assert.equal(a[x], b[y]);
    }
    for (let i = 1; i < pairs.length; i++) {
      assert.ok(pairs[i][0] > pairs[i - 1][0] && pairs[i][1] > pairs[i - 1][1], 'in order');
    }
    assert.deepEqual(commonLines([], ['x']), []);
    assert.deepEqual(commonLines(['x', 'y'], ['x', 'y']), [[0, 0], [1, 1]]);
  });

  it('reports nothing for the same text, blank lines or trailing spaces', () => {
    const text = '# Title\n\nOne.\n\nTwo.\n';
    assert.deepEqual(documentChanges(text, text), []);
    assert.deepEqual(documentChanges(text, '# Title\n\n\nOne.   \n\nTwo.\n'), []);
  });

  it('marks an added paragraph with its lines', () => {
    const before = '# Title\n\nOne.\n\nTwo.\n';
    const after = '# Title\n\nOne.\n\nNew here.\n\nTwo.\n';
    assert.deepEqual(documentChanges(before, after), [{ start: 5, end: 5, removed: '', words: [] }]);
  });

  it('marks a changed paragraph, with what it was and the new words', () => {
    const before = '# Title\n\nThe river is slow.\n';
    const after = '# Title\n\nThe **wide** river is very slow.\n';
    assert.deepEqual(documentChanges(before, after), [
      { start: 3, end: 3, removed: 'The river is slow.', words: ['wide', 'very'] },
    ]);
  });

  it('shows a paragraph changed on one of its lines as it was, whole', () => {
    const before = 'First line of it\nsecond line here.\n';
    const after = 'First line of it\nsecond new line here.\n';
    assert.deepEqual(documentChanges(before, after), [
      { start: 2, end: 2, removed: 'First line of it\nsecond line here.', words: ['new'] },
    ]);
  });

  it('marks where text was removed', () => {
    const before = '# Title\n\nOne.\n\nGone.\n\nTwo.\n';
    const after = '# Title\n\nOne.\n\nTwo.\n';
    assert.deepEqual(documentChanges(before, after), [{ start: 5, end: 4, removed: 'Gone.', words: [] }]);
  });

  it('leaves out the notes block at the end', () => {
    const notes = (text: string) => `\n<!-- folio:notes v1\n${text}\n-->\n`;
    const body = '# Title\n\nOne.\n';
    assert.deepEqual(documentChanges(body + notes('{"id":"a"}'), body + notes('{"id":"a"}\n{"id":"b"}')), []);
  });

  it('marks a paragraph rewritten as a whole without highlighting its words', () => {
    assert.deepEqual(newWords('a short line', 'completely different words here'), []);
    assert.deepEqual(newWords('keep these words', 'keep these new words'), ['new']);
  });

  it('gives up on texts too different to compare quickly', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    assert.equal(documentChanges(a, b), undefined);
  });
});
