import * as assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '../../src/changes/snapshots';

describe('snapshots of the last version read', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'folio-snapshots-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps one compressed snapshot per document', async () => {
    const store = new SnapshotStore(dir);
    await store.set('file:///a.md', 'first');
    await store.set('file:///a.md', 'second'.repeat(1000));
    await store.set('file:///b.md', 'other');
    assert.equal((await store.get('file:///a.md'))?.text, 'second'.repeat(1000));
    assert.equal((await store.get('file:///b.md'))?.text, 'other');
    assert.equal(await store.get('file:///c.md'), undefined);
    const files = readdirSync(dir);
    assert.equal(files.length, 2);
  });

  it('keeps the most recently read documents within the limits', async () => {
    const store = new SnapshotStore(dir, { documents: 2, days: 90, fileBytes: 1000, totalBytes: 1_000_000 });
    await store.set('file:///1.md', 'one');
    await store.set('file:///2.md', 'two');
    // Both read a minute ago; then 2.md again, and a third document.
    const old = new Date(Date.now() - 60_000);
    readdirSync(dir).forEach((name) => utimesSync(join(dir, name), old, old));
    await store.set('file:///2.md', 'two again');
    await store.set('file:///3.md', 'three');
    assert.equal(readdirSync(dir).length, 2);
    assert.equal(await store.get('file:///1.md'), undefined, 'the least recently read goes');
    assert.equal((await store.get('file:///2.md'))?.text, 'two again');
    assert.equal((await store.get('file:///3.md'))?.text, 'three');
  });

  it('forgets a document too large to keep, and expired snapshots', async () => {
    const store = new SnapshotStore(dir, { documents: 10, days: 1, fileBytes: 10, totalBytes: 1_000_000 });
    await store.set('file:///big.md', 'small');
    await store.set('file:///big.md', 'far too large for the limit');
    assert.equal(await store.get('file:///big.md'), undefined);
    await store.set('file:///old.md', 'old');
    await store.prune(Date.now() + 2 * 24 * 3600 * 1000);
    assert.equal(await store.get('file:///old.md'), undefined);
  });
});
