/*
 * Zoom and pan of one element inside a box: Ctrl/Cmd + wheel or a trackpad
 * pinch zooms at the pointer, a drag moves the zoomed element, a
 * double-click toggles between fit and closer. Used by the image lightbox
 * and by Mermaid diagrams in the page.
 * Copyright (c) 2026 Angelo Quartarone.
 */

const MAX_SCALE = 8;
/** Double-click and the zoom buttons/keys zoom by this much. */
export const ZOOM_STEP = 2;
/** Pointer movement beyond this is a drag, not a click. */
const DRAG_PX = 4;

export interface PanZoomOptions {
  /**
   * Plain wheel / two-finger scrolling moves the zoomed element and never
   * scrolls the page (the lightbox). Otherwise it scrolls the page as usual.
   */
  scrollPans: boolean;
}

export class PanZoom {
  private scale = 1;
  private x = 0;
  private y = 0;
  private drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined;
  /** The last pointer press ended a drag: the click that follows is not a click. */
  dragged = false;

  /** `content` is centred in `viewport` and is moved with a transform. */
  constructor(
    private readonly viewport: HTMLElement,
    private readonly content: HTMLElement | SVGSVGElement,
    private readonly options: PanZoomOptions,
  ) {
    viewport.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    viewport.addEventListener('pointerdown', (event) => this.pointerDown(event));
    viewport.addEventListener('pointermove', (event) => this.pointerMove(event));
    viewport.addEventListener('pointerup', (event) => this.pointerUp(event));
    viewport.addEventListener('pointercancel', (event) => this.pointerUp(event));
    viewport.addEventListener('dblclick', (event) => this.doubleClick(event));
    this.update(false);
  }

  get zoomed(): boolean {
    return this.scale > 1;
  }

  /** Zoom by `factor` around the middle of the box. */
  zoomBy(factor: number): void {
    const box = this.viewport.getBoundingClientRect();
    this.zoomAt(this.scale * factor, box.left + box.width / 2, box.top + box.height / 2, true);
  }

  reset(): void {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.update(true);
  }

  // ------------------------------------------------------------- input

  /**
   * A trackpad pinch arrives as a wheel event with ctrlKey set (also
   * Ctrl/Cmd + mouse wheel); two-finger scrolling as a plain wheel event.
   */
  private wheel(event: WheelEvent): void {
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      // Pinches send small steps, mouse wheels large ones: cap them alike.
      const delta = Math.max(-50, Math.min(50, event.deltaY * unit));
      this.zoomAt(this.scale * Math.exp(-delta / 100), event.clientX, event.clientY, false);
    } else if (!this.options.scrollPans) {
      return;
    } else if (this.scale > 1) {
      this.x -= event.deltaX * unit;
      this.y -= event.deltaY * unit;
      this.update(false);
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element | null)?.closest?.('button')) {
      return;
    }
    this.dragged = false;
    if (this.scale > 1) {
      this.drag = { id: event.pointerId, x: this.x, y: this.y, startX: event.clientX, startY: event.clientY, moved: false };
      this.viewport.setPointerCapture(event.pointerId);
      // No text selection while dragging (Mermaid labels are text).
      event.preventDefault();
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
    this.viewport.classList.add('folio-dragging');
    this.x = drag.x + dx;
    this.y = drag.y + dy;
    this.update(false);
  }

  private pointerUp(event: PointerEvent): void {
    if (this.drag?.id === event.pointerId) {
      this.dragged = this.drag.moved;
      this.drag = undefined;
      this.viewport.classList.remove('folio-dragging');
    }
  }

  private doubleClick(event: MouseEvent): void {
    if (!this.content.contains(event.target as Node | null)) {
      return;
    }
    if (this.scale > 1) {
      this.reset();
    } else {
      this.zoomAt(ZOOM_STEP * 1.25, event.clientX, event.clientY, true);
    }
  }

  // ------------------------------------------------------------ geometry

  /** Zoom to `scale`, keeping the point of the element under (px, py) where it is. */
  private zoomAt(scale: number, px: number, py: number, animate: boolean): void {
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    // The element's centre without the transform (it is centred in the box).
    const box = this.viewport.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const ux = (px - cx - this.x) / this.scale;
    const uy = (py - cy - this.y) / this.scale;
    this.x = px - cx - next * ux;
    this.y = py - cy - next * uy;
    this.scale = next;
    this.update(animate);
  }

  /** Keep the element from leaving the box, then apply the transform. */
  private update(animate: boolean): void {
    const width = this.content.clientWidth * this.scale;
    const height = this.content.clientHeight * this.scale;
    const room = (size: number, view: number) => Math.max(0, (size - view) / 2);
    const limitX = room(width, this.viewport.clientWidth);
    const limitY = room(height, this.viewport.clientHeight);
    this.x = Math.max(-limitX, Math.min(limitX, this.x));
    this.y = Math.max(-limitY, Math.min(limitY, this.y));
    this.content.classList.toggle('folio-animate', animate);
    this.content.style.transform =
      this.scale === 1 ? '' : `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.viewport.classList.toggle('folio-zoomed', this.scale > 1);
  }
}
