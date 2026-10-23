/*
 * Image zoom: clicking an image (not a linked one) shows it large; Mermaid
 * diagrams open here from their toolbar. There it can be zoomed with a
 * trackpad pinch, Ctrl/Cmd + wheel, a double-click or +/-/0, and moved with
 * two fingers or by dragging. A click (not ending a drag) or Esc closes it.
 * Copyright (c) 2026 Angelo Quartarone.
 */

import { PanZoom, ZOOM_STEP } from './panZoom';

/** A click on the image waits this long for a second click (double-click) before closing. */
const DOUBLE_CLICK_MS = 250;
/** A diagram fills the window, but is drawn at most this much larger than its natural size. */
const DIAGRAM_MAX_FIT = 2;

export function enableImageZoom(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const image = (event.target as Element | null)?.closest?.('img');
    if (!image || image.closest('a') || !window.getSelection()?.isCollapsed) {
      return;
    }
    const large = document.createElement('img');
    large.src = image.currentSrc || image.src;
    large.alt = image.alt;
    large.draggable = false;
    new Lightbox(large, image.alt || 'Image');
  });
}

/** Show a rendered Mermaid diagram as large as the window allows. */
export function openDiagram(diagram: SVGSVGElement): void {
  const frame = document.createElement('div');
  frame.className = 'folio-lightbox-diagram';
  // Mermaid draws on a transparent background, in the page's colours.
  frame.style.background = backgroundOf(diagram);
  const copy = diagram.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute('style');
  copy.style.transform = '';
  frame.append(copy);
  const lightbox = new Lightbox(frame, 'Diagram');

  // Natural size from the viewBox; the frame's padding and the window's are kept free.
  const box = diagram.viewBox.baseVal;
  const width = box?.width || diagram.clientWidth;
  const height = box?.height || diagram.clientHeight;
  const padding = 2 * 16 + 2 * 24;
  const fit = Math.min(
    (window.innerWidth - padding) / width,
    (window.innerHeight - padding) / height,
    DIAGRAM_MAX_FIT,
  );
  copy.setAttribute('width', String(Math.max(1, Math.floor(width * fit))));
  copy.setAttribute('height', String(Math.max(1, Math.floor(height * fit))));
  lightbox.layout();
}

/** The colour the element is drawn on: the first ancestor with a background. */
function backgroundOf(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) {
      return color;
    }
  }
  return 'var(--mtp-solid)';
}

class Lightbox {
  private readonly overlay: HTMLElement;
  private readonly panZoom: PanZoom;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onKey = (event: KeyboardEvent) => this.key(event);

  constructor(private readonly content: HTMLElement, label: string) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mtp-ui folio-lightbox';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', label);
    this.overlay.append(content);

    this.overlay.addEventListener('click', (event) => this.click(event));
    this.overlay.addEventListener('dblclick', () => clearTimeout(this.clickTimer));
    // Before the preview's own keys (text size, focus mode…).
    document.addEventListener('keydown', this.onKey, true);
    document.body.append(this.overlay);
    this.panZoom = new PanZoom(this.overlay, content, { scrollPans: true });
  }

  /** The content changed size. */
  layout(): void {
    this.panZoom.reset();
  }

  private close(): void {
    clearTimeout(this.clickTimer);
    this.overlay.classList.add('folio-closing');
    document.removeEventListener('keydown', this.onKey, true);
    setTimeout(() => this.overlay.remove(), 160);
  }

  // ------------------------------------------------------------- input

  private key(event: KeyboardEvent): void {
    const zoom: Record<string, number> = { '+': ZOOM_STEP, '=': ZOOM_STEP, '-': 1 / ZOOM_STEP };
    if (event.key === 'Escape') {
      this.close();
    } else if (event.key in zoom && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.panZoom.zoomBy(zoom[event.key]);
    } else if (event.key === '0' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.panZoom.reset();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private click(event: MouseEvent): void {
    if (this.panZoom.dragged) {
      this.panZoom.dragged = false;
      return;
    }
    // On the content, wait for a possible double-click; around it, close now.
    if (!this.content.contains(event.target as Node | null)) {
      this.close();
    } else if (event.detail <= 1) {
      this.clickTimer = setTimeout(() => this.close(), DOUBLE_CLICK_MS);
    }
  }
}
