/*
 * Offline model files on disk.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * Layout: <directory>/<pair>/<file>, e.g. models/enit/model.enit.intgemm.alphas.bin
 * (the file names of the registry URLs). Files can also be copied there by
 * hand; downloads only happen when `download()` is called, i.e. when the
 * user asks for it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FetchFn } from '../types';
import { ModelFile, ModelPair } from './registry';

export type ProgressFn = (downloadedBytes: number, totalBytes: number) => void;

export class ModelStore {
  constructor(
    readonly directory: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  filePath(pair: ModelPair, file: ModelFile): string {
    return join(this.directory, pair.key, file.fileName);
  }

  /** All files present with the expected size (hashes are checked on download). */
  isInstalled(pair: ModelPair): boolean {
    return pair.files.every((file) => {
      try {
        return statSync(this.filePath(pair, file)).size === file.size;
      } catch {
        return false;
      }
    });
  }

  missing(pairs: ModelPair[]): ModelPair[] {
    return pairs.filter((pair) => !this.isInstalled(pair));
  }

  read(pair: ModelPair, file: ModelFile): ArrayBuffer {
    const buffer = readFileSync(this.filePath(pair, file));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  /**
   * Download the files of `pair`, verifying size and SHA-256 before they
   * are moved into place.
   */
  async download(pair: ModelPair, onProgress?: ProgressFn, signal?: AbortSignal): Promise<void> {
    const dir = join(this.directory, pair.key);
    mkdirSync(dir, { recursive: true });
    let done = 0;
    for (const file of pair.files) {
      const target = this.filePath(pair, file);
      if (existsSync(target) && statSync(target).size === file.size) {
        done += file.size;
        onProgress?.(done, pair.size);
        continue;
      }
      if (!file.url.startsWith('https://')) {
        throw new Error(`Refusing to download ${file.url}: not an https URL.`);
      }
      const response = await this.fetchFn(file.url, { signal });
      if (!response.ok || !response.body) {
        throw new Error(`Download of ${file.fileName} failed (HTTP ${response.status}).`);
      }
      const hash = createHash('sha256');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) {
          break;
        }
        chunks.push(value);
        hash.update(value);
        size += value.byteLength;
        onProgress?.(done + size, pair.size);
      }
      const digest = hash.digest('hex');
      if (size !== file.size || digest !== file.sha256) {
        throw new Error(`${file.fileName} is corrupted (size or checksum mismatch); try again.`);
      }
      const partial = `${target}.partial`;
      writeFileSync(partial, Buffer.concat(chunks));
      renameSync(partial, target);
      done += file.size;
    }
  }

  remove(pair: ModelPair): void {
    rmSync(join(this.directory, pair.key), { recursive: true, force: true });
  }
}
