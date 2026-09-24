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
  clone.querySelectorAll('pre, .mermaid, .katex-mathml, .folio-reading-time').forEach((element) => element.remove());
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
export class FocusMode {
  private current: Element | undefined;
  private within: Element | undefined;
  private readonly sentences = typeof CSS !== 'undefined' && 'highlights' in CSS;

  constructor(
    private readonly root: HTMLElement,
    private readonly scope: 'paragraph' | 'sentence' = 'paragraph',
  ) {
    // The highlighted sentence gets the text colour back (the rest of its block is dimmed).
    document.body.style.setProperty('--folio-text', getComputedStyle(root).color);
  }

  onScroll(): void {
    const line = window.innerHeight * 0.42;
    const blocks = Array.from(this.root.children).filter(
      (element) => !element.classList.contains('folio-reading-time'),
    );
    const block = nearest(blocks, line);
    let current = block;
    let within: Element | undefined;
    // In a list, only the item being read.
    if (block && (block.tagName === 'UL' || block.tagName === 'OL')) {
      within = block;
      current = nearest(Array.from(block.children), line) ?? block;
    }
    if (current !== this.current || within !== this.within) {
      this.current?.classList.remove('folio-current', 'folio-sentence-block');
      this.within?.classList.remove('folio-within');
      current?.classList.add('folio-current');
      within?.classList.add('folio-within');
      this.current = current;
      this.within = within;
    }
    if (this.scope === 'sentence') {
      this.highlightSentence(current, line);
    }
  }

  /** After a render the elements are new. */
  reset(): void {
    this.current = undefined;
    this.within = undefined;
    this.onScroll();
  }

  private highlightSentence(block: Element | undefined, line: number): void {
    if (!this.sentences) {
      return;
    }
    const range = block && /^(P|LI|DD|DT|BLOCKQUOTE)$/.test(block.tagName) ? sentenceAt(block, line) : undefined;
    block?.classList.toggle('folio-sentence-block', !!range);
    if (range) {
      CSS.highlights.set('folio-sentence', new Highlight(range));
    } else {
      CSS.highlights.delete('folio-sentence');
    }
  }
}

/** The sentence of `block` on the line at height `y` of the window. */
function sentenceAt(block: Element, y: number): Range | undefined {
  const rect = block.getBoundingClientRect();
  const caret = document.caretRangeFromPoint(rect.left + 4, Math.min(Math.max(y, rect.top + 4), rect.bottom - 4));
  if (!caret || !block.contains(caret.startContainer)) {
    return undefined;
  }
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }
  const index = nodes.indexOf(caret.startContainer as Text);
  const at = index < 0 ? 0 : starts[index] + caret.startOffset;
  // Line breaks of the Markdown source are not sentence ends.
  const segments = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'sentence' }).segment(
    text.replace(/[\r\n]/g, ' '),
  );
  const segment = segments.containing(Math.min(at, Math.max(0, text.length - 1)));
  if (!segment || !segment.segment.trim()) {
    return undefined;
  }
  const point = (offset: number): [Text, number] => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > offset) {
      i--;
    }
    return [nodes[i], Math.min(offset - starts[i], nodes[i].data.length)];
  };
  const range = document.createRange();
  range.setStart(...point(segment.index));
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
