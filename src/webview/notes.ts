/*
 * Notes in the margin: highlighted text with a note, a pin next to it, and a
 * card to read, edit or delete it. The host keeps the notes in
 * `<file>.folio.json` (src/notes/notesStore.ts).
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * A note is found again through the text it quotes (with a little context
 * before and after), first in the block it was written in, then anywhere in
 * the document, so it survives edits around it.
 */
import type { NoteData, WebviewMessage } from '../messages';
import { FOLIO_UI } from './documentTools';
import type { NoteEntry } from './reading';

const CONTEXT = 32;
const SKIP = `${FOLIO_UI}, .katex-mathml, script, style`;
const GAP = 8;
const EDGE = 8;

// ------------------------------------------------------------ text index

interface TextIndex {
  /** The text with every run of whitespace collapsed to one space. */
  text: string;
  /** Where each character of `text` is in the DOM. */
  points: Array<[Text, number]>;
}

function indexText(root: Node): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let text = '';
  const points: Array<[Text, number]> = [];
  let space = true;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      const char = node.data[i];
      if (/\s/.test(char)) {
        if (!space) {
          text += ' ';
          points.push([node, i]);
          space = true;
        }
      } else {
        text += char;
        points.push([node, i]);
        space = false;
      }
    }
  }
  return { text, points };
}

/** Length of the common end of `a` and the common start of `b`, for scoring. */
function commonEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
    n++;
  }
  return n;
}

function commonStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) {
    n++;
  }
  return n;
}

// ----------------------------------------------------------------- notes

interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  line: number;
}

export class Notes {
  private notes: NoteData[] = [];
  private readonly layer: HTMLElement;
  private readonly card: HTMLElement;
  private cardFor: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private readonly sourceUri: () => string,
    private readonly onChange: (entries: NoteEntry[]) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'mtp-ui folio-note-layer';
    this.card = document.createElement('div');
    this.card.className = 'mtp-tooltip folio-note-card';
    this.card.hidden = true;
    document.body.append(this.layer, this.card);

    root.addEventListener('click', (event) => {
      const mark = (event.target as Element | null)?.closest?.('mark.folio-note') as HTMLElement | null;
      if (mark && window.getSelection()?.isCollapsed) {
        this.open(mark.dataset['note']!);
      }
    });
    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node;
      if (!this.card.hidden && !this.card.contains(target) && !this.layer.contains(target)) {
        this.closeCard();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.card.hidden) {
        this.closeCard();
      }
    });
    window.addEventListener('resize', () => this.layout());
    new ResizeObserver(() => this.layout()).observe(root);
  }

  setNotes(notes: NoteData[]): void {
    this.notes = notes;
    this.render();
  }

  /** Highlight every note's text again (after a render or a change). */
  render(): void {
    for (const mark of Array.from(this.root.querySelectorAll('mark.folio-note'))) {
      mark.replaceWith(...Array.from(mark.childNodes));
    }
    this.root.normalize();
    const entries: NoteEntry[] = this.notes.map((note) => ({ note, found: this.highlight(note) }));
    this.layout();
    this.onChange(entries);
    if (this.cardFor && !this.notes.some((note) => note.id === this.cardFor)) {
      this.closeCard();
    }
  }

  /** Where `range` sits in the document, to write a note on it. */
  anchorFor(range: Range): Anchor | undefined {
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const block = start?.closest<HTMLElement>('[data-source-line]');
    if (!block || !this.root.contains(block)) {
      return undefined;
    }
    const { text, points } = indexText(block);
    let first = -1;
    let last = -1;
    points.forEach(([node, offset], i) => {
      if (range.comparePoint(node, offset) === 0 && range.comparePoint(node, offset + 1) === 0) {
        if (first < 0) {
          first = i;
        }
        last = i;
      }
    });
    while (first >= 0 && first <= last && text[first] === ' ') {
      first++;
    }
    while (last >= first && text[last] === ' ') {
      last--;
    }
    if (first < 0 || last < first) {
      return undefined;
    }
    return {
      quote: text.slice(first, last + 1),
      prefix: text.slice(Math.max(0, first - CONTEXT), first),
      suffix: text.slice(last + 1, last + 1 + CONTEXT),
      line: Number(block.dataset['sourceLine']),
    };
  }

  canAnnotate(range: Range): boolean {
    return !!this.anchorFor(range);
  }

  /** Ask for the text of a new note on `range`. */
  compose(range: Range): void {
    const anchor = this.anchorFor(range);
    if (!anchor) {
      return;
    }
    const rect = range.getBoundingClientRect();
    this.cardFor = undefined;
    this.edit('', rect, (text) => {
      const now = new Date().toISOString();
      const note: NoteData = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        ...anchor,
        text,
        created: now,
        updated: now,
      };
      this.send('add', note);
    });
  }

  /** Show a note's card next to its text. */
  open(id: string, scrolled = false): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    const mark = this.root.querySelector<HTMLElement>(`mark.folio-note[data-note="${CSS.escape(id)}"]`);
    if (!note || !mark) {
      return;
    }
    const rect = mark.getBoundingClientRect();
    if (!scrolled && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => this.open(id, true), 350);
      return;
    }
    this.cardFor = id;
    this.card.dataset['state'] = 'view';
    const text = document.createElement('div');
    text.className = 'folio-note-text';
    text.textContent = note.text || 'Empty note';
    const meta = document.createElement('div');
    meta.className = 'folio-note-meta';
    meta.textContent = new Date(note.updated).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const actions = document.createElement('div');
    actions.className = 'folio-note-actions';
    actions.append(
      cardButton('Edit', () => this.edit(note.text, rect, (value) => this.send('update', { ...note, text: value }))),
      cardButton('Delete', () => {
        this.send('delete', note);
        this.closeCard();
      }, 'folio-danger'),
    );
    this.card.replaceChildren(text, meta, actions);
    this.show(rect);
  }

  delete(id: string): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (note) {
      this.send('delete', note);
    }
  }

  private edit(value: string, rect: DOMRect, save: (text: string) => void): void {
    this.card.dataset['state'] = 'edit';
    const input = document.createElement('textarea');
    input.className = 'folio-note-input';
    input.placeholder = 'Write a note…';
    input.value = value;
    input.rows = 3;
    const submit = () => {
      save(input.value.trim());
      this.closeCard();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    const actions = document.createElement('div');
    actions.className = 'folio-note-actions';
    const hint = document.createElement('span');
    hint.className = 'folio-note-hint';
    hint.textContent = navigator.platform.startsWith('Mac') ? '⌘↩ to save' : 'Ctrl+Enter to save';
    actions.append(hint, cardButton('Cancel', () => this.closeCard()), cardButton('Save', submit, 'folio-primary'));
    this.card.replaceChildren(input, actions);
    this.show(rect);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  private send(action: 'add' | 'update' | 'delete', note: NoteData): void {
    this.post({ type: 'note', sourceUri: this.sourceUri(), action, note });
  }

  /** Wrap the note's text in marks; false when it is not in the document. */
  private highlight(note: NoteData): boolean {
    const candidates: Element[] = [
      ...Array.from(this.root.querySelectorAll(`[data-source-line="${note.line}"]`)).reverse(),
      this.root,
    ];
    for (const block of candidates) {
      const index = indexText(block);
      let best = -1;
      let bestScore = -1;
      for (let at = index.text.indexOf(note.quote); at !== -1; at = index.text.indexOf(note.quote, at + 1)) {
        const score =
          commonEnd(index.text.slice(0, at), note.prefix) +
          commonStart(index.text.slice(at + note.quote.length), note.suffix);
        if (score > bestScore) {
          best = at;
          bestScore = score;
        }
      }
      if (best >= 0) {
        this.wrap(index, best, best + note.quote.length - 1, note.id);
        return true;
      }
    }
    return false;
  }

  private wrap(index: TextIndex, first: number, last: number, id: string): void {
    // Consecutive characters of the same text node, from last to first so
    // that splitting a node does not move the offsets still to wrap.
    const groups: Array<{ node: Text; from: number; to: number }> = [];
    for (let i = first; i <= last; i++) {
      const [node, offset] = index.points[i];
      const group = groups[groups.length - 1];
      if (group && group.node === node) {
        group.to = offset + 1;
      } else {
        groups.push({ node, from: offset, to: offset + 1 });
      }
    }
    for (const { node, from, to } of groups.reverse()) {
      if (!node.data.slice(from, to).trim()) {
        continue;
      }
      if (to < node.length) {
        node.splitText(to);
      }
      const target = from > 0 ? node.splitText(from) : node;
      const mark = document.createElement('mark');
      mark.className = 'folio-note';
      mark.dataset['note'] = id;
      target.parentNode!.insertBefore(mark, target);
      mark.append(target);
    }
  }

  /** A pin in the right margin next to the first line of each note. */
  layout(): void {
    const column = this.root.getBoundingClientRect();
    const seen = new Set<string>();
    const pins: HTMLElement[] = [];
    let previousTop = -Infinity;
    let shift = 0;
    for (const mark of Array.from(this.root.querySelectorAll<HTMLElement>('mark.folio-note'))) {
      const id = mark.dataset['note']!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const rect = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'folio-note-pin';
      pin.title = this.notes.find((note) => note.id === id)?.text || 'Note';
      pin.setAttribute('aria-label', `Note: ${pin.title}`);
      const top = rect.top + window.scrollY + rect.height / 2;
      // Notes on the same line: pins side by side, not on top of each other.
      shift = Math.abs(top - previousTop) < 14 ? shift + 18 : 0;
      previousTop = top;
      pin.style.top = `${top}px`;
      pin.style.left = `${column.right + window.scrollX - 26 + shift}px`;
      pin.addEventListener('click', () => this.open(id));
      pins.push(pin);
    }
    this.layer.replaceChildren(...pins);
  }

  private show(rect: DOMRect): void {
    this.card.hidden = false;
    const style = this.card.style;
    style.maxWidth = `${Math.min(360, window.innerWidth - 2 * EDGE)}px`;
    style.left = '0px';
    style.top = '0px';
    const { width, height } = this.card.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - EDGE));
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - EDGE && rect.top - GAP - height >= EDGE) {
      top = rect.top - GAP - height;
    }
    style.left = `${Math.round(left + window.scrollX)}px`;
    style.top = `${Math.round(Math.max(EDGE, top) + window.scrollY)}px`;
  }

  private closeCard(): void {
    this.card.hidden = true;
    this.cardFor = undefined;
  }
}

function cardButton(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `folio-note-button ${className}`.trim();
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
