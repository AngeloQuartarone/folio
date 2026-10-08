/*
 * Lines of a source file, for the preview shown when the pointer rests on a
 * link to it (`src/app.ts`, `src/app.ts#L10-L25`). No VS Code API: unit
 * tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** 1-based, inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export interface CodeExcerpt {
  code: string;
  /** The lines shown (1-based, inclusive) and how many the file has. */
  start: number;
  end: number;
  total: number;
}

/** Lines shown from the top of a file linked without a line. */
const HEAD_LINES = 20;
/** Lines shown at most for a linked range. */
const MAX_LINES = 40;

/**
 * The lines a link fragment points to, as GitHub writes them: `L10`,
 * `L10-L25`, `L10C3-L25C8` (columns are ignored); also `L10-25`.
 */
export function parseLineFragment(fragment: string): LineRange | undefined {
  const match = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(fragment.trim());
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return start >= 1 ? { start: Math.min(start, end), end: Math.max(start, end) } : undefined;
}

/**
 * The lines of `range` (no more than 40, without the blank lines at either
 * end and the indentation they all share), or the first lines of the file
 * without one.
 */
export function codeExcerpt(text: string, range?: LineRange): CodeExcerpt {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const total = lines.length;
  let start = Math.min(Math.max(1, range?.start ?? 1), total);
  let end = range ? Math.min(range.end, total, start + MAX_LINES - 1) : Math.min(total, HEAD_LINES);
  while (start < end && !lines[start - 1].trim()) {
    start++;
  }
  while (end > start && !lines[end - 1].trim()) {
    end--;
  }
  let shown = lines.slice(start - 1, end);
  const indent = Math.min(
    ...shown.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length),
  );
  if (Number.isFinite(indent) && indent > 0) {
    shown = shown.map((line) => line.slice(indent));
  }
  return { code: shown.join('\n'), start, end, total };
}

/** Extensions and file names whose Prism language has another name. */
const LANGUAGES: Record<string, string> = {
  mjs: 'js',
  cjs: 'js',
  mts: 'ts',
  cts: 'ts',
  rs: 'rust',
  zsh: 'bash',
  h: 'c',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  m: 'objectivec',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  pl: 'perl',
  fs: 'fsharp',
  jl: 'julia',
  ml: 'ocaml',
  clj: 'clojure',
  proto: 'protobuf',
  tf: 'hcl',
  vue: 'markup',
  svelte: 'markup',
  htm: 'html',
  xhtml: 'html',
  svg: 'xml',
  plist: 'xml',
  csproj: 'xml',
  mdx: 'md',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  '.editorconfig': 'editorconfig',
  '.gitignore': 'ignore',
};

/** The highlighting language for a file name (the renderer checks Prism knows it). */
export function codeLanguage(fileName: string): string {
  const name = fileName.toLowerCase();
  if (LANGUAGES[name]) {
    return LANGUAGES[name];
  }
  const extension = /\.([^.]+)$/.exec(name)?.[1] ?? '';
  return LANGUAGES[extension] ?? extension;
}

/** Whether these bytes (the start of a file) are text: no NUL byte. */
export function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8000).includes(0);
}

/** "12 KB", "1.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}
