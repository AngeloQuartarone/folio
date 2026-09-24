/*
 * Offline bilingual dictionaries, for the other meanings of a single word.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * WikDict (https://www.wikdict.com) builds one SQLite file per direction
 * from Wiktionary (CC BY-SA). Files live in <directory>/dictionaries/, e.g.
 * dictionaries/en-it.sqlite3, and are downloaded only when the user asks.
 * sizes.json lists the available pairs and their size (September 2026), so
 * that offering a download never needs the network. Reading uses
 * node:sqlite, available from VS Code 1.101 on; without it there are simply
 * no other meanings.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { FetchFn } from '../types';
import sizesJson from './sizes.json';

const BASE_URL = 'https://download.wikdict.com/dictionaries/sqlite/2/';
const SQLITE_HEADER = 'SQLite format 3\0';
const MAX_MEANINGS = 12;

export interface DictionaryInfo {
  /** e.g. "en-it" */
  key: string;
  from: string;
  to: string;
  url: string;
  /** Size when sizes.json was made; only shown to the user. */
  size: number;
}

const SIZES = sizesJson as Record<string, number>;

/** The dictionary for `from` → `to`, if WikDict has one. */
export function dictionaryFor(from: string, to: string): DictionaryInfo | undefined {
  const size = SIZES[from + to];
  if (!size) {
    return undefined;
  }
  const key = `${from}-${to}`;
  return { key, from, to, url: `${BASE_URL}${key}.sqlite3`, size };
}

type OpenDatabase = (path: string, readOnly: boolean) => DatabaseSync;

function nodeSqlite(): OpenDatabase | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    return (path, readOnly) => new DatabaseSync(path, { readOnly });
  } catch {
    return null;
  }
}

export class DictionaryStore {
  readonly directory: string;
  private readonly open: OpenDatabase | null;
  private readonly databases = new Map<string, DatabaseSync>();

  constructor(
    directory: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    /** null: no SQLite in this VS Code. */
    open: OpenDatabase | null = nodeSqlite(),
  ) {
    this.directory = join(directory, 'dictionaries');
    this.open = open;
  }

  /** False when this VS Code has no SQLite (older than 1.101). */
  get supported(): boolean {
    return !!this.open;
  }

  filePath(info: DictionaryInfo): string {
    return join(this.directory, `${info.key}.sqlite3`);
  }

  isInstalled(info: DictionaryInfo): boolean {
    return existsSync(this.filePath(info));
  }

  /**
   * Translations of `word`, most important first; the exact spelling, else
   * lower case ("Bold" at the start of a sentence). Undefined when the
   * dictionary is not installed.
   */
  lookup(info: DictionaryInfo, word: string): string[] | undefined {
    if (!this.open || !this.isInstalled(info)) {
      return undefined;
    }
    let database = this.databases.get(info.key);
    if (!database) {
      database = this.open(this.filePath(info), true);
      this.databases.set(info.key, database);
    }
    const query = database.prepare(
      'SELECT trans_list FROM simple_translation WHERE written_rep = ? ORDER BY rel_importance DESC',
    );
    const lower = word.toLowerCase();
    for (const spelling of lower === word ? [word] : [word, lower]) {
      const rows = query.all(spelling) as Array<{ trans_list: string }>;
      const meanings = [
        ...new Set(rows.flatMap((row) => row.trans_list.split('|').map((item) => item.trim()))),
      ].filter(Boolean);
      if (meanings.length) {
        return meanings.slice(0, MAX_MEANINGS);
      }
    }
    return [];
  }

  /** Download, check that it is a WikDict database and index it for lookups. */
  async download(
    info: DictionaryInfo,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.open) {
      throw new Error('This VS Code version cannot read dictionaries (VS Code 1.101 or later is needed).');
    }
    const response = await this.fetchFn(info.url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download of the ${info.key} dictionary failed (HTTP ${response.status}).`);
    }
    const total = Number(response.headers.get('content-length')) || info.size;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      size += value.byteLength;
      onProgress?.(size, total);
    }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, SQLITE_HEADER.length).toString('latin1') !== SQLITE_HEADER) {
      throw new Error(`The ${info.key} dictionary is not a valid file; try again.`);
    }
    mkdirSync(this.directory, { recursive: true });
    const target = this.filePath(info);
    const partial = `${target}.partial`;
    writeFileSync(partial, data);
    try {
      const database = this.open(partial, false);
      try {
        database.prepare('SELECT trans_list FROM simple_translation LIMIT 1').all();
        database.exec('CREATE INDEX IF NOT EXISTS mtp_written_rep ON simple_translation (written_rep)');
      } finally {
        database.close();
      }
    } catch (error) {
      rmSync(partial, { force: true });
      throw new Error(`The ${info.key} dictionary cannot be read: ${error instanceof Error ? error.message : error}`);
    }
    this.close(info.key);
    renameSync(partial, target);
  }

  /** Remove every dictionary from or into `language`. */
  removeLanguage(language: string): void {
    if (!existsSync(this.directory)) {
      return;
    }
    for (const file of readdirSync(this.directory)) {
      const match = /^([a-z]{2})-([a-z]{2})\.sqlite3/.exec(file);
      if (match && (match[1] === language || match[2] === language)) {
        this.close(`${match[1]}-${match[2]}`);
        rmSync(join(this.directory, file), { force: true });
      }
    }
  }

  dispose(): void {
    for (const key of [...this.databases.keys()]) {
      this.close(key);
    }
  }

  private close(key: string): void {
    this.databases.get(key)?.close();
    this.databases.delete(key);
  }
}
