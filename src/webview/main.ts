/*
 * Preview webview script.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Scroll sync (buildScrollMap, previewSyncSource, scrollToPosition,
 * scrollSyncToLine) is adapted from crossnote src/webview/containers/preview.ts
 * (University of Illinois/NCSA License, Copyright (c) 2017 ~ 2023 Yiyi Wang).
 */
import DOMPurify from 'dompurify';
import type { HostMessage, WebviewMessage, WebviewSettings } from '../messages';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const preview = document.getElementById('preview') as HTMLElement;
const settings: WebviewSettings = JSON.parse(
  document.getElementById('preview-settings')?.dataset['settings'] ?? '{}',
);
const scriptNonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';

let sourceUri = '';
let totalLineCount = 0;
let scrollMap: number[] | null = null;
/** Ignore our own scroll events until this time (ms). */
let previewScrollDelay = 0;
let isAnimatingScroll = false;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

// ---------------------------------------------------------------- rendering

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-source-line', 'checked', 'disabled'],
    FORBID_TAGS: ['style', 'form'],
  });
}

function update(message: Extract<HostMessage, { type: 'update' }>): void {
  const scrollTop = window.scrollY;
  sourceUri = message.sourceUri;
  totalLineCount = message.lineCount;
  preview.innerHTML = sanitize(message.html);
  scrollMap = null;
  void renderMermaid();

  if (message.preserveScroll) {
    previewScrollDelay = Date.now() + 200;
    window.scrollTo(0, scrollTop);
  } else if (message.line !== undefined) {
    // Wait a frame so images with known sizes are laid out.
    requestAnimationFrame(() => scrollSyncToLine(message.line!, 0));
  }
}

// ------------------------------------------------------------------ mermaid

let mermaidLoading: Promise<MermaidApi | null> | null = null;

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  run(options: { nodes: HTMLElement[]; suppressErrors?: boolean }): Promise<void>;
}

function loadMermaid(): Promise<MermaidApi | null> {
  mermaidLoading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.nonce = scriptNonce;
    script.src = settings.mermaidScriptUri;
    script.onload = () => {
      const mermaid = (window as unknown as { mermaid?: MermaidApi }).mermaid ?? null;
      mermaid?.initialize({
        startOnLoad: false,
        theme: settings.mermaidTheme,
        securityLevel: 'strict',
      });
      resolve(mermaid);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return mermaidLoading;
}

async function renderMermaid(): Promise<void> {
  const nodes = Array.from(preview.querySelectorAll<HTMLElement>('.mermaid'));
  if (!nodes.length) {
    return;
  }
  const mermaid = await loadMermaid();
  if (!mermaid) {
    return;
  }
  for (const node of nodes) {
    try {
      await mermaid.run({ nodes: [node] });
    } catch (error) {
      node.setAttribute('data-processed', 'true');
      node.classList.add('mermaid-error');
      node.textContent = `Mermaid: ${String((error as Error)?.message ?? error)}`;
    }
  }
  scrollMap = null;
}

// -------------------------------------------------------------- scroll sync

const BLOCK_ELEMENTS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'OL', 'UL', 'LI', 'PRE',
  'BLOCKQUOTE', 'HR', 'TABLE', 'FIGURE', 'DIV', 'DL', 'SECTION',
]);

/** Pixel offset of every source line (0-based), interpolated between blocks. */
function buildScrollMap(): number[] | null {
  if (scrollMap) {
    return scrollMap;
  }
  if (!totalLineCount) {
    return null;
  }
  const map: number[] = new Array(totalLineCount).fill(-1);
  const known: number[] = [0];
  const added = new Set<number>();
  map[0] = 0;

  const elements = preview.querySelectorAll<HTMLElement>('[data-source-line]');
  for (const element of Array.from(elements)) {
    if (!BLOCK_ELEMENTS.has(element.tagName)) {
      continue;
    }
    const line = parseInt(element.getAttribute('data-source-line') ?? '', 10) - 1;
    if (!(line > 0) || line >= totalLineCount || added.has(line)) {
      continue;
    }
    added.add(line);
    // Footnotes point back up the document; they would break monotonicity.
    if (line < known[known.length - 1]) {
      continue;
    }
    const offsetTop = element.getBoundingClientRect().top + window.scrollY;
    if (offsetTop > 0) {
      known.push(line);
      map[line] = Math.round(offsetTop);
    }
  }

  known.push(totalLineCount);
  map.push(document.documentElement.scrollHeight);

  let pos = 0;
  for (let i = 0; i < totalLineCount; i++) {
    if (map[i] !== -1) {
      pos++;
      continue;
    }
    const a = known[pos - 1];
    const b = known[pos];
    map[i] = Math.round((map[b] * (i - a) + map[a] * (b - i)) / (b - a));
  }
  scrollMap = map;
  return map;
}

/** Tell the editor which line sits in the middle of the preview. */
function previewSyncSource(): void {
  if (window.scrollY === 0) {
    post({ type: 'revealLine', sourceUri, line: 0 });
    return;
  }
  const map = buildScrollMap();
  if (!map) {
    return;
  }
  const top = window.scrollY + window.innerHeight / 2;
  let i = 0;
  let j = map.length - 1;
  let row = -1;
  let mid = 0;
  for (let count = 0; count < 20; count++) {
    if (Math.abs(top - map[i]) < 20) {
      row = i;
      break;
    } else if (Math.abs(top - map[j]) < 20) {
      row = j;
      break;
    }
    mid = Math.floor((i + j) / 2);
    if (top > map[mid]) {
      i = mid;
    } else {
      j = mid;
    }
  }
  post({ type: 'revealLine', sourceUri, line: row === -1 ? mid : row });
}

function scrollToPosition(target: number): void {
  const step = 10;
  const tick = (remaining: number) => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(() => {
      previewScrollDelay = Date.now() + 500;
      isAnimatingScroll = true;
      if (remaining <= 0) {
        window.scrollTo(0, target);
      } else {
        const delta = ((target - window.scrollY) / remaining) * step;
        window.scrollTo(0, window.scrollY + delta);
      }
      requestAnimationFrame(() => {
        isAnimatingScroll = false;
      });
      if (remaining > 0 && Math.round(window.scrollY) !== Math.round(target)) {
        tick(remaining - step);
      }
    }, step);
  };
  tick(120);
}

/** Bring `line` into view; `topRatio` is where it sat in the editor viewport. */
function scrollSyncToLine(line: number, topRatio = 0.372): void {
  const map = buildScrollMap();
  if (!map || line >= map.length) {
    return;
  }
  previewScrollDelay = Date.now() + 500;
  if (line + 1 === totalLineCount) {
    scrollToPosition(document.documentElement.scrollHeight);
  } else {
    scrollToPosition(Math.max(map[line] - window.innerHeight * topRatio, 0));
  }
}

window.addEventListener('scroll', () => {
  if (!settings.scrollSync || isAnimatingScroll || Date.now() < previewScrollDelay) {
    return;
  }
  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }
  previewSyncSource();
});

window.addEventListener('resize', () => {
  scrollMap = null;
});

// ------------------------------------------------------------------- links

document.addEventListener('click', (event) => {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href) {
    return;
  }
  event.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
    target?.scrollIntoView({ block: 'start' });
    return;
  }
  post({ type: 'openLink', sourceUri, href });
});

// ---------------------------------------------------------------- messages

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message?.type) {
    case 'update':
      update(message);
      break;
    case 'scrollToLine':
      if (settings.scrollSync) {
        scrollSyncToLine(message.line, message.topRatio);
      }
      break;
  }
});

post({
  type: 'ready',
  systemColorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light',
});
