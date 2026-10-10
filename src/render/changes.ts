/*
 * What changed in a Markdown text since an earlier version of it: the lines
 * added or changed (as ranges of the current text, which the preview maps to
 * its blocks), the text removed, and inside a changed paragraph the words
 * that are new. No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { stripNotesBlock } from '../notes/notesBlock';

export interface ChangeHunk {
  /**
   * Lines of the current text (1-based, inclusive) added or changed; for a
   * removal only, `end` is `start - 1`: the text was between lines
   * `start - 1` and `start`.
   */
  start: number;
  end: number;
  /**
   * What this part replaced (empty when it was only added): for a changed
   * paragraph, the whole paragraph as it was.
   */
  removed: string;
  /** In a changed paragraph: runs of new words, to highlight inside it. */
  words: string[];
}

/** Larger texts, or texts this different, are not compared (no marks rather than a slow preview). */
const MAX_LINES = 20_000;
const MAX_EDITS = 2_000;
/** Above this share of new words, a changed paragraph is marked as a whole. */
const WORDS_SHARE = 0.6;

/**
 * The parts of `current` that differ from `before`. Folio's notes block is
 * left out (it changes with every note), and so are changes that only add or
 * remove blank lines or trailing spaces. Undefined when the two are too long
 * or too different to compare quickly.
 */
export function documentChanges(before: string, current: string): ChangeHunk[] | undefined {
  const a = lines(stripNotesBlock(before));
  const b = lines(stripNotesBlock(current));
  if (a.length + b.length > MAX_LINES) {
    return undefined;
  }
  const matches = commonLines(a, b);
  if (!matches) {
    return undefined;
  }
  const hunks: ChangeHunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const [x, y] of [...matches, [a.length, b.length] as [number, number]]) {
    if (x > ai || y > bi) {
      const removed = a.slice(ai, x);
      const added = b.slice(bi, y);
      if ([...removed, ...added].some((line) => line.trim())) {
        // A changed paragraph is shown, and its words compared, whole.
        const changed = removed.some((line) => line.trim()) && added.some((line) => line.trim());
        const was = changed ? paragraph(a, ai, x) : removed;
        const is = changed ? paragraph(b, bi, y) : added;
        hunks.push(hunk(bi + 1, y, was, added, is));
      }
    }
    ai = x + 1;
    bi = y + 1;
  }
  return hunks;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd());
}

/** Lines `from`..`to` (exclusive) of `lines`, widened to the blank lines around them. */
function paragraph(lines: string[], from: number, to: number): string[] {
  while (from > 0 && lines[from - 1].trim()) {
    from--;
  }
  while (to < lines.length && lines[to].trim()) {
    to++;
  }
  return lines.slice(from, to);
}

function hunk(start: number, end: number, removed: string[], added: string[], now = added): ChangeHunk {
  // Blank lines at either end of an added part are not part of the change.
  while (start <= end && !added[0]?.trim()) {
    added.shift();
    start++;
  }
  while (end >= start && !added[added.length - 1]?.trim()) {
    added.pop();
    end--;
  }
  const text = removed.join('\n').trim();
  return { start, end, removed: text, words: text && added.length ? newWords(text, now.join('\n')) : [] };
}

/** Runs of words in `after` that are not in `before` (markup left out). */
export function newWords(before: string, after: string): string[] {
  const words = (text: string) =>
    text
      .split(/\s+/)
      .map((word) => word.replace(/[*_`~#>|[\]()<>]+/g, ''))
      .filter(Boolean);
  const a = words(before);
  const b = words(after);
  const matches = commonLines(a, b);
  if (!matches) {
    return [];
  }
  const runs: string[] = [];
  let run: string[] = [];
  let fresh = 0;
  const matched = new Set(matches.map(([, y]) => y));
  b.forEach((word, i) => {
    if (matched.has(i)) {
      if (run.length) {
        runs.push(run.join(' '));
      }
      run = [];
    } else {
      run.push(word);
      fresh++;
    }
  });
  if (run.length) {
    runs.push(run.join(' '));
  }
  return b.length && fresh / b.length > WORDS_SHARE ? [] : runs;
}

/**
 * The pairs of equal items, in order, of a longest common subsequence
 * (Myers' O(ND) algorithm, after the common start and end are set aside);
 * undefined when the two differ in more than MAX_EDITS places.
 */
export function commonLines(a: string[], b: string[]): Array<[number, number]> | undefined {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail++;
  }
  const middle = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail));
  if (!middle) {
    return undefined;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < head; i++) {
    pairs.push([i, i]);
  }
  for (const [x, y] of middle) {
    pairs.push([x + head, y + head]);
  }
  for (let i = tail; i > 0; i--) {
    pairs.push([a.length - i, b.length - i]);
  }
  return pairs;
}

function myers(a: string[], b: string[]): Array<[number, number]> | undefined {
  const n = a.length;
  const m = b.length;
  if (!n || !m) {
    return [];
  }
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // v for each d, only the diagonals -d..d it can reach: memory O(D²).
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]) ? v[k + 1 + offset] : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));
        return backtrack(trace, a, b);
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  return undefined;
}

function backtrack(trace: Int32Array[], a: string[], b: string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const previous = trace[d - 1];
    const at = (k: number) => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      pairs.push([--x, --y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    pairs.push([--x, --y]);
  }
  return pairs.reverse();
}
