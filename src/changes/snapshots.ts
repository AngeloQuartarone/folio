/*
 * The last version of each document read in Folio, to show what changed
 * since (folio.changes.baseline = lastRead). One snapshot per document,
 * never a history: a gzip file in the extension's storage, read only for
 * the document being previewed. At most 200 documents (the least recently
 * read go first), 90 days, 1 MB each and 20 MB in all.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface Snapshot {
  text: string;
  /** When it was read (ISO date). */
  at: string;
}

export const SNAPSHOT_LIMITS = {
  documents: 200,
  days: 90,
  fileBytes: 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
};

export class SnapshotStore {
  constructor(
    private readonly dir: string,
    private readonly limits = SNAPSHOT_LIMITS,
  ) {}

  async get(uri: string): Promise<Snapshot | undefined> {
    try {
      const data = JSON.parse(gunzipSync(await readFile(this.file(uri))).toString('utf8')) as Snapshot & { uri: string };
      return data.uri === uri && typeof data.text === 'string' ? { text: data.text, at: data.at } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Remember `text` as the version of `uri` read now (too large a text is forgotten instead). */
  async set(uri: string, text: string, at = new Date()): Promise<void> {
    if (Buffer.byteLength(text) > this.limits.fileBytes) {
      await this.delete(uri);
      return;
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(uri), gzipSync(JSON.stringify({ uri, text, at: at.toISOString() })));
    await this.prune();
  }

  async delete(uri: string): Promise<void> {
    await rm(this.file(uri), { force: true });
  }

  /** Drop expired snapshots, then the least recently read until within the limits. */
  async prune(now = Date.now()): Promise<void> {
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((name) => name.endsWith('.json.gz'));
    const files = await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(this.dir, name)).catch(() => undefined);
        return info && { path: join(this.dir, name), time: info.mtimeMs, size: info.size };
      }),
    );
    const kept = files.filter((file): file is NonNullable<typeof file> => !!file).sort((a, b) => b.time - a.time);
    let total = 0;
    for (const [index, file] of kept.entries()) {
      total += file.size;
      const old = now - file.time > this.limits.days * 24 * 3600 * 1000;
      if (old || index >= this.limits.documents || total > this.limits.totalBytes) {
        await rm(file.path, { force: true });
      }
    }
  }

  private file(uri: string): string {
    return join(this.dir, `${createHash('sha1').update(uri).digest('hex')}.json.gz`);
  }
}
