/*
 * "Translate document": every paragraph, heading, list item and table cell
 * gets its translation right below it, the original staying in place. The
 * blocks are sent to the host as HTML (their bold, italics and links are
 * carried over), the visible ones first, and each translation appears as
 * soon as it is done. Code and math are kept out of the translation.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { HostMessage, WebviewMessage } from '../messages';
import { FOLIO_UI } from './documentTools';
import type { StateStore } from './reading';

type Reply = Extract<HostMessage, { type: 'documentTranslation' }>;

/** Blocks whose text is translated (in lists and tables, the item or cell itself). */
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, th, td, figcaption';
/** Never translated, and not looked into. */
const SKIP = 'pre, code, .katex, .mermaid, .folio-translation, .footnote-backref, svg';
/** Kept as they are inside a translated block (the translation gets them back). */
const KEEP = 'code, .katex, img, svg';

interface Pending {
  element: Element;
  /** The HTML sent, also the key of the translation in `done`. */
  html: string;
  kept: Element[];
}

export class DocumentTranslation {
  private readonly pill: HTMLElement;
  private requestId = 0;
  private pending = new Map<number, Pending>();
  /** Translations already received, by the HTML of their block: a re-render shows them at once. */
  private readonly done = new Map<string, string>();
  private total = 0;
  private labels = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private readonly sourceUri: () => string,
    private readonly sanitize: (html: string) => string,
    private readonly state: StateStore,
    /** Blocks were added or removed: the layout moved. */
    private readonly onChange: () => void,
  ) {
    this.pill = document.createElement('div');
    this.pill.className = 'mtp-ui folio-translate-pill';
    this.pill.hidden = true;
    document.body.append(this.pill);
  }

  get enabled(): boolean {
    return this.state.get<boolean>('translateDocument') === true;
  }

  toggle(): void {
    this.state.set('translateDocument', !this.enabled);
    if (this.enabled) {
      this.refresh();
    } else {
      this.post({ type: 'stopDocumentTranslation' });
      this.clear();
      this.pill.hidden = true;
    }
  }

  /** After a render: translations known already go back in, the others are asked for. */
  refresh(): void {
    if (!this.enabled) {
      return;
    }
    this.pending.clear();
    const wanted: Array<{ id: number; html: string; distance: number }> = [];
    let id = 0;
    for (const element of this.blocks()) {
      const { html, kept } = blockHtml(element);
      if (!/\p{L}/u.test(html.replace(/<[^>]*>/g, ''))) {
        continue;
      }
      const translated = this.done.get(html);
      if (translated !== undefined) {
        this.insert(element, translated, kept);
        continue;
      }
      this.pending.set(++id, { element, html, kept });
      const rect = element.getBoundingClientRect();
      const distance = rect.bottom < 0 ? -rect.bottom + window.innerHeight : Math.max(0, rect.top - window.innerHeight);
      wanted.push({ id, html, distance });
    }
    this.onChange();
    this.total = wanted.length;
    if (!wanted.length) {
      this.showDone();
      return;
    }
    // The visible blocks first, then outwards.
    wanted.sort((a, b) => a.distance - b.distance);
    this.requestId++;
    this.show(`Translating…`);
    this.post({
      type: 'translateDocument',
      sourceUri: this.sourceUri(),
      requestId: this.requestId,
      blocks: wanted.map(({ id: blockId, html }) => ({ id: blockId, html })),
    });
  }

  onReply(reply: Reply): void {
    if (reply.requestId !== this.requestId || !this.enabled) {
      return;
    }
    switch (reply.status) {
      case 'started':
        this.labels = `${reply.sourceLabel} → ${reply.targetLabel}`;
        if (reply.same) {
          this.show(`Already in ${reply.targetLabel}`, true);
        }
        break;
      case 'block': {
        const block = reply.id !== undefined ? this.pending.get(reply.id) : undefined;
        if (!block || reply.html === undefined) {
          return;
        }
        this.pending.delete(reply.id!);
        this.done.set(block.html, reply.html);
        if (block.element.isConnected) {
          this.insert(block.element, reply.html, block.kept);
          this.onChange();
        }
        const count = this.total - this.pending.size;
        this.show(`Translating · ${Math.round((count / Math.max(1, this.total)) * 100)}%`);
        break;
      }
      case 'done':
        this.showDone();
        break;
      case 'error':
        this.show(reply.message ?? 'Translation failed.', true, reply.action);
        break;
    }
  }

  private blocks(): Element[] {
    return Array.from(this.root.querySelectorAll(BLOCKS)).filter((element) => {
      if (element.closest(SKIP) || element.closest('.folio-translation')) {
        return false;
      }
      // A list item or cell made of paragraphs: the paragraphs are translated.
      return !element.querySelector(':scope > p');
    });
  }

  private insert(element: Element, html: string, kept: Element[]): void {
    const holder = document.createElement('div');
    holder.innerHTML = this.sanitize(html);
    // Names, numbers, code: nothing to show twice.
    const plain = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const original = element.cloneNode(true) as Element;
    original.querySelectorAll(`${FOLIO_UI}, :scope > ul, :scope > ol`).forEach((child) => child.remove());
    if (plain(holder.textContent) === plain(original.textContent) && !holder.querySelector('[data-folio-keep]')) {
      this.translationOf(element)?.remove();
      return;
    }
    holder.querySelectorAll('[data-folio-keep]').forEach((placeholder) => {
      const original = kept[Number(placeholder.getAttribute('data-folio-keep'))];
      if (!original) {
        placeholder.remove();
        return;
      }
      // The engine may drop the space next to an empty placeholder ("Run`npm`to").
      const before = placeholder.previousSibling;
      const after = placeholder.nextSibling;
      if (before?.nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]$/u.test(before.textContent ?? '')) {
        before.textContent += ' ';
      }
      if (after?.nodeType === Node.TEXT_NODE && /^[\p{L}\p{N}]/u.test(after.textContent ?? '')) {
        after.textContent = ` ${after.textContent}`;
      }
      placeholder.replaceWith(original.cloneNode(true));
    });
    const existing = this.translationOf(element);
    const translation = existing ?? document.createElement('div');
    translation.className = 'folio-translation';
    translation.setAttribute('data-for', element.tagName.toLowerCase());
    translation.replaceChildren(...Array.from(holder.childNodes));
    if (!existing) {
      if (/^(LI|TD|TH|DT|DD)$/.test(element.tagName)) {
        // Inside the item, before its nested list if it has one.
        element.insertBefore(translation, element.querySelector(':scope > ul, :scope > ol'));
      } else {
        element.after(translation);
      }
    }
  }

  private translationOf(element: Element): Element | null {
    if (/^(LI|TD|TH|DT|DD)$/.test(element.tagName)) {
      return element.querySelector(':scope > .folio-translation');
    }
    const next = element.nextElementSibling;
    return next?.classList.contains('folio-translation') ? next : null;
  }

  private clear(): void {
    this.root.querySelectorAll('.folio-translation').forEach((element) => element.remove());
    this.pending.clear();
    this.onChange();
  }

  private showDone(): void {
    this.show(this.labels || 'Translated', true);
  }

  private show(text: string, closable = false, action?: Reply['action']): void {
    const label = document.createElement('span');
    label.textContent = text;
    const parts: HTMLElement[] = [label];
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'folio-translate-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        this.show('Downloading…');
        this.post({ type: 'command', command: action.command });
      });
      parts.push(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'folio-translate-close';
    close.title = closable ? 'Show the original only' : 'Stop translating';
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => this.toggle());
    parts.push(close);
    this.pill.replaceChildren(...parts);
    this.pill.hidden = false;
  }
}

/**
 * The block's content as HTML to translate: Folio's additions left out,
 * notes unwrapped, and code, math and images replaced by placeholders that
 * the translation carries over (`kept` holds the originals).
 */
function blockHtml(element: Element): { html: string; kept: Element[] } {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(`${FOLIO_UI}, .folio-translation, :scope > ul, :scope > ol`).forEach((child) => child.remove());
  clone.querySelectorAll('mark.folio-note').forEach((mark) => mark.replaceWith(...Array.from(mark.childNodes)));
  const kept: Element[] = [];
  clone.querySelectorAll(KEEP).forEach((child) => {
    if (child.parentElement?.closest(KEEP)) {
      return;
    }
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-folio-keep', String(kept.length));
    kept.push(child);
    child.replaceWith(placeholder);
  });
  return { html: clone.innerHTML.replace(/\s+/g, ' ').trim(), kept };
}
