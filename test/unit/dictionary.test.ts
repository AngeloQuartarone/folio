import * as assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DictionaryStore, dictionaryFor } from '../../src/translation/dictionary/dictionaryStore';

/** A tiny WikDict-shaped database, as the bytes a download would return. */
function wikdictBytes(dir: string, rows: Array<[string, string, number]>): Buffer {
  const path = join(dir, 'source.sqlite3');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE simple_translation (written_rep TEXT, trans_list, max_score, rel_importance)');
  const insert = database.prepare('INSERT INTO simple_translation VALUES (?, ?, 0, ?)');
  for (const [word, list, importance] of rows) {
    insert.run(word, list, importance);
  }
  database.close();
  const bytes = readFileSync(path);
  rmSync(path);
  return bytes;
}

const serve = (body: Buffer | string) => async () => new Response(typeof body === 'string' ? body : new Uint8Array(body));

describe('dictionaries', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtp-dict-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('knows the WikDict pairs, but not Estonian or Ukrainian', () => {
    assert.equal(dictionaryFor('en', 'it')?.url, 'https://download.wikdict.com/dictionaries/sqlite/2/en-it.sqlite3');
    assert.ok(dictionaryFor('fr', 'de'));
    assert.equal(dictionaryFor('en', 'uk'), undefined);
    assert.equal(dictionaryFor('et', 'en'), undefined);
  });

  it('downloads, then looks words up by importance', async () => {
    const bytes = wikdictBytes(dir, [
      ['bold', 'audace | ardito', 1],
      ['bold', 'grassetto | audace', 2],
      ['bank', 'banca | riva', 1],
    ]);
    const store = new DictionaryStore(dir, serve(bytes));
    const info = dictionaryFor('en', 'it')!;
    assert.equal(store.lookup(info, 'bold'), undefined, 'not installed yet');
    await store.download(info);
    assert.deepEqual(store.lookup(info, 'bold'), ['grassetto', 'audace', 'ardito']);
    assert.deepEqual(store.lookup(info, 'Bank'), ['banca', 'riva'], 'falls back to lower case');
    assert.deepEqual(store.lookup(info, 'nothing'), []);
    store.dispose();
  });

  it('rejects files that are not WikDict databases', async () => {
    const info = dictionaryFor('en', 'it')!;
    const notSqlite = new DictionaryStore(dir, serve('<html>error</html>'));
    await assert.rejects(notSqlite.download(info), /not a valid file/);
    const empty = new DatabaseSync(join(dir, 'other.sqlite3'));
    empty.exec('CREATE TABLE other (x)');
    empty.close();
    const wrongTables = new DictionaryStore(dir, serve(readFileSync(join(dir, 'other.sqlite3'))));
    await assert.rejects(wrongTables.download(info), /cannot be read/);
    assert.equal(wrongTables.isInstalled(info), false);
  });

  it('removes every dictionary of a language', async () => {
    const bytes = wikdictBytes(dir, [['bold', 'audace', 1]]);
    const store = new DictionaryStore(dir, serve(bytes));
    for (const [from, to] of [['en', 'it'], ['it', 'en'], ['en', 'de']]) {
      await store.download(dictionaryFor(from, to)!);
    }
    store.lookup(dictionaryFor('en', 'it')!, 'bold'); // an open handle
    store.removeLanguage('it');
    assert.equal(existsSync(store.filePath(dictionaryFor('en', 'it')!)), false);
    assert.equal(existsSync(store.filePath(dictionaryFor('it', 'en')!)), false);
    assert.equal(existsSync(store.filePath(dictionaryFor('en', 'de')!)), true);
    store.dispose();
  });

  it('offers nothing without SQLite', () => {
    const store = new DictionaryStore(dir, serve(''), null);
    assert.equal(store.supported, false);
  });
});
