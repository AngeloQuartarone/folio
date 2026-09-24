/*
 * Reading aids: table of contents, reading time and progress, focus mode.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { NoteData, ReadingSettings, WebviewMessage } from '../messages';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WORDS_PER_MINUTE = 230;
const IDLE_MS = 2000;

/**
 * From this width (CSS pixels) the open table of contents sits beside the
 * text, which moves over by DOCK_SIDEBAR; below it, it floats over the text.
 * Keep both in sync with preview.css ("sidebar beside the text").
 */
export const DOCK_MIN_WIDTH = 840;
export const DOCK_SIDEBAR = 274;

// Outline "list" icon (24×24, stroked).
const LIST_PATH = 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01';

export interface StateStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

/** Words of the document, without code blocks. */
function wordCount(root: HTMLElement): number {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('pre, .mermaid, .katex-mathml, .folio-reading-time, .folio-translation').forEach((element) => element.remove());
  return (clone.textContent ?? '').split(/\s+/).filter(Boolean).length;
}

function minutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** How far the page is scrolled, 0 to 1. */
function scrollProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
}

export interface OutlineActions {
  openNote(id: string): void;
  deleteNote(id: string): void;
  /** "Copy for AI": the notes as a message for an AI assistant. */
  copyNotes(): void;
  /** Runs `change`, which opens or closes the panel (in wide windows the text moves aside). */
  toggle(change: () => void): void;
  /** Unfold the section hiding `element`, before going to it. */
  reveal(element: Element): void;
}

export interface NoteEntry {
  note: NoteData;
  /** False when its text is no longer in the document. */
  found: boolean;
}

/**
 * The table of contents: a button in the top-left corner and a floating
 * panel with the headings (the one being read is highlighted) and, when
 * notes are on, a second tab with the notes of the document.
 */
export class Outline {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly list: HTMLElement;
  private readonly tabs: HTMLElement;
  private headings: HTMLElement[] = [];
  private links: HTMLElement[] = [];
  private notes: NoteEntry[] = [];
  private tab: 'contents' | 'notes' = 'contents';
  private words = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: ReadingSettings,
    private readonly state: StateStore,
    private readonly post: (message: WebviewMessage) => void,
    private readonly actions: OutlineActions,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mtp-ui folio-outline-button';
    this.button.title = 'Contents';
    this.button.setAttribute('aria-label', 'Table of contents');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.append(icon(LIST_PATH));
    this.button.addEventListener('click', () => this.setOpen(this.panel.hidden === true));

    this.panel = document.createElement('aside');
    this.panel.className = 'mtp-ui folio-outline';
    this.panel.setAttribute('aria-label', 'Table of contents');
    this.panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'folio-outline-header';
    this.meta = document.createElement('div');
    this.meta.className = 'folio-outline-meta';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'folio-outline-close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.setOpen(false));
    header.append(this.meta, close);

    this.tabs = document.createElement('div');
    this.tabs.className = 'mtp-segmented folio-outline-tabs';
    this.tabs.hidden = !settings.notes;

    this.list = document.createElement('nav');
    this.list.className = 'folio-outline-list';

    this.panel.append(header, this.tabs, this.list);
    document.body.append(this.button, this.panel);

    document.addEventListener('mousemove', () => this.wake());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.panel.hidden) {
        this.setOpen(false);
      }
    });
    // Floating over the text, the panel closes when the text is clicked.
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (
        !this.panel.hidden &&
        this.settings.outlineAutoClose &&
        !this.docked() &&
        target instanceof Node &&
        (this.root.contains(target) || target === document.body)
      ) {
        this.setOpen(false);
      }
    });
    if (this.state.get<boolean>('outlineOpen')) {
      this.setOpen(true, false);
    }
  }

  /** Rebuild after the document was rendered. */
  refresh(): void {
    this.headings = Array.from(this.root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]'));
    this.words = wordCount(this.root);
    this.render();
  }

  setNotes(notes: NoteEntry[]): void {
    this.notes = notes;
    this.renderTabs();
    if (this.tab === 'notes') {
      this.render();
    }
  }

  toggle(): void {
    this.setOpen(this.panel.hidden === true);
  }

  showNotes(): void {
    this.tab = 'notes';
    this.setOpen(true);
    this.render();
  }

  /** Highlight the heading of the section being read, update the time left. */
  onScroll(): void {
    this.updateMeta();
    if (this.tab !== 'contents' || this.panel.hidden) {
      return;
    }
    const line = window.innerHeight * 0.3;
    let current = -1;
    this.headings.forEach((heading, index) => {
      // Headings of a folded section have no position.
      if (heading.getClientRects().length && heading.getBoundingClientRect().top <= line) {
        current = index;
      }
    });
    this.links.forEach((link, index) => link.classList.toggle('folio-current', index === current));
  }

  /** `byUser`: opened or closed now, not reopened after the preview reloaded. */
  private setOpen(open: boolean, byUser = true): void {
    if (open === !this.panel.hidden) {
      return;
    }
    this.actions.toggle(() => {
      this.panel.hidden = !open;
      this.button.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('folio-outline-open', open);
    });
    this.state.set('outlineOpen', open);
    if (byUser && !open) {
      this.post({ type: 'outlineClosed' });
    } else if (byUser && !this.docked()) {
      this.post({ type: 'fitOutline', ...this.fit() });
    }
    if (open) {
      this.render();
    }
    this.wake();
  }

  private docked(): boolean {
    return window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`).matches;
  }

  /**
   * How wide the preview should be for the panel to sit beside the text: as
   * wide as now plus the panel, so the text keeps its width (no wider than
   * the column needs), and at least wide enough to dock at all.
   */
  private fit(): { width: number; wanted: number; needed: number } {
    const width = window.innerWidth;
    const column = parseFloat(getComputedStyle(this.root).maxWidth);
    const roomy = Number.isFinite(column) ? DOCK_SIDEBAR + column : Infinity;
    return { width, wanted: Math.max(DOCK_MIN_WIDTH, Math.min(width + DOCK_SIDEBAR, roomy)), needed: DOCK_MIN_WIDTH };
  }

  private wake(): void {
    this.button.classList.add('mtp-awake');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.panel.hidden && document.activeElement !== this.button) {
        this.button.classList.remove('mtp-awake');
      }
    }, IDLE_MS);
  }

  private renderTabs(): void {
    if (!this.settings.notes) {
      return;
    }
    const make = (id: 'contents' | 'notes', label: string) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mtp-segment';
      tab.textContent = label;
      tab.setAttribute('aria-checked', String(this.tab === id));
      tab.addEventListener('click', () => {
        this.tab = id;
        this.renderTabs();
        this.render();
      });
      return tab;
    };
    this.tabs.replaceChildren(make('contents', 'Contents'), make('notes', `Notes${this.notes.length ? ` · ${this.notes.length}` : ''}`));
  }

  private render(): void {
    this.renderTabs();
    this.updateMeta();
    if (this.panel.hidden) {
      return;
    }
    if (this.tab === 'notes') {
      this.renderNotes();
      return;
    }
    const levels = this.headings.map((heading) => Number(heading.tagName[1]));
    const top = Math.min(...levels, 6);
    this.links = this.headings.map((heading) => {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'folio-outline-item';
      link.style.setProperty('--level', String(Number(heading.tagName[1]) - top));
      link.textContent = heading.textContent?.trim() ?? '';
      link.title = link.textContent;
      link.addEventListener('click', () => {
        this.actions.reveal(heading);
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return link;
    });
    if (!this.links.length) {
      const empty = document.createElement('p');
      empty.className = 'folio-outline-empty';
      empty.textContent = 'This document has no headings.';
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(...this.links);
    this.onScroll();
  }

  private renderNotes(): void {
    if (!this.notes.length) {
      const empty = document.createElement('p');
      empty.className = 'folio-outline-empty';
      empty.textContent = 'Select some text and choose “Add note” to write a note on it.';
      this.list.replaceChildren(empty);
      return;
    }
    const bar = document.createElement('div');
    bar.className = 'folio-outline-notes-bar';
    const open = this.notes.filter(({ note }) => note.status !== 'resolved').length;
    const count = document.createElement('span');
    count.textContent = open ? `${open} open` : 'All resolved';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'folio-outline-copy';
    copy.textContent = 'Copy for AI';
    copy.title = 'Copy the notes as a message to paste into a chat with an AI assistant';
    copy.addEventListener('click', () => this.actions.copyNotes());
    bar.append(count, copy);
    this.list.replaceChildren(
      bar,
      ...this.notes.map(({ note, found }) => {
        const item = document.createElement('div');
        item.className = 'folio-outline-note';
        item.dataset['found'] = String(found);
        if (note.status === 'resolved') {
          item.dataset['resolved'] = 'true';
        }
        const quote = document.createElement('div');
        quote.className = 'folio-outline-quote';
        quote.textContent = note.quote;
        const text = document.createElement('div');
        text.className = 'folio-outline-note-text';
        text.textContent = note.text || '(empty note)';
        item.append(quote, text);
        const replies = note.replies?.length ?? 0;
        const details = [
          note.author,
          replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '',
          note.status === 'resolved' ? 'Resolved' : '',
        ].filter(Boolean);
        if (details.length) {
          const meta = document.createElement('div');
          meta.className = 'folio-outline-note-meta';
          meta.textContent = details.join(' · ');
          item.append(meta);
        }
        if (found) {
          item.tabIndex = 0;
          item.addEventListener('click', () => this.actions.openNote(note.id));
          item.addEventListener('keydown', (event) => event.key === 'Enter' && this.actions.openNote(note.id));
        } else {
          const lost = document.createElement('div');
          lost.className = 'folio-outline-lost';
          lost.textContent = 'Its text is no longer in the document.';
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'mtp-link';
          remove.textContent = 'Delete';
          remove.addEventListener('click', () => this.actions.deleteNote(note.id));
          lost.append(' ', remove);
          item.append(lost);
        }
        return item;
      }),
    );
  }

  private updateMeta(): void {
    const total = minutes(this.words);
    if (!this.settings.progress || !this.words) {
      this.meta.textContent = 'Contents';
      return;
    }
    const left = Math.round(total * (1 - scrollProgress()));
    this.meta.textContent = left > 0 && left < total ? `${total} min read · ${left} min left` : `${total} min read`;
  }
}

/** The reading time above the document and a thin progress bar at the top. */
export class ReadingProgress {
  private readonly bar: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.bar = document.createElement('div');
    this.bar.className = 'mtp-ui folio-progress';
    this.bar.setAttribute('aria-hidden', 'true');
    document.body.append(this.bar);
  }

  refresh(): void {
    const words = wordCount(this.root);
    if (words >= WORDS_PER_MINUTE / 2) {
      const label = document.createElement('div');
      label.className = 'folio-reading-time';
      label.textContent = `${minutes(words)} min read`;
      this.root.prepend(label);
    }
    this.onScroll();
  }

  onScroll(): void {
    // Width, not scaleX: a scaled bar would squash its rounded end.
    this.bar.style.width = `${(scrollProgress() * 100).toFixed(2)}%`;
  }
}

/**
 * Focus mode: everything but the block being read is dimmed; with the
 * "sentence" scope, inside that block everything but the sentence too (with
 * the CSS Custom Highlight API, so the text is not wrapped in elements).
 */
export interface FocusOptions {
  /**
   * What stays clear: `section`, a heading with the paragraphs below it (cut
   * into parts when taller than the window allows); `paragraph`, one block
   * or list item; `sentence`, the sentence being read.
   */
  scope: 'section' | 'paragraph' | 'sentence';
  /**
   * `step`: the wheel (one notch), ↑/↓ and j/k move the focus to the next or
   * previous part, and the page scrolls to it; `scroll`: the focus follows
   * the reading line as the page scrolls.
   */
  navigation: 'step' | 'scroll';
}

/** Height of the reading line, from the top of the window. */
const READING_LINE = 0.42;
/** A section is cut into parts only when it does not fit in this share of the window. */
const SECTION_MAX = 0.9;
/** Wheel movement (pixels) that makes one step: a mouse notch is about 100. */
const WHEEL_STEP = 40;
/** After a step, the wheel waits this long (trackpads keep sending events). */
const WHEEL_PAUSE_MS = 320;

const isHeading = (element: Element) => /^H[1-6]$/.test(element.tagName);
const isList = (element: Element) => element.tagName === 'UL' || element.tagName === 'OL';
const shown = (element: Element) => element.getClientRects().length > 0;

export class FocusMode {
  /** The blocks (or list items) in focus. */
  private current: Element[] = [];
  private active: boolean;
  private readonly sentences = typeof CSS !== 'undefined' && 'highlights' in CSS;
  /** Until then, scroll events come from a step: the focus stays where it moved. */
  private steppingUntil = 0;
  private wheel = 0;
  private wheelPausedUntil = 0;
  private wheelResetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: FocusOptions,
    active: boolean,
  ) {
    this.active = active;
    // The highlighted sentence gets the text colour back (the rest of its block is dimmed).
    document.body.style.setProperty('--folio-text', getComputedStyle(root).color);
    window.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (
        this.stepping() &&
        !event.defaultPrevented &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        !target?.closest?.('input, textarea, select, [contenteditable="true"]')
      ) {
        event.preventDefault();
        this.step(event.key === 'ArrowDown' ? 1 : -1);
      }
    });
    this.apply();
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.apply();
  }

  /** Whether the keys and the wheel move the focus part by part now. */
  stepping(): boolean {
    return this.active && this.options.navigation === 'step';
  }

  onScroll(): void {
    if (!this.active || Date.now() < this.steppingUntil) {
      return;
    }
    const line = window.innerHeight * READING_LINE;
    const units = this.units();
    const piece = nearest(units.flat(), line);
    this.setCurrent(units.find((unit) => piece && unit.includes(piece)) ?? []);
    if (this.options.scope === 'sentence') {
      this.highlightSentence(this.current[0], sentenceAt);
    }
  }

  /** Move the focus to the next (1) or previous (-1) part and scroll to it. */
  step(direction: 1 | -1): void {
    const units = this.units();
    if (!units.length) {
      return;
    }
    let index = units.findIndex((unit) => unit[0] === this.current[0]);
    if (index < 0) {
      this.onScroll();
      index = Math.max(0, units.findIndex((unit) => unit[0] === this.current[0]));
    }
    const next = units[Math.min(units.length - 1, Math.max(0, index + direction))];
    if (!next || next[0] === this.current[0]) {
      return;
    }
    this.setCurrent(next);
    // The sentence is known before the page moves: the first of the block.
    if (this.options.scope === 'sentence') {
      this.highlightSentence(next[0], firstSentence);
    }
    const top = next[0].getBoundingClientRect().top;
    const height = next[next.length - 1].getBoundingClientRect().bottom - top;
    // A short part is centred on the reading line; a tall one starts near the top.
    const target =
      height > window.innerHeight * 0.6
        ? window.scrollY + top - window.innerHeight * 0.18
        : window.scrollY + top + height / 2 - window.innerHeight * READING_LINE;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.steppingUntil = Date.now() + (smooth ? 700 : 100);
    window.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  /** After a render the elements are new. */
  reset(): void {
    this.current = [];
    this.steppingUntil = 0;
    this.onScroll();
  }

  private apply(): void {
    document.body.toggleAttribute('data-focus-mode', this.active);
    if (this.active) {
      this.reset();
    } else {
      this.setCurrent([]);
      if (this.sentences) {
        CSS.highlights.delete('folio-sentence');
      }
    }
  }

  private onWheel(event: WheelEvent): void {
    const target = event.target as Element | null;
    if (
      !this.stepping() ||
      event.ctrlKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      target?.closest?.('.mtp-ui, .mtp-tooltip, .mtp-settings-window, .folio-lightbox')
    ) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    clearTimeout(this.wheelResetTimer);
    this.wheelResetTimer = setTimeout(() => (this.wheel = 0), 200);
    if (now < this.wheelPausedUntil) {
      return;
    }
    this.wheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    if (Math.abs(this.wheel) >= WHEEL_STEP) {
      this.step(this.wheel > 0 ? 1 : -1);
      this.wheel = 0;
      this.wheelPausedUntil = now + WHEEL_PAUSE_MS;
    }
  }

  /** The blocks of the document, without Folio's additions. */
  private blocks(): Element[] {
    return Array.from(this.root.children).filter(
      (element) =>
        shown(element) &&
        !element.classList.contains('folio-reading-time') &&
        !element.classList.contains('folio-translation'),
    );
  }

  /** The parts the focus moves through, each a run of blocks (or list items). */
  private units(): Element[][] {
    const blocks = this.blocks();
    if (this.options.scope !== 'section') {
      return blocks.flatMap((block) => (isList(block) ? Array.from(block.children).filter(shown).map((item) => [item]) : [[block]]));
    }
    // A heading with what follows it; headings in a row stay together.
    const sections: Element[][] = [];
    for (const block of blocks) {
      const last = sections[sections.length - 1];
      if (!last || (isHeading(block) && !last.every(isHeading))) {
        sections.push([block]);
      } else {
        last.push(block);
      }
    }
    // Too tall for the window: cut between blocks (never inside a paragraph
    // or a table), never right after the heading.
    const limit = window.innerHeight * SECTION_MAX;
    return sections.flatMap((section) => {
      const pieces = section.flatMap((block) =>
        // A list is split into its items only when it alone does not fit.
        isList(block) && block.getBoundingClientRect().height > window.innerHeight ? Array.from(block.children).filter(shown) : [block],
      );
      const parts: Element[][] = [];
      let part: Element[] = [];
      let top = 0;
      for (const piece of pieces) {
        const rect = piece.getBoundingClientRect();
        if (part.length && rect.bottom - top > limit && !part.every(isHeading)) {
          parts.push(part);
          part = [];
        }
        if (!part.length) {
          top = rect.top;
        }
        part.push(piece);
      }
      if (part.length) {
        parts.push(part);
      }
      return parts;
    });
  }

  private setCurrent(current: Element[]): void {
    if (current.length === this.current.length && current.every((piece, i) => piece === this.current[i])) {
      return;
    }
    for (const piece of this.current) {
      piece.classList.remove('folio-current', 'folio-sentence-block');
      piece.parentElement?.classList.remove('folio-within');
    }
    for (const piece of current) {
      piece.classList.add('folio-current');
      // In a list, only the items in focus.
      if (piece.parentElement !== this.root) {
        piece.parentElement?.classList.add('folio-within');
      }
    }
    this.current = current;
  }

  private highlightSentence(block: Element | undefined, find: (block: Element, y: number) => Range | undefined): void {
    if (!this.sentences) {
      return;
    }
    const range =
      block && /^(P|LI|DD|DT|BLOCKQUOTE)$/.test(block.tagName) ? find(block, window.innerHeight * READING_LINE) : undefined;
    block?.classList.toggle('folio-sentence-block', !!range);
    if (range) {
      CSS.highlights.set('folio-sentence', new Highlight(range));
    } else {
      CSS.highlights.delete('folio-sentence');
    }
  }
}

/** The first sentence of `block`. */
function firstSentence(block: Element): Range | undefined {
  return sentenceRange(block, 0);
}

/** The sentence of `block` on the line at height `y` of the window. */
function sentenceAt(block: Element, y: number): Range | undefined {
  const rect = block.getBoundingClientRect();
  const caret = document.caretRangeFromPoint(rect.left + 4, Math.min(Math.max(y, rect.top + 4), rect.bottom - 4));
  if (!caret || !block.contains(caret.startContainer)) {
    return undefined;
  }
  return sentenceRange(block, caret.startContainer, caret.startOffset);
}

/** The sentence of `block` at a text position (a text node and offset, or an offset in its text). */
function sentenceRange(block: Element, at: Node | number, offsetInNode = 0): Range | undefined {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }
  if (!text.trim()) {
    return undefined;
  }
  const index = typeof at === 'number' ? -1 : nodes.indexOf(at as Text);
  const offset = typeof at === 'number' ? at : index < 0 ? 0 : starts[index] + offsetInNode;
  // Line breaks of the Markdown source are not sentence ends.
  const segments = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'sentence' }).segment(
    text.replace(/[\r\n]/g, ' '),
  );
  let segment = segments.containing(Math.min(offset, text.length - 1));
  // Starting at the top: the first sentence with words in it.
  if (typeof at === 'number' && segment && !segment.segment.trim()) {
    segment = [...segments].find((candidate) => candidate.segment.trim());
  }
  if (!segment || !segment.segment.trim()) {
    return undefined;
  }
  const point = (position: number): [Text, number] => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > position) {
      i--;
    }
    return [nodes[i], Math.min(position - starts[i], nodes[i].data.length)];
  };
  const lead = segment.segment.length - segment.segment.trimStart().length;
  const range = document.createRange();
  range.setStart(...point(segment.index + lead));
  range.setEnd(...point(segment.index + segment.segment.trimEnd().length));
  return range;
}

/** The element crossing the horizontal line `y`, or the closest one. */
function nearest(elements: Element[], y: number): Element | undefined {
  let best: Element | undefined;
  let bestDistance = Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (!rect.height) {
      continue;
    }
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (distance < bestDistance) {
      best = element;
      bestDistance = distance;
      if (!distance) {
        break;
      }
    }
  }
  return best;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const element = document.createElementNS(SVG_NS, 'path');
  element.setAttribute('d', path);
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', '2');
  element.setAttribute('stroke-linecap', 'round');
  svg.append(element);
  return svg;
}
