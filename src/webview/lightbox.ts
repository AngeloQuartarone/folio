/*
 * Image zoom: clicking an image (not a linked one) shows it large. There it
 * can be zoomed with a trackpad pinch, Ctrl/Cmd + wheel, a double-click or
 * +/-/0, and moved with two fingers or by dragging. A click (not ending a
 * drag) or Esc closes it.
 * Copyright (c) 2026 Angelo Quartarone.
 */

const MAX_SCALE = 8;
/** Double-click and the + key zoom by this much. */
const STEP = 2;
/** A click on the image waits this long for a second click (double-click) before closing. */
const DOUBLE_CLICK_MS = 250;
/** Pointer movement beyond this is a drag, not a click. */
const DRAG_PX = 4;

export function enableImageZoom(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const image = (event.target as Element | null)?.closest?.('img');
    if (!image || image.closest('a') || !window.getSelection()?.isCollapsed) {
      return;
    }
    new Lightbox(image);
  });
}

class Lightbox {
  private readonly overlay: HTMLElement;
  private readonly image: HTMLImageElement;
  private scale = 1;
  private x = 0;
  private y = 0;
  private drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined;
  /** The last pointer press ended a drag: the click that follows does not close. */
  private dragged = false;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onKey = (event: KeyboardEvent) => this.key(event);

  constructor(source: HTMLImageElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mtp-ui folio-lightbox';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', source.alt || 'Image');
    this.image = document.createElement('img');
    this.image.src = source.currentSrc || source.src;
    this.image.alt = source.alt;
    this.image.draggable = false;
    this.overlay.append(this.image);

    this.overlay.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    this.overlay.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.overlay.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.overlay.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.overlay.addEventListener('pointercancel', (event) => this.pointerUp(event));
    this.overlay.addEventListener('click', (event) => this.click(event));
    this.overlay.addEventListener('dblclick', (event) => this.doubleClick(event));
    // Before the preview's own keys (text size, focus mode…).
    document.addEventListener('keydown', this.onKey, true);
    document.body.append(this.overlay);
    this.update(false);
  }

  private close(): void {
    clearTimeout(this.clickTimer);
    this.overlay.classList.add('folio-closing');
    document.removeEventListener('keydown', this.onKey, true);
    setTimeout(() => this.overlay.remove(), 160);
  }

  // ------------------------------------------------------------- input

  private key(event: KeyboardEvent): void {
    const zoom: Record<string, number> = { '+': STEP, '=': STEP, '-': 1 / STEP };
    if (event.key === 'Escape') {
      this.close();
    } else if (event.key in zoom && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.zoomAt(this.scale * zoom[event.key], this.overlay.clientWidth / 2, this.overlay.clientHeight / 2, true);
    } else if (event.key === '0' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.reset();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * A trackpad pinch arrives as a wheel event with ctrlKey set (also
   * Ctrl/Cmd + mouse wheel); two-finger scrolling as a plain wheel event.
   */
  private wheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      // Pinches send small steps, mouse wheels large ones: cap them alike.
      const delta = Math.max(-50, Math.min(50, event.deltaY * unit));
      this.zoomAt(this.scale * Math.exp(-delta / 100), event.clientX, event.clientY, false);
    } else if (this.scale > 1) {
      this.x -= event.deltaX * unit;
      this.y -= event.deltaY * unit;
      this.update(false);
    }
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.dragged = false;
    if (this.scale > 1) {
      this.drag = { id: event.pointerId, x: this.x, y: this.y, startX: event.clientX, startY: event.clientY, moved: false };
      this.overlay.setPointerCapture(event.pointerId);
    }
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) {
      return;
    }
    drag.moved = true;
    this.overlay.classList.add('folio-dragging');
    this.x = drag.x + dx;
    this.y = drag.y + dy;
    this.update(false);
  }

  private pointerUp(event: PointerEvent): void {
    if (this.drag?.id === event.pointerId) {
      this.dragged = this.drag.moved;
      this.drag = undefined;
      this.overlay.classList.remove('folio-dragging');
    }
  }

  private click(event: MouseEvent): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    // On the image, wait for a possible double-click; around it, close now.
    if (event.target !== this.image) {
      this.close();
    } else if (event.detail <= 1) {
      this.clickTimer = setTimeout(() => this.close(), DOUBLE_CLICK_MS);
    }
  }

  private doubleClick(event: MouseEvent): void {
    clearTimeout(this.clickTimer);
    if (event.target !== this.image) {
      return;
    }
    if (this.scale > 1) {
      this.reset();
    } else {
      this.zoomAt(STEP * 1.25, event.clientX, event.clientY, true);
    }
  }

  // ------------------------------------------------------------ geometry

  private reset(): void {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.update(true);
  }

  /** Zoom to `scale`, keeping the point of the image under (px, py) where it is. */
  private zoomAt(scale: number, px: number, py: number, animate: boolean): void {
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    // The image's centre without the transform (it is centred in the overlay).
    const cx = this.overlay.clientWidth / 2;
    const cy = this.overlay.clientHeight / 2;
    const ux = (px - cx - this.x) / this.scale;
    const uy = (py - cy - this.y) / this.scale;
    this.x = px - cx - next * ux;
    this.y = py - cy - next * uy;
    this.scale = next;
    this.update(animate);
  }

  /** Keep the image from leaving the window, then apply the transform. */
  private update(animate: boolean): void {
    const width = this.image.offsetWidth * this.scale;
    const height = this.image.offsetHeight * this.scale;
    const room = (size: number, view: number) => Math.max(0, (size - view) / 2);
    const limitX = room(width, this.overlay.clientWidth);
    const limitY = room(height, this.overlay.clientHeight);
    this.x = Math.max(-limitX, Math.min(limitX, this.x));
    this.y = Math.max(-limitY, Math.min(limitY, this.y));
    this.image.classList.toggle('folio-animate', animate);
    this.image.style.transform =
      this.scale === 1 ? '' : `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.overlay.classList.toggle('folio-zoomed', this.scale > 1);
  }
}
