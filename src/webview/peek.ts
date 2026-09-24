/*
 * Previews on hover: resting the pointer on a footnote reference shows the
 * footnote; on a link to a heading, the start of that section; on a link to
 * another Markdown file, the start of that file (rendered by the host).
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { HostMessage, WebviewMessage } from '../messages';
import { FOLIO_UI } from './documentTools';

const DELAY_MS = 400;
const GAP = 8;
const EDGE = 8;
/** Blocks of a section shown after its heading. */
const SECTION_BLOCKS = 3;
const MARKDOWN_LINK = /^(?![a-z][a-z0-9+.-]*:|\/\/)[^?#]*\.(md|markdown|mdown|mkd|mkdn)(#.*)?$/i;

type Reply = Extract<HostMessage, { type: 'linkPreview' }>;

export class LinkPreviews {
  private readonly card: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private link: HTMLAnchorElement | undefined;
  private requestId = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private readonly sourceUri: () => string,
    private readonly sanitize: (html: string) => string,
  ) {
    this.card = document.createElement('div');
    this.card.className = 'mtp-tooltip folio-peek';
    this.card.hidden = true;
    document.body.append(this.card);

    root.addEventListener('mouseover', (event) => {
      const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
      if (!link || link === this.link || !root.contains(link)) {
        return;
      }
      this.hide();
      this.link = link;
      this.timer = setTimeout(() => this.show(link), DELAY_MS);
    });
    root.addEventListener('mouseout', (event) => {
      if (this.link && !this.link.contains(event.relatedTarget as Node | null)) {
        this.hide();
      }
    });
    window.addEventListener('scroll', () => this.hide(), { passive: true });
    document.addEventListener('mousedown', () => this.hide());
  }

  /** The host rendered the start of another file. */
  onReply(message: Reply): void {
    if (message.id === this.requestId && this.link && message.html) {
      this.open(this.link, this.sanitize(message.html), message.title);
    }
  }

  private show(link: HTMLAnchorElement): void {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const content = this.local(decodeURIComponent(href.slice(1)));
      if (content) {
        this.open(link, content);
      }
    } else if (MARKDOWN_LINK.test(href)) {
      this.post({ type: 'linkPreview', id: ++this.requestId, sourceUri: this.sourceUri(), href });
    }
  }

  /** What a link inside the document points to, as HTML. */
  private local(id: string): string | undefined {
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
    if (!target || !this.root.contains(target)) {
      return undefined;
    }
    const pieces: Element[] = [];
    const footnote = target.closest('.footnote-item');
    if (footnote) {
      pieces.push(footnote);
    } else if (/^H[1-6]$/.test(target.tagName)) {
      pieces.push(target);
      const own = Number(target.tagName[1]);
      for (let next = target.nextElementSibling; next && pieces.length <= SECTION_BLOCKS; next = next.nextElementSibling) {
        const heading = /^H([1-6])$/.exec(next.tagName);
        if (heading && Number(heading[1]) <= own) {
          break;
        }
        pieces.push(next);
      }
    } else {
      pieces.push(target.closest('p, li, blockquote, table, pre') ?? target);
    }
    const holder = document.createElement('div');
    for (const piece of pieces) {
      holder.append(piece.cloneNode(true));
    }
    // No ids twice in the page, no buttons, no back links to the reference.
    holder.querySelectorAll(`${FOLIO_UI}, .footnote-backref, button`).forEach((element) => element.remove());
    holder.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    holder.querySelectorAll('.folio-folded').forEach((element) => element.classList.remove('folio-folded'));
    return holder.innerHTML;
  }

  private open(link: HTMLAnchorElement, html: string, title?: string): void {
    if (!link.isConnected) {
      return;
    }
    this.card.replaceChildren();
    if (title) {
      const heading = document.createElement('div');
      heading.className = 'folio-peek-title';
      heading.textContent = title;
      this.card.append(heading);
    }
    const body = document.createElement('div');
    body.className = 'folio-peek-body';
    body.innerHTML = html;
    this.card.append(body);
    this.card.hidden = false;
    // A long section fades out at the bottom instead of ending mid-line.
    body.classList.toggle('folio-peek-clipped', body.scrollHeight > body.clientHeight + 1);
    const rect = link.getBoundingClientRect();
    const style = this.card.style;
    style.left = '0px';
    style.top = '0px';
    const { width, height } = this.card.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - EDGE && rect.top - GAP - height >= EDGE) {
      top = rect.top - GAP - height;
    }
    style.left = `${Math.round(left + window.scrollX)}px`;
    style.top = `${Math.round(Math.max(EDGE, top) + window.scrollY)}px`;
  }

  private hide(): void {
    clearTimeout(this.timer);
    this.link = undefined;
    this.card.hidden = true;
  }
}
