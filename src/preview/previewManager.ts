/*
 * The preview panel: one webview that follows the active Markdown editor.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Editor ↔ preview scroll sync is adapted from Markdown Preview Enhanced
 * src/extension-common.ts and src/utils.ts (University of Illinois/NCSA
 * License, Copyright (c) 2017 Yiyi Wang).
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  PREVIEW_SETTINGS,
  PreviewConfig,
  SECTION,
  editorColorScheme,
  getPreviewConfig,
  getReadingConfig,
  getTranslationConfig,
} from '../config';
import { HostMessage, WebviewMessage } from '../messages';
import { markdownExcerpt } from '../render/excerpt';
import { documentLanguage } from '../render/language';
import { MarkdownRenderer } from '../render/markdownRenderer';
import { SlugRegistry } from '../render/slugify';
import {
  colorSchemeOfTheme,
  resolveCodeBlockTheme,
  resolvePreviewTheme,
} from '../themes';
import { settingsSections } from '../settingsView';
import { readUserCss, resolveUserPath } from '../userStyles';
import { buildPreviewPage } from './page';
import { findRenderedText } from './sourceMatch';

const POSITIONS_KEY = 'folio.readingPositions';
const MAX_POSITIONS = 200;

export const PREVIEW_VIEW_TYPE = 'folio.preview';

export function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'markdown';
}

export class PreviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private sourceUri: vscode.Uri | undefined;
  private config: PreviewConfig = getPreviewConfig();
  private renderer = createRenderer(this.config);
  private systemColorScheme: 'light' | 'dark' = 'light';
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ignore editor scroll events caused by our own revealRange until then. */
  private editorScrollDelay = 0;
  /** The line the preview last asked the editor to centre (see onEditorScroll). */
  private revealedLine: number | undefined;
  /** Marks, in the source editor, the text selected in the preview. */
  private readonly sourceHighlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private highlightedEditor: vscode.TextEditor | undefined;
  /** The selection we set in the source editor ourselves (not a user action). */
  private ownSelection: { selection: vscode.Selection; until: number } | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  /** Reloads the preview when the user's stylesheet is saved. */
  private cssWatcher: vscode.Disposable | undefined;
  private readonly messageListeners: Array<
    (message: WebviewMessage, panel: vscode.WebviewPanel) => void
  > = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Where the user stopped reading each document (folio.reading.resume). */
    private readonly positions?: vscode.Memento,
  ) {
    this.disposables.push(
      this.sourceHighlight,
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isSource(event.document.uri)) {
          this.clearSourceHighlight();
          this.scheduleUpdate();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.panel && isMarkdownDocument(editor.document)) {
          if (!this.isSource(editor.document.uri)) {
            this.retarget(editor.document.uri);
          }
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) =>
        this.onEditorSelection(event),
      ),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) =>
        this.onEditorScroll(event.textEditor),
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(SECTION)) {
          return;
        }
        this.config = getPreviewConfig();
        if (event.affectsConfiguration(`${SECTION}.customCss`)) {
          this.watchUserCss();
        }
        if (PREVIEW_SETTINGS.some((key) => event.affectsConfiguration(key))) {
          this.renderer = createRenderer(this.config);
          this.reload();
        } else {
          this.post({ type: 'settings', sections: previewSettingsSections() });
        }
      }),
      { dispose: () => this.cssWatcher?.dispose() },
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.config.previewColorScheme === 'editorColorScheme') {
          this.reload();
        }
      }),
    );
    this.watchUserCss();
  }

  private watchUserCss(): void {
    this.cssWatcher?.dispose();
    const uri = resolveUserPath(this.config.customCss);
    if (!uri) {
      this.cssWatcher = undefined;
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.basename(uri.fsPath)),
    );
    const reload = () => this.reload();
    this.cssWatcher = vscode.Disposable.from(watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload));
  }

  get activeSourceUri(): vscode.Uri | undefined {
    return this.sourceUri;
  }

  get webviewPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  /** Extra handlers for webview messages (e.g. translation requests). */
  onDidReceiveMessage(
    listener: (message: WebviewMessage, panel: vscode.WebviewPanel) => void,
  ): void {
    this.messageListeners.push(listener);
  }

  postMessage(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  /** Open (or retarget) the preview on `uri`. */
  show(
    uri: vscode.Uri,
    column: vscode.ViewColumn = vscode.ViewColumn.Beside,
    preserveFocus = true,
  ): void {
    this.sourceUri = uri;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PREVIEW_VIEW_TYPE,
        '',
        { viewColumn: column, preserveFocus },
        {
          enableScripts: true,
          enableFindWidget: true,
          retainContextWhenHidden: true,
          localResourceRoots: this.localResourceRoots(uri),
        },
      );
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.svg');
      this.panelDisposables.push(
        this.panel.webview.onDidReceiveMessage((message: WebviewMessage) =>
          this.onMessage(message),
        ),
        this.panel.onDidDispose(() => this.onPanelDisposed()),
      );
      this.reload();
    } else {
      // Keep the panel where the user put it.
      this.panel.reveal(this.panel.viewColumn ?? column, preserveFocus);
      this.retarget(uri);
    }
  }

  /**
   * Follow another Markdown file without revealing the panel: when the
   * preview shares the editor's group, revealing it would hide the editor
   * the user just switched to.
   */
  private retarget(uri: vscode.Uri): void {
    if (!this.panel) {
      return;
    }
    this.sourceUri = uri;
    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: this.localResourceRoots(uri),
    };
    this.reload();
  }

  /** Rebuild the whole webview (theme or settings changed). */
  reload(): void {
    if (!this.panel || !this.sourceUri) {
      return;
    }
    const editorScheme = editorColorScheme();
    const previewTheme = resolvePreviewTheme(
      this.config.previewTheme,
      this.config.previewColorScheme,
      editorScheme,
      this.systemColorScheme,
    );
    const colorScheme = colorSchemeOfTheme(previewTheme);
    const translation = getTranslationConfig();
    this.panel.title = `${path.basename(this.sourceUri.fsPath)} · Folio`;
    this.panel.webview.html = buildPreviewPage({
      webview: this.panel.webview,
      extensionUri: this.extensionUri,
      documentDir: vscode.Uri.joinPath(this.sourceUri, '..'),
      previewTheme,
      codeBlockTheme: resolveCodeBlockTheme(this.config.codeBlockTheme, previewTheme),
      colorScheme,
      settings: {
        scrollSync: this.config.scrollSync,
        mermaidTheme: colorScheme === 'dark' ? 'dark' : 'default',
        translationEnabled: translation.enabled,
        sections: previewSettingsSections(),
        reading: getReadingConfig(),
      },
      customCss: readUserCss(this.config.customCss),
    });
  }

  /** Scroll the preview to the editor's cursor line. */
  syncToEditor(): void {
    const editor = this.sourceEditor();
    if (editor) {
      this.post({
        type: 'scrollToLine',
        line: editor.selection.active.line,
      });
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private onPanelDisposed(): void {
    this.clearSourceHighlight();
    this.panel = undefined;
    this.sourceUri = undefined;
    clearTimeout(this.updateTimer);
    this.panelDisposables.splice(0).forEach((d) => d.dispose());
  }

  private post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private isSource(uri: vscode.Uri): boolean {
    return !!this.sourceUri && uri.toString() === this.sourceUri.toString();
  }

  private sourceEditor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((editor) =>
      this.isSource(editor.document.uri),
    );
  }

  private localResourceRoots(uri: vscode.Uri): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(this.extensionUri, 'dist'),
      vscode.Uri.joinPath(this.extensionUri, 'media'),
      vscode.Uri.joinPath(uri, '..'),
    ];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    return roots;
  }

  private scheduleUpdate(): void {
    clearTimeout(this.updateTimer);
    const delay = this.config.liveUpdateDebounceMs;
    this.updateTimer = setTimeout(() => void this.sendContent(true), delay);
  }

  private async sendContent(preserveScroll: boolean): Promise<void> {
    if (!this.panel || !this.sourceUri) {
      return;
    }
    const uri = this.sourceUri;
    const document = await vscode.workspace.openTextDocument(uri);
    if (!this.isSource(uri)) {
      return; // retargeted while loading
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const webview = this.panel.webview;
    const result = this.renderer.render(document.getText(), {
      resolveImageSrc: (src) => {
        // `/img.png` means "from the workspace root", as on GitHub.
        if (workspaceFolder && src.startsWith('/') && !src.startsWith('//')) {
          return webview
            .asWebviewUri(vscode.Uri.joinPath(workspaceFolder.uri, src))
            .toString();
        }
        return src;
      },
    });
    const editor = this.sourceEditor();
    let line = editor ? Math.floor(topVisibleLine(editor) ?? 0) : undefined;
    // Without an editor to follow, reopen where the user stopped reading.
    if (!preserveScroll && getReadingConfig().resume && (!editor || !this.config.scrollSync)) {
      line = this.readingPosition(uri) ?? line;
    }
    this.post({
      type: 'update',
      html: result.html,
      lineCount: result.lineCount,
      sourceUri: uri.toString(),
      preserveScroll,
      line,
      lang: getReadingConfig().justify ? documentLanguage(document.getText()) : undefined,
    });
  }

  private readingPosition(uri: vscode.Uri): number | undefined {
    return this.positions?.get<Record<string, number>>(POSITIONS_KEY)?.[uri.toString()];
  }

  private saveReadingPosition(uri: string, line: number): void {
    if (!this.positions || !this.sourceUri || uri !== this.sourceUri.toString() || !Number.isInteger(line) || line < 0) {
      return;
    }
    const all = { ...this.positions.get<Record<string, number>>(POSITIONS_KEY) };
    delete all[uri]; // re-inserted last: the oldest documents are dropped first
    all[uri] = line;
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS))) {
      delete all[key];
    }
    void this.positions.update(POSITIONS_KEY, all);
  }

  private onMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (message.systemColorScheme !== this.systemColorScheme) {
          this.systemColorScheme = message.systemColorScheme;
          if (this.config.previewColorScheme === 'systemColorScheme') {
            this.reload();
            return;
          }
        }
        void this.sendContent(false);
        break;
      case 'revealLine':
        this.revealLine(message.sourceUri, message.line);
        break;
      case 'selectSource':
        this.selectInSource(message);
        break;
      case 'readingPosition':
        this.saveReadingPosition(message.sourceUri, message.line);
        break;
      case 'openLink':
        void this.openLink(message.href);
        break;
      case 'navigate':
        void this.navigate(message.uri, message.line);
        break;
      case 'linkPreview':
        if (message.sourceUri === this.sourceUri?.toString()) {
          void this.linkPreview(message.id, message.href);
        }
        break;
    }
    for (const listener of this.messageListeners) {
      if (this.panel) {
        listener(message, this.panel);
      }
    }
  }

  private onEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
    const own = this.ownSelection;
    if (own && Date.now() < own.until && event.selections[0]?.isEqual(own.selection)) {
      // Set by selectInSource: scrolling the preview back would move the
      // text the user just selected there.
      this.ownSelection = undefined;
      return;
    }
    if (event.textEditor === this.highlightedEditor) {
      this.clearSourceHighlight();
    }
    if (!this.config.scrollSync || !this.isSource(event.textEditor.document.uri)) {
      return;
    }
    const top = topVisibleLine(event.textEditor);
    const bottom = bottomVisibleLine(event.textEditor);
    if (top === undefined || bottom === undefined || bottom === top) {
      return;
    }
    const line = event.selections[0].active.line;
    this.post({ type: 'scrollToLine', line, topRatio: (line - top) / (bottom - top) });
  }

  private onEditorScroll(editor: vscode.TextEditor): void {
    if (
      !this.config.scrollSync ||
      Date.now() < this.editorScrollDelay ||
      !this.isSource(editor.document.uri)
    ) {
      return;
    }
    const top = topVisibleLine(editor);
    const bottom = bottomVisibleLine(editor);
    if (top === undefined || bottom === undefined) {
      return;
    }
    let line: number;
    if (top === 0) {
      line = 0;
    } else if (Math.floor(bottom) === editor.document.lineCount - 1) {
      line = bottom;
    } else {
      line = Math.floor((top + bottom) / 2);
      // The editor settling on the line the preview just asked for: sending
      // it back would start a loop that slowly drifts the preview.
      if (this.revealedLine !== undefined && Math.abs(line - this.revealedLine) <= 1) {
        return;
      }
    }
    this.revealedLine = undefined;
    // The middle line goes to the middle of the preview, as in revealLine.
    this.post({ type: 'scrollToLine', line: Math.floor(line), topRatio: 0.5 });
  }

  private revealLine(uri: string, line: number): void {
    if (!this.config.scrollSync || !this.sourceUri || uri !== this.sourceUri.toString()) {
      return;
    }
    const editor = this.sourceEditor();
    if (!editor) {
      return;
    }
    const sourceLine = Math.min(Math.max(Math.floor(line), 0), editor.document.lineCount - 1);
    this.editorScrollDelay = Date.now() + 500;
    this.revealedLine = sourceLine;
    editor.revealRange(
      new vscode.Range(sourceLine, 0, sourceLine + 1, 0),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  /**
   * Select in the source editor the text selected in the preview. Only an
   * editor already visible next to the preview is used: the file is never
   * opened, and the focus stays in the preview.
   */
  private selectInSource(message: Extract<WebviewMessage, { type: 'selectSource' }>): void {
    const { line, endLine, text, occurrence } = message;
    if (
      !this.sourceUri ||
      message.sourceUri !== this.sourceUri.toString() ||
      typeof text !== 'string' ||
      ![line, endLine, occurrence].every(Number.isInteger)
    ) {
      return;
    }
    const editor = this.sourceEditor();
    if (!editor || !text) {
      this.clearSourceHighlight();
      return;
    }
    const document = editor.document;
    const first = Math.min(Math.max(line, 0), document.lineCount - 1);
    const block = document.validateRange(new vscode.Range(first, 0, Math.max(endLine, first + 1), 0));
    const match = findRenderedText(document.getText(block), text, Math.max(occurrence, 0));
    if (!match) {
      this.clearSourceHighlight();
      return;
    }
    const offset = document.offsetAt(block.start);
    const selection = new vscode.Selection(
      document.positionAt(offset + match.start),
      document.positionAt(offset + match.end),
    );
    if (this.highlightedEditor !== editor) {
      this.clearSourceHighlight();
    }
    this.ownSelection = { selection, until: Date.now() + 500 };
    editor.selection = selection;
    editor.setDecorations(this.sourceHighlight, [selection]);
    this.highlightedEditor = editor;
    this.editorScrollDelay = Date.now() + 500;
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private clearSourceHighlight(): void {
    this.highlightedEditor?.setDecorations(this.sourceHighlight, []);
    this.highlightedEditor = undefined;
  }

  /** The file a relative, root-relative or file: link points to, and its #fragment. */
  private resolveLink(href: string): { target: vscode.Uri; fragment: string } | undefined {
    if (!this.sourceUri || (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href))) {
      return undefined; // command:, vscode:, javascript:, https: ... are not files
    }
    const [pathPart, fragment] = splitFragment(href);
    if (/^file:/i.test(pathPart)) {
      return { target: vscode.Uri.parse(pathPart, true), fragment };
    }
    if (pathPart.startsWith('/')) {
      const folder = vscode.workspace.getWorkspaceFolder(this.sourceUri);
      const target = folder
        ? vscode.Uri.joinPath(folder.uri, decodeURIComponent(pathPart))
        : vscode.Uri.file(decodeURIComponent(pathPart));
      return { target, fragment };
    }
    return { target: vscode.Uri.joinPath(this.sourceUri, '..', decodeURIComponent(pathPart)), fragment };
  }

  /**
   * The existing file a link points to. A bare name that is not next to the
   * document ([[Page]] wiki links) is looked for in the whole workspace.
   */
  private async findLink(href: string): Promise<{ target: vscode.Uri; fragment: string } | undefined> {
    const link = this.resolveLink(href);
    if (!link) {
      return undefined;
    }
    try {
      await vscode.workspace.fs.stat(link.target);
      return link;
    } catch {
      const name = decodeURIComponent(splitFragment(href)[0]);
      if (!name || /[\\/*?{}[\]]/.test(name)) {
        return undefined;
      }
      const [found] = await vscode.workspace.findFiles(`**/${name}`, '**/node_modules/**', 1);
      return found ? { target: found, fragment: link.fragment } : undefined;
    }
  }

  private async openLink(href: string): Promise<void> {
    if (!this.sourceUri) {
      return;
    }
    try {
      if (/^(https?|mailto):/i.test(href)) {
        await vscode.env.openExternal(vscode.Uri.parse(href, true));
        return;
      }
      if (!this.resolveLink(href)) {
        return; // command:, vscode:, javascript: ... are never followed
      }
      const link = await this.findLink(href);
      if (!link) {
        throw new Error('not found');
      }
      if (isMarkdownPath(link.target)) {
        await this.openMarkdown(link.target, (text) => (link.fragment ? findHeadingLine(text, link.fragment) : 0));
      } else {
        await vscode.commands.executeCommand('vscode.open', link.target);
      }
    } catch {
      void vscode.window.showWarningMessage(`Cannot open link: ${href}`);
    }
  }

  /** Open a Markdown file in the source editor's column, at a line; the preview follows it. */
  private async openMarkdown(target: vscode.Uri, lineOf: (text: string) => number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(target);
    const line = Math.min(Math.max(0, lineOf(document.getText())), document.lineCount - 1);
    const column = this.sourceEditor()?.viewColumn ?? vscode.ViewColumn.One;
    await vscode.window.showTextDocument(document, {
      viewColumn: column,
      selection: new vscode.Range(line, 0, line, 0),
    });
  }

  /** "Back" to a place in another document. */
  private async navigate(uri: string, line: number): Promise<void> {
    try {
      const target = vscode.Uri.parse(uri, true);
      if (!['file', 'untitled'].includes(target.scheme) || !isMarkdownPath(target) || !Number.isInteger(line)) {
        return;
      }
      await this.openMarkdown(target, () => line);
    } catch {
      void vscode.window.showWarningMessage('Cannot go back: the document is no longer there.');
    }
  }

  /**
   * The start of the Markdown file (or of the section) a link points to,
   * rendered, for the preview shown on hover.
   */
  private async linkPreview(id: number, href: string): Promise<void> {
    if (!this.panel || typeof href !== 'string' || !Number.isInteger(id)) {
      return;
    }
    try {
      const link = await this.findLink(href);
      if (!link || !isMarkdownPath(link.target)) {
        return;
      }
      const document = await vscode.workspace.openTextDocument(link.target);
      const text = document.getText();
      const snippet = markdownExcerpt(text, link.fragment ? findHeadingLine(text, link.fragment) : 0);
      const webview = this.panel.webview;
      const folder = vscode.Uri.joinPath(link.target, '..');
      const result = this.renderer.render(snippet, {
        // Relative images are relative to that file, not to the one previewed.
        resolveImageSrc: (src) =>
          /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(src) || src.startsWith('/')
            ? src
            : webview.asWebviewUri(vscode.Uri.joinPath(folder, decodeURIComponent(src))).toString(),
      });
      const heading = link.fragment ? /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text.split(/\r?\n/)[findHeadingLine(text, link.fragment)] ?? '') : null;
      const title = [path.basename(link.target.fsPath), heading?.[1]].filter(Boolean).join(' › ');
      this.post({ type: 'linkPreview', id, html: result.html, title });
    } catch {
      // A missing file has no preview.
    }
  }
}

export function isMarkdownPath(uri: vscode.Uri): boolean {
  return /\.(md|markdown|mdown|mkd|mkdn)$/i.test(uri.path);
}

export function createRenderer(config: PreviewConfig): MarkdownRenderer {
  return new MarkdownRenderer({
    breaks: config.breakOnSingleNewLine,
    math: config.math,
    mermaid: config.mermaid,
    wikiLinks: config.wikiLinks,
    frontMatter: config.frontMatter,
  });
}

function splitFragment(href: string): [string, string] {
  const hash = href.indexOf('#');
  return hash === -1
    ? [href, '']
    : [href.slice(0, hash), decodeURIComponent(href.slice(hash + 1))];
}

/** 0-based line of the ATX heading whose GitHub slug is `slug`. */
export function findHeadingLine(text: string, slug: string): number {
  const slugs = new SlugRegistry();
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    const heading = !inFence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (heading && slugs.unique(heading[1].replace(/[*_`]/g, '')) === slug.toLowerCase()) {
      return i;
    }
  }
  return 0;
}

/**
 * Fractional line at the top/bottom of the editor viewport.
 * From Markdown Preview Enhanced src/utils.ts.
 */
function topVisibleLine(editor: vscode.TextEditor): number | undefined {
  const range = editor.visibleRanges[0];
  if (!range) {
    return undefined;
  }
  const line = editor.document.lineAt(range.start.line);
  return range.start.line + range.start.character / (line.text.length + 2);
}

function bottomVisibleLine(editor: vscode.TextEditor): number | undefined {
  const range = editor.visibleRanges[0];
  if (!range) {
    return undefined;
  }
  const lineNumber = range.end.line;
  const text =
    lineNumber < editor.document.lineCount ? editor.document.lineAt(lineNumber).text : '';
  return lineNumber + range.end.character / (text.length + 2);
}

function previewSettingsSections() {
  const config = vscode.workspace.getConfiguration(SECTION);
  return settingsSections((key) => config.get(key));
}
