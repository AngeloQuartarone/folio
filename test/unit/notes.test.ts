import * as assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdit, findNotesBlock, formatNotesBlock, noteLine, notesEdit, parseNotesBlock, stripNotesBlock } from '../../src/notes/notesBlock';
import { notesPrompt } from '../../src/notes/notesPrompt';
import { Note, changeNotes, mergeNotes, notesPath, readNotes, validNote, writeNotes } from '../../src/notes/notesStore';

const note = (id: string, line = 3, text = 'A note'): Note => ({
  id,
  quote: 'river bank',
  prefix: 'The ',
  suffix: ' was covered',
  line,
  text,
  created: '2026-09-24T10:00:00.000Z',
  updated: '2026-09-24T10:00:00.000Z',
});

describe('notes', () => {
  let dir: string;
  let doc: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'folio-notes-'));
    doc = join(dir, 'doc.md');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps notes next to the document', () => {
    assert.equal(notesPath('/a/doc.md'), '/a/doc.md.folio.json');
    assert.deepEqual(readNotes(doc), []);
    writeNotes(doc, [note('a1')]);
    assert.deepEqual(readNotes(doc), [note('a1')]);
    assert.equal(JSON.parse(readFileSync(notesPath(doc), 'utf8')).version, 1);
  });

  it('removes the file when no notes are left', () => {
    writeNotes(doc, [note('a1')]);
    writeNotes(doc, []);
    assert.equal(existsSync(notesPath(doc)), false);
  });

  it('ignores a damaged file and invalid notes', () => {
    writeFileSync(notesPath(doc), '{ not json');
    assert.deepEqual(readNotes(doc), []);
    writeFileSync(notesPath(doc), JSON.stringify({ notes: [note('ok'), { id: 'bad id!', quote: 'x' }] }));
    assert.deepEqual(readNotes(doc).map((n) => n.id), ['ok']);
  });

  it('validates what the webview sends', () => {
    assert.ok(validNote(note('a1')));
    assert.equal(validNote({ ...note('a1'), id: '../x' }), undefined);
    assert.equal(validNote({ ...note('a1'), quote: '  ' }), undefined);
    assert.equal(validNote({ ...note('a1'), text: 'x'.repeat(5001) }), undefined);
    assert.equal(validNote({ ...note('a1'), line: 0 }), undefined);
    assert.equal(validNote(null), undefined);
  });

  it('adds, edits, answers, resolves and deletes, sorted by line', () => {
    const now = '2026-09-25T08:00:00.000Z';
    let notes = changeNotes([], { action: 'add', note: note('b', 9) }, now);
    notes = changeNotes(notes, { action: 'add', note: note('a', 2) }, now);
    assert.deepEqual(notes.map((n) => n.id), ['a', 'b']);
    notes = changeNotes(notes, { action: 'edit', id: 'a', text: 'Edited' }, '2026-09-26T00:00:00.000Z');
    const edited = notes.find((n) => n.id === 'a')!;
    assert.equal(edited.text, 'Edited');
    assert.equal(edited.created, now, 'keeps the creation date');
    assert.equal(edited.updated, '2026-09-26T00:00:00.000Z');
    assert.deepEqual(changeNotes(notes, { action: 'edit', id: 'missing', text: 'x' }), notes, 'unknown notes are not changed');
    notes = changeNotes(notes, { action: 'reply', id: 'a', reply: { author: 'Claude', text: 'Done', created: now } });
    assert.deepEqual(notes.find((n) => n.id === 'a')!.replies, [{ author: 'Claude', text: 'Done', created: now }]);
    notes = changeNotes(notes, { action: 'resolve', id: 'a' });
    assert.equal(notes.find((n) => n.id === 'a')!.status, 'resolved');
    notes = changeNotes(notes, { action: 'reopen', id: 'a' });
    assert.equal('status' in notes.find((n) => n.id === 'a')!, false);
    assert.deepEqual(changeNotes(notes, { action: 'delete', id: 'a' }).map((n) => n.id), ['b']);
  });

  it('reads replies, status and author, and is lenient only when asked', () => {
    const full = validNote({
      ...note('a1'),
      author: ' Angelo ',
      status: 'resolved',
      replies: [{ author: 'Claude', text: 'Fixed' }, { text: '' }, 'junk'],
    })!;
    assert.equal(full.author, 'Angelo');
    assert.equal(full.status, 'resolved');
    assert.equal(full.replies?.length, 1);
    assert.equal(full.replies?.[0].author, 'Claude');
    assert.equal(validNote({ ...note('a1'), status: 'open' })!.status, undefined);
    const handWritten = { id: 'n9', quote: 'river bank', text: 'Added by hand' };
    assert.equal(validNote(handWritten), undefined);
    const lenient = validNote(handWritten, true)!;
    assert.deepEqual([lenient.prefix, lenient.suffix, lenient.line], ['', '', 1]);
  });

  it('merges notes from two places without duplicates', () => {
    assert.deepEqual(mergeNotes([note('a', 5, 'doc')], [note('a', 5, 'old'), note('b', 1)]).map((n) => `${n.id}:${n.text}`), [
      'b:A note',
      'a:doc',
    ]);
  });
});

describe('notes block', () => {
  const doc = '# Title\n\nThe river bank was covered in flowers.\n';

  it('adds a block at the end, after a blank line, and reads it back', () => {
    const text = applyEdit(doc, notesEdit(doc, { notes: [note('a1')], extra: [] }));
    assert.ok(text.startsWith(doc + '\n<!-- folio:notes v1\n'), text);
    assert.ok(text.endsWith('\n-->\n'));
    assert.deepEqual(parseNotesBlock(text).notes, [note('a1')]);
    assert.equal(text.split('\n').filter((line) => line.startsWith('{')).length, 1, 'one line per note');
  });

  it('explains itself to whoever reads the file', () => {
    const block = formatNotesBlock({ notes: [], extra: [] });
    assert.match(block, /Folio/);
    assert.match(block, /"replies"/);
    assert.match(block, /"status": "resolved"/);
  });

  it('replaces the block in place and removes it when no notes are left', () => {
    const one = applyEdit(doc, notesEdit(doc, { notes: [note('a1')], extra: [] }));
    const two = applyEdit(one, notesEdit(one, { notes: [note('a1'), note('b2', 3, 'Second')], extra: [] }));
    assert.equal(two.indexOf('<!-- folio:notes'), one.indexOf('<!-- folio:notes'));
    assert.equal(parseNotesBlock(two).notes.length, 2);
    assert.equal(applyEdit(two, notesEdit(two, { notes: [], extra: [] })), doc);
    assert.equal(notesEdit(doc, { notes: [], extra: [] }), undefined);
  });

  it('keeps Windows line endings', () => {
    const crlf = doc.replace(/\n/g, '\r\n');
    const text = applyEdit(crlf, notesEdit(crlf, { notes: [note('a1')], extra: [] }, '\r\n'), );
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'no bare line feeds');
    assert.deepEqual(parseNotesBlock(text).notes, [note('a1')]);
    assert.equal(applyEdit(text, notesEdit(text, { notes: [], extra: [] }, '\r\n')), crlf);
  });

  it('never ends the HTML comment early', () => {
    const tricky = { ...note('a1'), text: 'a --> b --!> c' };
    assert.equal(noteLine(tricky).includes('-->'), false);
    const text = applyEdit(doc, notesEdit(doc, { notes: [tricky], extra: [] }));
    assert.equal(parseNotesBlock(text).notes[0].text, 'a --> b --!> c');
  });

  it('reads notes an AI edited: replies, resolved, notes added by hand; keeps broken lines', () => {
    const text = [
      '# Doc',
      '',
      '<!-- folio:notes v1',
      'Some instructions.',
      JSON.stringify({ ...note('a1'), status: 'resolved', replies: [{ author: 'Claude', text: 'Rewrote it.' }] }),
      '{"id":"n2","quote":"flowers","text":"Nice"}',
      '{"id": "broken", "quote": ',
      JSON.stringify(note('a1', 3, 'duplicate id')),
      '-->',
      '',
    ].join('\n');
    const block = parseNotesBlock(text);
    assert.deepEqual(block.notes.map((n) => n.id), ['a1', 'n2']);
    assert.equal(block.notes[0].replies?.[0].text, 'Rewrote it.');
    assert.equal(block.extra.length, 2, 'the broken line and the duplicate are kept');
    const rewritten = applyEdit(text, notesEdit(text, block));
    assert.ok(rewritten.includes('{"id": "broken", "quote":'));
  });

  it('only counts a block that ends the document and starts a line', () => {
    assert.equal(findNotesBlock('text\n<!-- folio:notes v1\n-->\nmore text'), undefined);
    assert.equal(findNotesBlock('Example: <!-- folio:notes v1 -->'), undefined);
    assert.equal(findNotesBlock('```\n<!-- folio:notes v1\n-->\n```\n'), undefined);
    assert.ok(findNotesBlock('<!-- folio:notes v1\n-->'));
  });

  it('strips the block without moving the lines above it', () => {
    const text = applyEdit(doc, notesEdit(doc, { notes: [note('a1')], extra: [] }));
    const stripped = stripNotesBlock(text);
    assert.equal(stripped.split('\n').length, text.split('\n').length);
    assert.ok(stripped.startsWith(doc));
    assert.equal(stripped.includes('folio'), false);
    assert.equal(stripNotesBlock(doc), doc);
  });
});

describe('notes prompt', () => {
  it('lists open notes with their replies and says how to answer', () => {
    const text = notesPrompt(
      [
        { ...note('a1', 12, 'Is this right?\nCheck the source.'), author: 'Angelo', replies: [{ author: 'Claude', text: 'Yes.', created: '' }] },
        { ...note('b2'), status: 'resolved' },
      ],
      { path: 'docs/guide.md', storage: 'document' },
    );
    assert.match(text, /docs\/guide\.md/);
    assert.match(text, /1\. On "river bank" \(around line 12\)/);
    assert.match(text, /Note from Angelo: Is this right\?\n   Check the source\./);
    assert.match(text, /Reply from Claude: Yes\./);
    assert.match(text, /folio:notes/);
    assert.match(text, /1 resolved note is not listed/);
    assert.doesNotMatch(notesPrompt([note('a1')], { path: 'a.md', storage: 'sidecar' }), /folio:notes/);
  });
});
