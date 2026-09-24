import * as assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Note, changeNotes, notesPath, readNotes, validNote, writeNotes } from '../../src/notes/notesStore';

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

  it('adds, updates and deletes, sorted by line', () => {
    let notes = changeNotes([], 'add', note('b', 9));
    notes = changeNotes(notes, 'add', note('a', 2));
    assert.deepEqual(notes.map((n) => n.id), ['a', 'b']);
    notes = changeNotes(notes, 'update', { ...note('a', 2, 'Edited'), created: 'ignored' });
    assert.equal(notes.find((n) => n.id === 'a')?.text, 'Edited');
    assert.equal(notes.find((n) => n.id === 'a')?.created, '2026-09-24T10:00:00.000Z', 'keeps the creation date');
    assert.deepEqual(changeNotes(notes, 'update', note('missing')), notes, 'unknown notes are not updated');
    assert.deepEqual(changeNotes(notes, 'delete', note('a')).map((n) => n.id), ['b']);
  });
});
