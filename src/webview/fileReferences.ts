/*
 * File names written in the text, not linked: inline code such as
 * `docs/setup.md`, `src/app.ts:42` or `package.json`. The host says which
 * of them are files or folders that exist; those get a quiet dotted
 * underline, the same preview as a link on hover, and open on click.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { HostMessage, WebviewMessage } from '../messages';

/** Elements that point to a file through `data-href`, like a link. */
export const FILE_REFERENCE = 'code.folio-file-ref';
/** At most this many names are checked in one document. */
const MAX_NAMES = 300;

/**
 * A path with an extension that starts with a letter (`setup.md`, not
 * `1.2`), or with a slash (`src/webview`); then an optional line or range,
 * as `:42`, `:10-25` or `#L10-L25`.
 */
const NAME = /^((?:\.{1,2}\/|\/)?[\w@~+.-]+(?:\/[\w@~+.-]+)*\/?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/;

/** The href of a file named in inline code (lines as #L10-L25), or undefined. */
export function referenceHref(text: string): string | undefined {
  const match = NAME.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const path = match[1];
  const named = /\.[a-z][a-z0-9]{0,9}$/i.test(path.replace(/\/$/, '')) || path.includes('/');
  if (!named || /^\.{1,2}\/?$/.test(path) || path === '/') {
    return undefined;
  }
  const start = match[2] ?? match[4];
  const end = match[3] ?? match[5];
  return start ? `${path}#L${start}${end ? `-L${end}` : ''}` : path;
}

type Reply = Extract<HostMessage, { type: 'fileReferences' }>;

export class FileReferences {
  private requestId = 0;
  private pending = new Map<string, HTMLElement[]>();

  constructor(
    private readonly root: HTMLElement,
    private readonly post: (message: WebviewMessage) => void,
    private readonly sourceUri: () => string,
  ) {}

  /** After a render: ask the host which of the names in the document exist. */
  refresh(): void {
    this.pending = new Map();
    for (const code of Array.from(this.root.querySelectorAll<HTMLElement>('code'))) {
      if (code.closest('pre, a, .folio-translation')) {
        continue;
      }
      const href = referenceHref(code.textContent ?? '');
      if (href && (this.pending.has(href) || this.pending.size < MAX_NAMES)) {
        this.pending.set(href, [...(this.pending.get(href) ?? []), code]);
      }
    }
    if (this.pending.size) {
      this.post({ type: 'fileReferences', id: ++this.requestId, sourceUri: this.sourceUri(), hrefs: [...this.pending.keys()] });
    }
  }

  onReply(message: Reply): void {
    if (message.id !== this.requestId) {
      return; // the document was rendered again since
    }
    for (const href of message.found) {
      for (const code of this.pending.get(href) ?? []) {
        if (code.isConnected) {
          code.classList.add('folio-file-ref');
          code.dataset['href'] = href;
        }
      }
    }
  }
}
