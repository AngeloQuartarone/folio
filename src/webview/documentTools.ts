/*
 * Document tools: copy buttons on code blocks, image zoom, and copying the
 * whole document as formatted text (for email, Word, Google Docs…).
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** Elements added by Folio, never part of copied or searched text. */
export const FOLIO_UI = '.folio-reading-time, .folio-copy, .folio-note-pin';

// ------------------------------------------------------------------ toast

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short message at the bottom of the window. */
export function toast(message: string): void {
  let element = document.querySelector<HTMLElement>('.folio-toast');
  if (!element) {
    element = document.createElement('div');
    element.className = 'mtp-ui folio-toast';
    element.setAttribute('role', 'status');
    document.body.append(element);
  }
  element.textContent = message;
  element.classList.add('folio-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element!.classList.remove('folio-visible'), 2200);
}

// -------------------------------------------------------------- clipboard

async function writeClipboard(plain: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    return true;
  } catch {
    return copyWithSelection(plain, html);
  }
}

/** Fallback: select a hidden copy and let the browser copy it. */
function copyWithSelection(plain: string, html?: string): boolean {
  const holder = document.createElement('div');
  holder.setAttribute('contenteditable', 'true');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
  if (html) {
    holder.innerHTML = html;
  } else {
    holder.textContent = plain;
  }
  document.body.append(holder);
  const selection = window.getSelection();
  const saved = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  holder.remove();
  selection?.removeAllRanges();
  if (saved) {
    selection?.addRange(saved);
  }
  return ok;
}

// ------------------------------------------------------------ code blocks

const COPY_PATH = 'M9 9h10v10H9zM5 15V5h10';

/** A copy button on every code block (shown on hover). */
export function addCodeCopyButtons(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>('pre'))) {
    if (pre.parentElement?.classList.contains('folio-code') || !pre.querySelector('code')) {
      continue;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'folio-code';
    pre.replaceWith(wrapper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mtp-ui folio-copy';
    button.title = 'Copy code';
    button.setAttribute('aria-label', 'Copy code');
    button.append(copyIcon());
    const label = document.createElement('span');
    label.textContent = 'Copy';
    button.append(label);
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      const ok = await writeClipboard(code.replace(/\n$/, ''));
      label.textContent = ok ? 'Copied' : 'Copy failed';
      button.classList.toggle('folio-done', ok);
      setTimeout(() => {
        label.textContent = 'Copy';
        button.classList.remove('folio-done');
      }, 1500);
    });
    wrapper.append(pre, button);
  }
}

function copyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', COPY_PATH);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// ------------------------------------------------------------ image zoom

/** Clicking an image (not a linked one) shows it large; click or Esc closes. */
export function enableImageZoom(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const image = (event.target as Element | null)?.closest?.('img');
    if (!image || image.closest('a') || !window.getSelection()?.isCollapsed) {
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'mtp-ui folio-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', image.alt || 'Image');
    const large = document.createElement('img');
    large.src = image.currentSrc || image.src;
    large.alt = image.alt;
    overlay.append(large);
    const close = () => {
      overlay.classList.add('folio-closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => overlay.remove(), 160);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') {
        key.stopPropagation();
        close();
      }
    };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
  });
}

// ------------------------------------------------------- formatted text

/** Inline styles that survive pasting into email clients and word processors. */
const PASTE_STYLES: Record<string, string> = {
  h1: 'font-size:26px;font-weight:700;margin:24px 0 12px;',
  h2: 'font-size:21px;font-weight:700;margin:22px 0 10px;',
  h3: 'font-size:18px;font-weight:700;margin:18px 0 8px;',
  h4: 'font-size:16px;font-weight:700;margin:16px 0 6px;',
  h5: 'font-size:15px;font-weight:700;margin:14px 0 6px;',
  h6: 'font-size:14px;font-weight:700;margin:14px 0 6px;color:#6b6964;',
  p: 'margin:0 0 12px;',
  a: 'color:#2383e2;text-decoration:underline;',
  code: "font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;background:#f3f2ef;padding:1px 4px;border-radius:3px;",
  pre: "font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;background:#f6f6f4;padding:12px 14px;border-radius:6px;white-space:pre-wrap;margin:0 0 12px;",
  blockquote: 'margin:0 0 12px;padding:0 0 0 12px;border-left:3px solid #d3d1cb;color:#6b6964;',
  table: 'border-collapse:collapse;margin:0 0 12px;',
  th: 'border:1px solid #e3e2de;padding:6px 10px;background:#f7f6f3;text-align:left;',
  td: 'border:1px solid #e3e2de;padding:6px 10px;',
  hr: 'border:0;border-top:1px solid #e3e2de;margin:20px 0;',
  img: 'max-width:100%;',
  ul: 'margin:0 0 12px;padding-left:24px;',
  ol: 'margin:0 0 12px;padding-left:24px;',
  li: 'margin:0 0 4px;',
  mark: 'background:#fff3b0;',
};

/** The text of a detached element, with line breaks as rendered. */
function plainText(element: HTMLElement): string {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px';
  holder.append(element.cloneNode(true));
  document.body.append(holder);
  const text = holder.innerText;
  holder.remove();
  return text;
}

/** Copy the whole document as formatted text; a message says how it went. */
export async function copyFormatted(root: HTMLElement): Promise<void> {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(FOLIO_UI).forEach((element) => element.remove());
  // Notes and code wrappers: keep only their content.
  clone.querySelectorAll('mark.folio-note, .folio-code').forEach((element) => element.replaceWith(...element.childNodes));
  // Math: the TeX source reads better than KaTeX's HTML without its styles.
  clone.querySelectorAll('.katex').forEach((element) => {
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    const display = element.parentElement?.classList.contains('katex-display');
    element.replaceWith(tex ? (display ? `$$${tex}$$` : `$${tex}$`) : element.textContent ?? '');
  });
  clone.querySelectorAll('*').forEach((element) => {
    const style = PASTE_STYLES[element.tagName.toLowerCase()];
    const inCode = element.tagName === 'CODE' && element.parentElement?.tagName === 'PRE';
    for (const attribute of Array.from(element.attributes)) {
      if (!['href', 'src', 'alt', 'colspan', 'rowspan'].includes(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (style && !inCode) {
      element.setAttribute('style', style);
    }
  });
  const html =
    `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#37352f;">` +
    `${clone.innerHTML}</div>`;
  const ok = await writeClipboard(plainText(clone), html);
  toast(ok ? 'Copied — paste it into an email, Word or Google Docs' : 'Could not copy the document');
}
