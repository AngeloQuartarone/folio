/*
 * What changed since the version a document is compared with (the last one
 * read in Folio, or the last commit): a bar in the left margin next to each
 * added or changed block, a mark where text was removed (what it said shows
 * on hover), the new words highlighted, and a pill at the top with the count,
 * Next and Mark as read. The host finds the changes (src/render/changes.ts).
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { HostMessage, WebviewMessage } from '../messages';
import { FOLIO_UI } from './documentTools';

type Reply = Extract<HostMessage, { type: 'changes' }>;

/** Where the reader is looking: changes below it are "next". */
const READING_LINE = 0.3;
const GAP = 8;
const EDGE = 8;

interface Change {
  blocks: HTMLElement[];
  /** Before which block text was removed (or after the last one). */
  removedAt?: { block?: HTMLElement; after?: HTMLElement };
  removed: string;
  added: boolean;
}

export class Changes {
  private reply: Reply | undefined;
  private changes: Change[] = [];
  private readonly layer: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly card: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private readonly sourceUri: () => string,
    /** Unfold the section a change is in, before going there. */
    private readonly reveal: (element: Element) => void = () => undefined,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'mtp-ui folio-change-layer';
    this.pill = document.createElement('div');
    this.pill.className = 'mtp-ui folio-changes-pill';
    this.pill.hidden = true;
    this.card = document.createElement('div');
    this.card.className = 'mtp-tooltip folio-change-card';
    this.card.hidden = true;
    document.body.append(this.layer, this.pill, this.card);
    window.addEventListener('resize', () => this.layout());
    new ResizeObserver(() => this.layout()).observe(root);
    document.addEventListener('mousedown', () => (this.card.hidden = true));
  }

  /** The host's answer after an update (or after Mark as read). */
  set(reply: Reply): void {
    this.reply = reply;
    this.render();
  }

  /**
   * The document was rendered again: mark it as the last answer said (for
   * the same document) until the host's new answer arrives, without a flash.
   */
  refresh(): void {
    if (this.reply && this.reply.sourceUri !== this.sourceUri()) {
      this.reply = undefined;
    }
    this.render();
  }

  /** Scroll to the next (1) or previous (-1) change; false when there is none. */
  step(direction: 1 | -1): boolean {
    const line = window.innerHeight * READING_LINE;
    const tops = this.changes
      .map((change) => this.anchorOf(change))
      .filter((element): element is HTMLElement => !!element && element.getClientRects().length > 0)
      .map((element) => ({ element, top: element.getBoundingClientRect().top }));
    const target = direction > 0
      ? tops.find(({ top }) => top > line + 4)
      : tops.filter(({ top }) => top < line - 4).pop();
    if (!target) {
      return false;
    }
    this.reveal(target.element);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: target.element.getBoundingClientRect().top - line, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }

  // ---------------------------------------------------------------- marks

  private render(): void {
    for (const block of Array.from(this.root.querySelectorAll('.folio-changed, .folio-added'))) {
      block.classList.remove('folio-changed', 'folio-added');
    }
    for (const word of Array.from(this.root.querySelectorAll('mark.folio-change-word'))) {
      word.replaceWith(...Array.from(word.childNodes));
    }
    this.changes = [];
    const reply = this.reply;
    if (reply) {
      const blocks = Array.from(this.root.querySelectorAll<HTMLElement>('[data-source-line]')).filter(
        (block) => !block.closest(FOLIO_UI),
      );
      for (const hunk of reply.hunks) {
        const inside = innermost(blocks.filter((block) => overlaps(block, hunk.start, hunk.end)));
        const added = !hunk.removed;
        inside.forEach((block) => block.classList.add(added ? 'folio-added' : 'folio-changed'));
        inside.forEach((block) => hunk.words.forEach((words) => highlight(block, words)));
        const change: Change = { blocks: inside, removed: hunk.removed, added };
        if (!inside.length && hunk.removed) {
          const next = blocks.find((block) => line(block) >= hunk.start && !block.parentElement?.closest('[data-source-line]'));
          const last = [...blocks].reverse().find((block) => !block.parentElement?.closest('[data-source-line]'));
          change.removedAt = next ? { block: next } : { after: last };
        }
        if (change.blocks.length || change.removedAt) {
          this.changes.push(change);
        }
      }
    }
    this.renderPill();
    this.layout();
  }

  private renderPill(): void {
    const reply = this.reply;
    const count = this.changes.length;
    this.pill.hidden = !reply || reply.baseline === 'off' || (!count && !reply.tooMany);
    if (this.pill.hidden || !reply) {
      return;
    }
    const since = reply.baseline === 'git' ? 'since the last commit' : `since you last read it${ago(reply.since)}`;
    const label = document.createElement('span');
    label.textContent = reply.tooMany
      ? `Changed too much to show what, ${since}`
      : `${count} ${count === 1 ? 'change' : 'changes'} ${since}`;
    label.title = reply.since ? new Date(reply.since).toLocaleString() : '';
    const parts: HTMLElement[] = [label];
    if (count) {
      parts.push(pillButton('Next', () => this.step(1) || this.step(-1), 'Next change (c)'));
    }
    if (reply.baseline === 'lastRead') {
      parts.push(pillButton('Mark as read', () => this.post({ type: 'markAsRead', sourceUri: reply.sourceUri }), '', true));
    }
    this.pill.replaceChildren(...parts);
  }

  /** Bars in the left margin, level with the blocks; ticks where text was removed. */
  layout(): void {
    // The reading column's left edge: where its top-level blocks start (a list item is further in).
    const column = Array.from(this.root.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-source-line') && child.getClientRects().length > 0,
    );
    const left = (column?.getBoundingClientRect().left ?? this.root.getBoundingClientRect().left) + window.scrollX - 16;
    const marks: HTMLElement[] = [];
    for (const change of this.changes) {
      for (const block of change.blocks) {
        const rect = block.getBoundingClientRect();
        if (!block.getClientRects().length) {
          continue; // in a folded section
        }
        const bar = this.mark(change, change.added ? 'folio-change-bar folio-added' : 'folio-change-bar');
        bar.style.left = `${left}px`;
        bar.style.top = `${rect.top + window.scrollY + 2}px`;
        bar.style.height = `${Math.max(6, rect.height - 4)}px`;
        marks.push(bar);
      }
      const at = change.removedAt;
      const near = at?.block ?? at?.after;
      if (near?.getClientRects().length) {
        const rect = near.getBoundingClientRect();
        const tick = this.mark(change, 'folio-change-tick');
        tick.style.left = `${left - 4}px`;
        tick.style.top = `${(at?.block ? rect.top - 6 : rect.bottom + 4) + window.scrollY}px`;
        marks.push(tick);
      }
    }
    this.layer.replaceChildren(...marks);
  }

  private mark(change: Change, className: string): HTMLElement {
    const mark = document.createElement('div');
    mark.className = className;
    if (change.removed) {
      mark.addEventListener('mouseenter', () => this.showRemoved(mark, change));
      mark.addEventListener('mouseleave', () => (this.card.hidden = true));
    }
    return mark;
  }

  /** What a changed block said before, or the text that was removed. */
  private showRemoved(mark: HTMLElement, change: Change): void {
    const title = document.createElement('div');
    title.className = 'mtp-tooltip-label';
    title.textContent = change.blocks.length ? 'Before' : 'Removed';
    const text = document.createElement('div');
    text.className = 'folio-change-before';
    text.textContent = change.removed;
    this.card.replaceChildren(title, text);
    this.card.hidden = false;
    const rect = mark.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    const style = this.card.style;
    style.maxWidth = `${Math.min(420, view - 2 * EDGE)}px`;
    const { offsetWidth: width, offsetHeight: height } = this.card;
    const left = Math.max(EDGE, Math.min(rect.right + GAP, view - width - EDGE));
    const top = Math.max(EDGE, Math.min(rect.top, window.innerHeight - height - EDGE));
    style.left = `${Math.round(left + window.scrollX)}px`;
    style.top = `${Math.round(top + window.scrollY)}px`;
  }

  private anchorOf(change: Change): HTMLElement | undefined {
    return change.blocks[0] ?? change.removedAt?.block ?? change.removedAt?.after;
  }
}

function line(block: HTMLElement): number {
  return Number(block.dataset['sourceLine']);
}

function overlaps(block: HTMLElement, start: number, end: number): boolean {
  const first = line(block);
  const last = Number(block.dataset['sourceEnd'] ?? first);
  return end >= start && first <= end && last >= start;
}

/** Only the deepest of nested blocks (a list item, not its whole list). */
function innermost(blocks: HTMLElement[]): HTMLElement[] {
  return blocks.filter((block) => !blocks.some((other) => other !== block && block.contains(other)));
}

/** Wrap the first occurrence of `words` in `block` (within one text node) in a highlight. */
function highlight(block: HTMLElement, words: string): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`${FOLIO_UI}, .katex, mark.folio-change-word`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(words);
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + words.length);
      const mark = document.createElement('mark');
      mark.className = 'folio-change-word';
      range.surroundContents(mark);
      return;
    }
  }
}

/** ", 2 days ago" (empty without a date). */
function ago(iso: string | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) {
    return '';
  }
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) {
    return ', just now';
  }
  const [value, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 48 * 60 ? [Math.round(minutes / 60), 'hour'] : [Math.round(minutes / 1440), 'day'];
  return `, ${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function pillButton(label: string, onClick: () => unknown, title = '', primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'folio-changes-action folio-primary' : 'folio-changes-action';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', () => void onClick());
  return button;
}
