/*
 * Offline translation models (Bergamot project) and how to chain them.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * models.json is a copy of https://bergamot.s3.amazonaws.com/models/index.json
 * (September 2022), shipped with the extension so that listing languages
 * never needs the network. Each entry has the download URL, size and
 * SHA-256 of the model files.
 */
import registryJson from './models.json';

export interface ModelFile {
  /** Registry part: model, lex, vocab, srcvocab, trgvocab. */
  part: string;
  url: string;
  /** File name on disk. */
  fileName: string;
  size: number;
  sha256: string;
}

export interface ModelPair {
  /** e.g. "enit" */
  key: string;
  from: string;
  to: string;
  files: ModelFile[];
  /** Extra Marian options (e.g. gemm-precision for the Ukrainian models). */
  config: Record<string, unknown>;
  size: number;
}

export const PIVOT_LANGUAGE = 'en';

type RawEntry = Record<string, { name?: string; size?: number; expectedSha256Hash?: string } | Record<string, unknown>>;

export const MODEL_PAIRS: ModelPair[] = Object.entries(registryJson as Record<string, RawEntry>).map(
  ([key, entry]) => {
    const files: ModelFile[] = [];
    let config: Record<string, unknown> = {};
    for (const [part, value] of Object.entries(entry)) {
      const file = value as { name?: string; size?: number; expectedSha256Hash?: string };
      if (part === 'config') {
        config = value as Record<string, unknown>;
      } else if (file.name && file.expectedSha256Hash) {
        files.push({
          part,
          url: file.name,
          fileName: file.name.split('/').pop()!,
          size: file.size ?? 0,
          sha256: file.expectedSha256Hash,
        });
      }
    }
    return {
      key,
      from: key.slice(0, 2),
      to: key.slice(2, 4),
      files,
      config,
      size: files.reduce((total, file) => total + file.size, 0),
    };
  },
);

const BY_KEY = new Map(MODEL_PAIRS.map((pair) => [pair.key, pair]));

/** Languages that can be translated from or into (ISO 639-1). */
export const SUPPORTED_LANGUAGES: string[] = [
  ...new Set(MODEL_PAIRS.flatMap((pair) => [pair.from, pair.to])),
].sort();

export function modelPair(key: string): ModelPair | undefined {
  return BY_KEY.get(key);
}

/**
 * The models that let `language` be translated from and into (through
 * English). Empty for English itself.
 */
export function languageModels(language: string): ModelPair[] {
  return [language + PIVOT_LANGUAGE, PIVOT_LANGUAGE + language]
    .map((key) => BY_KEY.get(key))
    .filter((pair): pair is ModelPair => !!pair);
}

/**
 * The model chain for `from` → `to`: a direct model, or two models through
 * English. Undefined when no chain exists.
 */
export function modelChain(from: string, to: string): ModelPair[] | undefined {
  const direct = BY_KEY.get(from + to);
  if (direct) {
    return [direct];
  }
  const outbound = BY_KEY.get(from + PIVOT_LANGUAGE);
  const inbound = BY_KEY.get(PIVOT_LANGUAGE + to);
  return outbound && inbound ? [outbound, inbound] : undefined;
}

export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
