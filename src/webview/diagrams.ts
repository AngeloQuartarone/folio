/*
 * Navigation of Mermaid diagrams in the page: Ctrl/Cmd + wheel or a pinch
 * zooms at the pointer, a drag moves the zoomed diagram, a double-click
 * toggles the zoom. A toolbar (shown on hover) zooms, fits and opens the
 * diagram in the full-window lightbox.
 * Copyright (c) 2026 Angelo Quartarone.
 */

import { openDiagram } from './lightbox';
import { PanZoom, ZOOM_STEP } from './panZoom';

const ICONS = {
  zoomOut: 'M5 12h14',
  zoomIn: 'M12 5v14M5 12h14',
  fit: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  open: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
};

/** Make a rendered `.mermaid` block zoomable (once). */
export function enableDiagramZoom(node: HTMLElement): void {
  const svg = node.querySelector<SVGSVGElement>(':scope > svg');
  if (!svg || node.classList.contains('folio-diagram')) {
    return;
  }
  node.classList.add('folio-diagram');
  const panZoom = new PanZoom(node, svg, { scrollPans: false });

  const tools = document.createElement('div');
  tools.className = 'mtp-ui folio-diagram-tools';
  tools.append(
    button('Zoom out', ICONS.zoomOut, () => panZoom.zoomBy(1 / ZOOM_STEP)),
    button('Zoom in (Ctrl/Cmd + wheel)', ICONS.zoomIn, () => panZoom.zoomBy(ZOOM_STEP)),
    button('Fit', ICONS.fit, () => panZoom.reset(), 'folio-diagram-fit'),
    button('Open in full window', ICONS.open, () => openDiagram(svg)),
  );
  node.append(tools);
}

function button(label: string, path: string, onClick: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.title = label;
  element.setAttribute('aria-label', label);
  element.addEventListener('click', onClick);
  element.addEventListener('dblclick', (event) => event.stopPropagation());
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  icon.setAttribute('d', path);
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  svg.append(icon);
  element.append(svg);
  return element;
}
