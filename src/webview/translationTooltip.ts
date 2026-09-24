/*
 * Translation tooltip shown under a mouse selection in the preview.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The webview never talks to the network: it posts the selection to the
 * extension host and renders the reply. All text is inserted with
 * textContent, never as HTML.
 */
import type { TranslationReply, WebviewMessage } from '../messages';
import { sentenceAround } from './sentence';

const MAX_SELECTION = 500;
const GAP = 8;
const EDGE = 8;

const CONTEXT_BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, pre';

/** What the tooltip needs from the notes (see notes.ts). */
export interface NoteComposer {
  canAnnotate(range: Range): boolean;
  compose(range: Range): void;
}

interface Anchor {
  /** Document coordinates of the selection's bounding box. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export class TranslationTooltip {
  private readonly element: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly meanings: HTMLDivElement;
  private readonly action: HTMLButtonElement;
  private readonly noteButton: HTMLButtonElement;
  private anchor: Anchor | undefined;
  /** The selection the tooltip is about, for "Add note". */
  private range: Range | undefined;
  private requestId = 0;
  private pendingAction: WebviewMessage | undefined;
  /** Open the other meanings as soon as they arrive (after a dictionary download). */
  private expandMeanings = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private enabled: boolean,
    private readonly notes?: NoteComposer,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'mtp-tooltip';
    this.element.setAttribute('role', 'tooltip');
    this.element.hidden = true;

    this.label = document.createElement('div');
    this.label.className = 'mtp-tooltip-label';
    this.body = document.createElement('div');
    this.body.className = 'mtp-tooltip-text';
    this.meanings = document.createElement('div');
    this.meanings.className = 'mtp-meanings';
    this.meanings.hidden = true;
    this.action = document.createElement('button');
    this.action.type = 'button';
    this.action.className = 'mtp-tooltip-action';
    this.action.addEventListener('click', () => {
      const action = this.pendingAction;
      if (!action) {
        return;
      }
      this.post(action);
      if (action.type === 'command' && action.command === 'downloadModels') {
        // The host retries the translation with the same id once done.
        this.show('loading', 'Downloading language model…', '');
      } else {
        this.hide();
      }
    });
    this.noteButton = document.createElement('button');
    this.noteButton.type = 'button';
    this.noteButton.className = 'mtp-tooltip-note';
    this.noteButton.textContent = 'Add note';
    this.noteButton.hidden = true;
    this.noteButton.addEventListener('click', () => {
      const range = this.range;
      this.hide();
      if (range) {
        this.notes?.compose(range);
      }
    });
    this.element.append(this.label, this.body, this.meanings, this.action, this.noteButton);
    document.body.appendChild(this.element);

    document.addEventListener('mousedown', (event) => {
      if (!this.element.hidden && !this.element.contains(event.target as Node)) {
        this.hide();
      }
    });
    document.addEventListener('mouseup', (event) => this.onMouseUp(event));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.element.hidden) {
        this.hide();
      }
    });
    window.addEventListener('resize', () => this.position());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }

  onReply(reply: TranslationReply): void {
    if (reply.id !== this.requestId || this.element.hidden) {
      return; // stale: a newer selection replaced it, or it was closed
    }
    if (reply.status === 'error') {
      this.show('error', 'Translation unavailable', reply.message, reply.action && {
        label: reply.action.label,
        message: { type: 'command', command: reply.action.command },
      });
    } else if (reply.sameLanguage) {
      this.show('same', `Already in ${reply.targetLabel}`, '');
    } else {
      this.show('ok', `${reply.sourceLabel} → ${reply.targetLabel}`, reply.text);
      const download = reply.action?.command === 'downloadDictionary' ? reply.action.label : undefined;
      this.showMeanings(reply.alternatives ?? [], download);
      this.position();
    }
  }

  hide(): void {
    this.element.hidden = true;
    this.anchor = undefined;
    this.requestId++; // late replies are ignored
  }

  private onMouseUp(event: MouseEvent): void {
    if ((!this.enabled && !this.notes) || event.button !== 0 || this.element.contains(event.target as Node)) {
      return;
    }
    // Let the browser finish updating the selection (a click inside an
    // existing selection collapses it only after mouseup).
    setTimeout(() => this.onSelection(), 0);
  }

  private onSelection(): void {
    this.expandMeanings = false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!this.root.contains(range.commonAncestorContainer)) {
      return;
    }
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }

    this.range = range.cloneRange();
    const rect = range.getBoundingClientRect();
    this.anchor = {
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      right: rect.right + window.scrollX,
    };
    const id = ++this.requestId;

    if (!this.enabled) {
      // Translation off: only the "Add note" button.
      if (this.notes?.canAnnotate(range)) {
        this.show('note', '', '');
      }
      return;
    }
    if (text.length > MAX_SELECTION) {
      this.show('error', 'Selection too long', `Select at most ${MAX_SELECTION} characters.`);
      return;
    }
    this.show('loading', 'Translating…', '');
    this.post({ type: 'translate', id, text, context: this.contextOf(range) });
  }

  /** The sentence containing the selection, for language detection. */
  private contextOf(range: Range): string {
    const start = range.startContainer;
    const startElement = start instanceof Element ? start : start.parentElement;
    const block = startElement?.closest(CONTEXT_BLOCKS);
    const container = block && this.root.contains(block) ? block : this.root;
    try {
      const before = document.createRange();
      before.selectNodeContents(container);
      before.setEnd(range.startContainer, range.startOffset);
      const from = before.toString().length;
      const to = from + range.toString().length;
      return sentenceAround(container.textContent ?? '', from, to, document.documentElement.lang || undefined);
    } catch {
      return '';
    }
  }

  private show(
    state: 'loading' | 'ok' | 'same' | 'error' | 'note',
    label: string,
    text: string,
    action?: { label: string; message: WebviewMessage },
  ): void {
    this.element.dataset['state'] = state;
    this.meanings.hidden = true;
    this.meanings.replaceChildren();
    this.label.textContent = label;
    this.body.textContent = text;
    this.body.hidden = !text;
    this.pendingAction = action?.message;
    this.action.hidden = !action;
    this.action.textContent = action?.label ?? '';
    this.noteButton.hidden = !(this.range && this.notes?.canAnnotate(this.range));
    this.element.hidden = false;
    this.position();
  }

  /**
   * A discreet "Other meanings" button under the translation; the meanings
   * only appear when it is clicked. Without the dictionary, the button
   * downloads it first (`downloadLabel` says how big it is).
   */
  private showMeanings(meanings: string[], downloadLabel?: string): void {
    if (!meanings.length && !downloadLabel) {
      return;
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mtp-meanings-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = downloadLabel ?? 'Other meanings';

    const list = document.createElement('div');
    list.className = 'mtp-meanings-list';
    list.hidden = true;
    for (const meaning of meanings) {
      const item = document.createElement('span');
      item.className = 'mtp-meaning';
      item.textContent = meaning;
      list.append(item);
    }
    const source = document.createElement('span');
    source.className = 'mtp-meanings-source';
    source.textContent = 'Wiktionary';
    source.title = 'From Wiktionary (CC BY-SA) via WikDict';
    list.append(source);

    const setExpanded = (expanded: boolean) => {
      toggle.setAttribute('aria-expanded', String(expanded));
      list.hidden = !expanded;
      this.position();
    };
    toggle.addEventListener('click', () => {
      if (downloadLabel) {
        this.expandMeanings = true;
        this.post({ type: 'command', command: 'downloadDictionary' });
        this.show('loading', 'Downloading dictionary…', '');
      } else {
        setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
      }
    });
    this.meanings.replaceChildren(toggle, list);
    this.meanings.hidden = false;
    if (this.expandMeanings && meanings.length) {
      setExpanded(true);
    }
  }

  /** Below the selection, flipped above if needed, never outside the window. */
  private position(): void {
    if (!this.anchor || this.element.hidden) {
      return;
    }
    const style = this.element.style;
    style.maxWidth = `${Math.min(420, window.innerWidth - 2 * EDGE)}px`;
    style.left = '0px';
    style.top = '0px';
    const { width, height } = this.element.getBoundingClientRect();

    const viewLeft = window.scrollX + EDGE;
    const viewRight = window.scrollX + window.innerWidth - EDGE;
    const center = (this.anchor.left + this.anchor.right) / 2;
    const left = Math.max(viewLeft, Math.min(center - width / 2, viewRight - width));

    const viewTop = window.scrollY + EDGE;
    const viewBottom = window.scrollY + window.innerHeight - EDGE;
    let top = this.anchor.bottom + GAP;
    if (top + height > viewBottom && this.anchor.top - GAP - height >= viewTop) {
      top = this.anchor.top - GAP - height;
    }
    top = Math.max(viewTop, Math.min(top, viewBottom - height));

    style.left = `${Math.round(left)}px`;
    style.top = `${Math.round(top)}px`;
  }
}
