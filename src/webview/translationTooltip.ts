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
  private readonly action: HTMLButtonElement;
  private anchor: Anchor | undefined;
  private requestId = 0;
  private pendingAction: WebviewMessage | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private enabled: boolean,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'mtp-tooltip';
    this.element.setAttribute('role', 'tooltip');
    this.element.hidden = true;

    this.label = document.createElement('div');
    this.label.className = 'mtp-tooltip-label';
    this.body = document.createElement('div');
    this.body.className = 'mtp-tooltip-text';
    this.action = document.createElement('button');
    this.action.type = 'button';
    this.action.className = 'mtp-tooltip-action';
    this.action.addEventListener('click', () => {
      if (this.pendingAction) {
        this.post(this.pendingAction);
      }
      this.hide();
    });
    this.element.append(this.label, this.body, this.action);
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
    }
  }

  hide(): void {
    this.element.hidden = true;
    this.anchor = undefined;
    this.requestId++; // late replies are ignored
  }

  private onMouseUp(event: MouseEvent): void {
    if (!this.enabled || event.button !== 0 || this.element.contains(event.target as Node)) {
      return;
    }
    // Let the browser finish updating the selection (a click inside an
    // existing selection collapses it only after mouseup).
    setTimeout(() => this.onSelection(), 0);
  }

  private onSelection(): void {
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

    const rect = range.getBoundingClientRect();
    this.anchor = {
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      right: rect.right + window.scrollX,
    };
    const id = ++this.requestId;

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
    state: 'loading' | 'ok' | 'same' | 'error',
    label: string,
    text: string,
    action?: { label: string; message: WebviewMessage },
  ): void {
    this.element.dataset['state'] = state;
    this.label.textContent = label;
    this.body.textContent = text;
    this.body.hidden = !text;
    this.pendingAction = action?.message;
    this.action.hidden = !action;
    this.action.textContent = action?.label ?? '';
    this.element.hidden = false;
    this.position();
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
