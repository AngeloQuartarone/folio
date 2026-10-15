/*
 * The preview panel: one webview that follows the active Markdown editor.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Editor ↔ preview scroll sync is adapted from Markdown Preview Enhanced
 * src/extension-common.ts and src/utils.ts (University of Illinois/NCSA
 * License, Copyright (c) 2017 Yiyi Wang).
 */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  PREVIEW_SETTINGS,
  PreviewConfig,
  ReadingConfig,
  SECTION,
  editorColorScheme,
  getChangesBaseline,
  getPreviewConfig,
  getReadingConfig,
  getTranslationConfig,
  getWebSearchUrl,
} from '../config';
import type { SnapshotStore } from '../changes/snapshots';
import { HostMessage, WebviewMessage } from '../messages';
import { documentChanges } from '../render/changes';
import { codeExcerpt, codeLanguage, formatSize, looksLikeText, parseLineFragment } from '../render/codeExcerpt';
import { markdownExcerpt } from '../render/excerpt';
import { documentLanguage } from '../render/language';
import { MarkdownRenderer, escapeHtml } from '../render/markdownRenderer';
import { SlugRegistry } from '../render/slugify';
import {
  colorSchemeOfTheme,
  resolveCodeBlockTheme,
  resolvePreviewTheme,
} from '../themes';
import { settingsSections } from '../settingsView';
import { readUserCss, resolveUserPath } from '../userStyles';
import { webSearchUrl } from '../webSearch';
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
  /** Whether file names written in documents exist (see fileReferences). */
  private readonly referenceCache = new Map<string, { exists: boolean; at: number }>();
  /** The reading settings the preview was last built with. */
  private reading: ReadingConfig = getReadingConfig();
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
    /** The last version of each document read, to show what changed since (folio.changes.baseline). */
    private readonly snapshots?: SnapshotStore,
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
        const reading = getReadingConfig();
        const textSizeOnly = onlyTextSizeChanged(event, this.reading, reading);
        this.reading = reading;
        if (textSizeOnly) {
          // Applied in place: rebuilding the page would flash at every step.
          this.post({ type: 'textSize', size: reading.fontSize });
          this.post({ type: 'settings', sections: previewSettingsSections() });
        } else if (PREVIEW_SETTINGS.some((key) => event.affectsConfiguration(key))) {
          this.renderer = createRenderer(this.config);
          this.reload();
        } else {
          this.post({ type: 'settings', sections: previewSettingsSections() });
          if (event.affectsConfiguration(`${SECTION}.changes`) && this.sourceUri) {
            void this.sendChanges(this.sourceUri);
          }
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
    this.leave(uri);
    this.sourceUri = uri;
    if (!this.panel) {
      this.attach(
        vscode.window.createWebviewPanel(
          PREVIEW_VIEW_TYPE,
          '',
          { viewColumn: column, preserveFocus },
          {
            enableScripts: true,
            enableFindWidget: true,
            retainContextWhenHidden: true,
            localResourceRoots: this.localResourceRoots(uri),
          },
        ),
        uri,
      );
    } else {
      // Keep the panel where the user put it.
      this.panel.reveal(this.panel.viewColumn ?? column, preserveFocus);
      this.retarget(uri);
    }
  }

  /**
   * Take over a panel VS Code created: the reader tab ("Open With… › Folio
   * Reader"). There is one preview at a time, so an earlier one is closed.
   */
  adopt(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    const previous = this.panel;
    if (previous && previous !== panel) {
      this.onPanelDisposed();
      previous.dispose();
    }
    panel.webview.options = { enableScripts: true, localResourceRoots: this.localResourceRoots(uri) };
    this.attach(panel, uri);
  }

  private attach(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    this.sourceUri = uri;
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.svg');
    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message)),
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.onPanelDisposed();
        }
      }),
    );
    this.reload();
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
    this.leave(uri);
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
        reading: this.reading,
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
    if (this.sourceUri) {
      void this.markRead(this.sourceUri);
    }
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
    await this.sendChanges(uri, document.getText());
  }

  /** The preview moves from its document to `next`: the one left behind was read. */
  private leave(next: vscode.Uri): void {
    if (this.sourceUri && this.sourceUri.toString() !== next.toString()) {
      void this.markRead(this.sourceUri);
    }
  }

  /** The current version of `uri` becomes the one its changes are shown against. */
  private async markRead(uri: vscode.Uri): Promise<void> {
    if (!this.snapshots || getChangesBaseline() !== 'lastRead') {
      return;
    }
    try {
      const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === uri.toString())
        ?? (await vscode.workspace.openTextDocument(uri));
      await this.snapshots.set(uri.toString(), document.getText());
    } catch {
      // A document that is gone has nothing to remember.
    }
  }

  /**
   * What changed in the document since the version it is compared with. The
   * first time a document is read there is none: the version read is kept.
   */
  private async sendChanges(uri: vscode.Uri, text?: string): Promise<void> {
    const baseline = getChangesBaseline();
    try {
      const current = text ?? (await vscode.workspace.openTextDocument(uri)).getText();
      let before: { text: string; at?: string } | undefined;
      if (baseline === 'lastRead' && this.snapshots) {
        before = await this.snapshots.get(uri.toString());
        if (!before) {
          await this.snapshots.set(uri.toString(), current);
        }
      } else if (baseline === 'git') {
        before = await committedVersion(uri);
      }
      if (!this.isSource(uri)) {
        return;
      }
      const hunks = before ? documentChanges(before.text, current) : [];
      this.post({
        type: 'changes',
        sourceUri: uri.toString(),
        baseline,
        since: before?.at,
        hunks: hunks ?? [],
        tooMany: !hunks,
      });
    } catch {
      // No changes to show.
    }
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
      case 'markAsRead':
        if (message.sourceUri === this.sourceUri?.toString()) {
          const uri = this.sourceUri;
          void this.markRead(uri).then(() => this.sendChanges(uri));
        }
        break;
      case 'fileReferences':
        if (message.sourceUri === this.sourceUri?.toString()) {
          void this.fileReferences(message.id, message.hrefs);
        }
        break;
      case 'webSearch':
        void this.webSearch(message.text);
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

  /** "Search the web": the selected text in the default browser, opened if needed. */
  private async webSearch(text: unknown): Promise<void> {
    const url = this.reading.webSearch && typeof text === 'string' ? webSearchUrl(getWebSearchUrl(), text) : undefined;
    if (url) {
      // As a string: given a Uri, VS Code decodes the query before handing
      // it to the browser, and "AT&T" or "C++" would be searched wrong.
      await vscode.env.openExternal(url as unknown as vscode.Uri);
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
      const lines = parseLineFragment(link.fragment);
      if (isMarkdownPath(link.target)) {
        await this.openMarkdown(link.target, (text) =>
          lines ? lines.start - 1 : link.fragment ? findHeadingLine(text, link.fragment) : 0,
        );
      } else if ((await vscode.workspace.fs.stat(link.target)).type & vscode.FileType.Directory) {
        await vscode.commands.executeCommand('revealInExplorer', link.target);
      } else if (lines) {
        // src/app.ts#L10-L25: the file at those lines, selected.
        const document = await vscode.workspace.openTextDocument(link.target);
        const last = document.lineCount - 1;
        await vscode.window.showTextDocument(document, {
          viewColumn: this.sourceEditor()?.viewColumn ?? vscode.ViewColumn.One,
          selection: new vscode.Range(
            Math.min(lines.start - 1, last),
            0,
            Math.min(lines.end - 1, last),
            document.lineAt(Math.min(lines.end - 1, last)).text.length,
          ),
        });
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
   * Which file names written in the document are files or folders that
   * exist (next to it, from the workspace root, or found by name in the
   * workspace). Answers are cached for a little while: a document is
   * rendered again at every edit.
   */
  private async fileReferences(id: number, hrefs: unknown): Promise<void> {
    if (!this.panel || !Number.isInteger(id) || !Array.isArray(hrefs)) {
      return;
    }
    const source = this.sourceUri?.toString() ?? '';
    const now = Date.now();
    const found: string[] = [];
    // One at a time: a name not next to the document is looked for in the whole workspace.
    for (const href of hrefs.slice(0, MAX_FILE_REFERENCES)) {
      if (typeof href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        continue;
      }
      const key = `${source}\u0000${href}`;
      let known = this.referenceCache.get(key);
      if (!known || now - known.at > REFERENCE_CACHE_MS) {
        known = { exists: !!(await this.findLink(href).catch(() => undefined)), at: now };
        this.referenceCache.set(key, known);
      }
      if (known.exists) {
        found.push(href);
      }
    }
    if (this.referenceCache.size > 2000) {
      this.referenceCache.clear();
    }
    this.post({ type: 'fileReferences', id, found });
  }

  /**
   * What a link to a file points to, for the preview shown on hover: the
   * start of a Markdown file (or of the section), the linked lines of a
   * source file, an image, the contents of a folder, or that it is missing.
   */
  private async linkPreview(id: number, href: string): Promise<void> {
    if (!this.panel || typeof href !== 'string' || !Number.isInteger(id)) {
      return;
    }
    const reply = (title: string, html: string, target?: vscode.Uri) =>
      this.post({ type: 'linkPreview', id, title, html, path: target && displayPath(target) });
    try {
      const link = await this.findLink(href);
      if (!link) {
        const missing = this.resolveLink(href);
        if (missing) {
          reply('Not found', '<p class="folio-peek-missing">There is no file at this path.</p>', missing.target);
        }
        return;
      }
      const { target, fragment } = link;
      const name = path.basename(target.fsPath);
      const stat = await vscode.workspace.fs.stat(target);
      if (stat.type & vscode.FileType.Directory) {
        const entries = (await vscode.workspace.fs.readDirectory(target))
          .sort(([a, aType], [b, bType]) => Number(!(aType & vscode.FileType.Directory)) - Number(!(bType & vscode.FileType.Directory)) || a.localeCompare(b));
        const shown = entries.slice(0, FOLDER_ENTRIES).map(([entry, type]) =>
          `<li>${escapeHtml(entry)}${type & vscode.FileType.Directory ? '/' : ''}</li>`);
        const more = entries.length > FOLDER_ENTRIES ? `<li class="folio-peek-more">… ${entries.length - FOLDER_ENTRIES} more</li>` : '';
        const count = entries.length === 1 ? '1 item' : `${entries.length} items`;
        reply(`${name}/ · folder · ${count}`, entries.length ? `<ul class="folio-peek-list">${shown.join('')}${more}</ul>` : '<p>Empty folder.</p>', target);
      } else if (isMarkdownPath(target)) {
        const text = (await vscode.workspace.openTextDocument(target)).getText();
        const snippet = markdownExcerpt(text, fragment ? findHeadingLine(text, fragment) : 0);
        const webview = this.panel.webview;
        const folder = vscode.Uri.joinPath(target, '..');
        const result = this.renderer.render(snippet, {
          // Relative images are relative to that file, not to the one previewed.
          resolveImageSrc: (src) =>
            /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(src) || src.startsWith('/')
              ? src
              : webview.asWebviewUri(vscode.Uri.joinPath(folder, decodeURIComponent(src))).toString(),
        });
        const heading = fragment ? /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text.split(/\r?\n/)[findHeadingLine(text, fragment)] ?? '') : null;
        reply([name, heading?.[1]].filter(Boolean).join(' › '), result.html, target);
      } else if (IMAGE_PATH.test(target.path)) {
        const src = this.panel.webview.asWebviewUri(target).toString();
        reply(`${name} · ${formatSize(stat.size)}`, `<img class="folio-peek-image" src="${escapeHtml(src)}" alt="">`, target);
      } else {
        const bytes = stat.size <= MAX_CODE_BYTES ? await vscode.workspace.fs.readFile(target) : undefined;
        if (!bytes || !looksLikeText(bytes)) {
          reply(`${name} · ${formatSize(stat.size)}`, `<p>${bytes ? 'Binary file' : 'Large file'}, no preview.</p>`, target);
          return;
        }
        const excerpt = codeExcerpt(new TextDecoder().decode(bytes), parseLineFragment(fragment));
        const lines = excerpt.start === excerpt.end ? `line ${excerpt.start}` : `lines ${excerpt.start}–${excerpt.end}`;
        const whole = excerpt.start === 1 && excerpt.end === excerpt.total;
        const which = parseLineFragment(fragment) ? lines : whole ? `${excerpt.total} lines` : `${lines} of ${excerpt.total}`;
        reply(`${name} · ${which}`, this.renderer.renderCode(excerpt.code, codeLanguage(name)), target);
      }
    } catch {
      // Unreadable: no preview.
    }
  }
}

/** File names checked at most per document, and for how long an answer holds. */
const MAX_FILE_REFERENCES = 300;
const REFERENCE_CACHE_MS = 20_000;
/** Entries of a folder listed in its preview. */
const FOLDER_ENTRIES = 12;
/** Larger files are not read for a preview. */
const MAX_CODE_BYTES = 2 * 1024 * 1024;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

/**
 * The version of `uri` in the last commit (`git show HEAD:./file` next to
 * it): an empty text for a file not committed yet, undefined outside a
 * repository or without Git.
 */
async function committedVersion(uri: vscode.Uri): Promise<{ text: string; at?: string } | undefined> {
  if (uri.scheme !== 'file') {
    return undefined;
  }
  const cwd = path.dirname(uri.fsPath);
  const git = (...args: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile('git', args, { cwd, timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      ),
    );
  let at: string | undefined;
  try {
    at = (await git('log', '-1', '--format=%cI')).trim() || undefined;
  } catch {
    return undefined; // not in a repository, or no Git
  }
  try {
    return { text: await git('show', `HEAD:./${path.basename(uri.fsPath)}`), at };
  } catch {
    return { text: '', at }; // not committed yet: all of it is new
  }
}

/** A path as the workspace shows it ("docs/guide.md"), or the full path outside it. */
function displayPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
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

/** Whether the change is folio.reading.fontSize and nothing else the page is built from. */
function onlyTextSizeChanged(
  event: vscode.ConfigurationChangeEvent,
  before: ReadingConfig,
  after: ReadingConfig,
): boolean {
  return (
    before.fontSize !== after.fontSize &&
    JSON.stringify({ ...before, fontSize: 0 }) === JSON.stringify({ ...after, fontSize: 0 }) &&
    !PREVIEW_SETTINGS.some((key) => key !== `${SECTION}.reading` && event.affectsConfiguration(key))
  );
}
