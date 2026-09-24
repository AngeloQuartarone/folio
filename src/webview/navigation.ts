/*
 * Moving through the document: going back after following a link (a small
 * "Back" button, the mouse's back button, Alt+←) and keys for paragraphs
 * and headings.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { WebviewMessage } from '../messages';
import type { StateStore } from './reading';

/** A place to come back to: a document and the source line at the top. */
export interface Place {
  uri: string;
  line: number;
}

const MAX_PLACES = 50;
/** Where a paragraph or heading lands when the keys move to it (from the top). */
const LANDING = 56;
const IDLE_MS = 2000;

/** Mouse button numbers of MouseEvent.button. */
const BACK_BUTTON = 3;

export class History {
  private readonly button: HTMLButtonElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly state: StateStore,
    private readonly post: (message: WebviewMessage) => void,
    /** Where the reader is now. */
    private readonly here: () => Place | undefined,
    /** Scroll this document to a source line. */
    private readonly scrollToLine: (line: number) => void,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mtp-ui folio-back';
    this.button.textContent = 'Back';
    this.button.title = 'Back to where you were (mouse back button, Alt+←)';
    this.button.addEventListener('click', () => this.back());
    document.body.append(this.button);
    this.update();

    // The mouse's back button, as in a browser.
    const onMouse = (event: MouseEvent) => {
      if (event.button === BACK_BUTTON) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'mouseup') {
          this.back();
        }
      }
    };
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('mouseup', onMouse, true);
    window.addEventListener('auxclick', onMouse, true);
    document.addEventListener('mousemove', () => this.wake());
  }

  /** Remember where the reader is, before following a link. */
  push(): void {
    const place = this.here();
    if (!place) {
      return;
    }
    this.state.set('history', [...this.places(), place].slice(-MAX_PLACES));
    this.update();
    this.wake();
  }

  back(): void {
    const places = this.places();
    const place = places.pop();
    if (!place) {
      return;
    }
    this.state.set('history', places);
    this.update();
    const here = this.here();
    if (here && place.uri === here.uri) {
      this.scrollToLine(place.line);
    } else {
      this.post({ type: 'navigate', uri: place.uri, line: place.line });
    }
  }

  private places(): Place[] {
    const places = this.state.get<Place[]>('history');
    return Array.isArray(places) ? places : [];
  }

  private update(): void {
    this.button.hidden = !this.places().length;
  }

  private wake(): void {
    if (this.button.hidden) {
      return;
    }
    this.button.classList.add('mtp-awake');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.button.classList.remove('mtp-awake'), IDLE_MS);
  }
}

export interface KeyActions {
  back(): void;
  toggleOutline(): void;
  /** j/k in focus mode: move the focus instead; true when it did. */
  step?(direction: 1 | -1): boolean;
}

/**
 * j/k: next/previous paragraph, J/K: next/previous heading, g/G: top and
 * bottom, t: table of contents, Alt+←: back. Not while typing.
 */
export function enableKeyboard(root: HTMLElement, actions: KeyActions): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      target?.closest?.('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    if (event.altKey) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        actions.back();
      }
      return;
    }
    const blocks = () => visible(Array.from(root.children)).filter((element) => !element.classList.contains('folio-reading-time'));
    const headings = () => visible(Array.from(root.querySelectorAll(':scope > :is(h1, h2, h3, h4, h5, h6)')));
    switch (event.key) {
      case 'j':
        if (!actions.step?.(1)) {
          moveTo(next(blocks()));
        }
        break;
      case 'k':
        if (!actions.step?.(-1)) {
          moveTo(previous(blocks()));
        }
        break;
      case 'J':
        moveTo(next(headings()));
        break;
      case 'K':
        moveTo(previous(headings()));
        break;
      case 'g':
        scroll(-window.scrollY);
        break;
      case 'G':
        scroll(document.documentElement.scrollHeight);
        break;
      case 't':
        actions.toggleOutline();
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}

function visible(elements: Element[]): Element[] {
  return elements.filter((element) => element.getClientRects().length > 0);
}

function next(elements: Element[]): Element | undefined {
  return elements.find((element) => element.getBoundingClientRect().top > LANDING + 2);
}

function previous(elements: Element[]): Element | undefined {
  return elements.filter((element) => element.getBoundingClientRect().top < LANDING - 2).pop();
}

function moveTo(element: Element | undefined): void {
  if (element) {
    scroll(element.getBoundingClientRect().top - LANDING);
  }
}

function scroll(by: number): void {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
}
