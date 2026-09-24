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
import { addCodeCopyButtons, copyFormatted, enableImageZoom, toast } from './documentTools';
import { Notes } from './notes';
import { QuickSettings } from './quickSettings';
import { FocusMode, Outline, ReadingProgress } from './reading';
import { SettingsPanel } from './settingsPanel';
import { selectionInSource } from './sourceSelection';
import { TranslationTooltip } from './translationTooltip';

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

const reading = settings.reading;

/** Webview state: survives the reloads caused by theme changes. */
const state = {
  get<T>(key: string): T | undefined {
    return ((vscode.getState() as Record<string, unknown> | undefined) ?? {})[key] as T | undefined;
  },
  set(key: string, value: unknown): void {
    vscode.setState({ ...((vscode.getState() as Record<string, unknown> | undefined) ?? {}), [key]: value });
  },
};

const notes = reading.notes
  ? new Notes(preview, post, () => sourceUri, (entries) => outline?.setNotes(entries))
  : undefined;
const outline = reading.outline
  ? new Outline(preview, reading, state, post, {
      openNote: (id) => notes?.open(id),
      deleteNote: (id) => notes?.delete(id),
      copyNotes: () => {
        post({ type: 'command', command: 'copyNotesForAI' });
        toast('Notes copied — paste them into your AI chat');
      },
      toggle: (change) => keepReadingPosition(change),
    })
  : undefined;
const progress = reading.progress ? new ReadingProgress(preview) : undefined;
const focus = reading.focusMode ? new FocusMode(preview) : undefined;

const tooltip = new TranslationTooltip(preview, post, settings.translationEnabled, notes);
const settingsPanel = new SettingsPanel(post, settings.sections, {
  get: () => state.get<string>('settingsSection'),
  set: (section) => state.set('settingsSection', section),
}, () => void copyFormatted(preview));
const quickSettings = new QuickSettings(
  post,
  settings.sections,
  () => settingsPanel.open(),
  () => void copyFormatted(preview),
);
enableImageZoom(preview);

// ---------------------------------------------------------------- rendering

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-source-line', 'data-source-end', 'checked', 'disabled', 'encoding'],
    // KaTeX keeps the TeX source in <annotation>; "Copy as formatted text" uses it.
    ADD_TAGS: ['annotation'],
    FORBID_TAGS: ['style', 'form'],
  });
}

function update(message: Extract<HostMessage, { type: 'update' }>): void {
  const scrollTop = window.scrollY;
  sourceUri = message.sourceUri;
  totalLineCount = message.lineCount;
  preview.innerHTML = sanitize(message.html);
  afterRender();
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

/** Folio's additions to a freshly rendered document. */
function afterRender(): void {
  addCodeCopyButtons(preview);
  progress?.refresh();
  notes?.render();
  outline?.refresh();
  focus?.reset();
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

/**
 * Only scrolls the user makes are sent to the editor: layout changes (a
 * diagram or an image appearing) also scroll the page, and echoing those
 * made editor and preview push each other down.
 */
let userScrollUntil = 0;
for (const type of ['wheel', 'keydown', 'mousedown', 'touchmove']) {
  window.addEventListener(type, () => (userScrollUntil = Date.now() + 1000), { passive: true, capture: true });
}

window.addEventListener('scroll', () => {
  if (
    !settings.scrollSync ||
    isAnimatingScroll ||
    Date.now() < previewScrollDelay ||
    Date.now() > userScrollUntil
  ) {
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

// ------------------------------------------------------------ reading aids

let readingFrame = 0;
let positionTimer: ReturnType<typeof setTimeout> | undefined;

window.addEventListener(
  'scroll',
  () => {
    cancelAnimationFrame(readingFrame);
    readingFrame = requestAnimationFrame(() => {
      progress?.onScroll();
      outline?.onScroll();
      focus?.onScroll();
    });
    // Remember where the user is, to reopen the document there.
    if (reading.resume) {
      clearTimeout(positionTimer);
      positionTimer = setTimeout(() => {
        const line = topSourceLine();
        if (line !== undefined && sourceUri) {
          post({ type: 'readingPosition', sourceUri, line });
        }
      }, 400);
    }
  },
  { passive: true },
);

/**
 * Run `change` (which moves or narrows the text column) and scroll so the
 * block that was at the top of the window stays where it was.
 */
function keepReadingPosition(change: () => void): void {
  const blocks = Array.from(preview.querySelectorAll<HTMLElement>('[data-source-line]'));
  const anchor = blocks.find((block) => block.getBoundingClientRect().bottom > 0);
  const before = anchor?.getBoundingClientRect().top;
  change();
  scrollMap = null;
  if (anchor && before !== undefined) {
    const shift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(shift) > 1) {
      previewScrollDelay = Date.now() + 200;
      window.scrollBy(0, shift);
    }
  }
  notes?.layout();
}

/** The source line at the top of the preview. */
function topSourceLine(): number | undefined {
  const map = buildScrollMap();
  if (!map) {
    return undefined;
  }
  const top = window.scrollY + 8;
  let line = 0;
  for (let i = 0; i < map.length && map[i] <= top; i++) {
    line = i;
  }
  return line;
}

// ------------------------------------------------------------------- links

// VS Code's own webview script also handles clicks on links (on the window,
// after us) and opens their resolved URL — for a relative link a
// https://file+.vscode-resource… address — in the browser. Links are handled
// here only: caught before it, in the capture phase, and stopped.
function linkOf(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target as Element | null;
  return target?.closest?.('a[href]') ?? null;
}

window.addEventListener(
  'auxclick',
  (event) => {
    if (linkOf(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

window.addEventListener('click', (event) => {
  const anchor = linkOf(event);
  if (!anchor || !preview.contains(anchor)) {
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!window.getSelection()?.isCollapsed) {
    return; // the user is selecting the link text (e.g. to translate it)
  }
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
    target?.scrollIntoView({ block: 'start' });
    return;
  }
  post({ type: 'openLink', sourceUri, href });
}, true);

// ------------------------------------------------------ selection → editor

// Select the same text in the source editor (the host does it only when the
// file is already visible in an editor; it never opens it).
let selectedInSource = false;
document.addEventListener('mouseup', (event) => {
  // A drag may end outside the preview; clicks in the tooltip or the
  // settings panel leave the selection as it is.
  if (event.button !== 0 || (event.target as Element | null)?.closest?.('.mtp-tooltip, .mtp-ui')) {
    return;
  }
  // Let the browser finish updating the selection first.
  setTimeout(() => {
    const selection = selectionInSource(preview);
    if (selection) {
      selectedInSource = true;
      post({ type: 'selectSource', sourceUri, ...selection });
    } else if (selectedInSource) {
      selectedInSource = false;
      post({ type: 'selectSource', sourceUri, line: 0, endLine: 0, text: '', occurrence: 0 });
    }
  }, 0);
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
    case 'translation':
      tooltip.onReply(message);
      break;
    case 'translationSettings':
      tooltip.setEnabled(message.enabled);
      break;
    case 'languages':
      settingsPanel.setLanguages(message.languages);
      break;
    case 'settings':
      quickSettings.setSections(message.sections);
      settingsPanel.setSections(message.sections);
      break;
    case 'notes':
      if (message.sourceUri === sourceUri || !sourceUri) {
        notes?.setNotes(message.notes);
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
