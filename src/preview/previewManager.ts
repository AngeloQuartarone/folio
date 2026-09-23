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
  getTranslationConfig,
} from '../config';
import { HostMessage, WebviewMessage } from '../messages';
import { MarkdownRenderer } from '../render/markdownRenderer';
import { SlugRegistry } from '../render/slugify';
import { languageName } from '../translation/languages';
import { SUPPORTED_LANGUAGES } from '../translation/offline/registry';
import {
  PREVIEW_THEMES,
  PREVIEW_THEME_LABELS,
  colorSchemeOfTheme,
  resolveCodeBlockTheme,
  resolvePreviewTheme,
} from '../themes';
import { buildPreviewPage } from './page';

export const PREVIEW_VIEW_TYPE = 'markdownTranslate.preview';

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
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly messageListeners: Array<
    (message: WebviewMessage, panel: vscode.WebviewPanel) => void
  > = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isSource(event.document.uri)) {
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
        if (PREVIEW_SETTINGS.some((key) => event.affectsConfiguration(key))) {
          this.renderer = createRenderer(this.config);
          this.reload();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.config.previewColorScheme === 'editorColorScheme') {
          this.reload();
        }
      }),
    );
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
    const colorScheme = colorSchemeOfTheme(previewTheme, editorScheme);
    const translation = getTranslationConfig();
    this.panel.title = `Preview ${path.basename(this.sourceUri.fsPath)}`;
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
        quickSettings: {
          previewTheme: this.config.previewTheme,
          themes: PREVIEW_THEMES.map((value) => ({ value, label: PREVIEW_THEME_LABELS[value] })),
          targetLanguage: translation.targetLanguage,
          languages: SUPPORTED_LANGUAGES.map((value) => ({ value, label: languageName(value) })),
        },
      },
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
    this.post({
      type: 'update',
      html: result.html,
      lineCount: result.lineCount,
      sourceUri: uri.toString(),
      preserveScroll,
      line: editor ? Math.floor(topVisibleLine(editor) ?? 0) : undefined,
    });
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
      case 'openLink':
        void this.openLink(message.href);
        break;
    }
    for (const listener of this.messageListeners) {
      if (this.panel) {
        listener(message, this.panel);
      }
    }
  }

  private onEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
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
    }
    this.post({ type: 'scrollToLine', line: Math.floor(line) });
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
    editor.revealRange(
      new vscode.Range(sourceLine, 0, sourceLine + 1, 0),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  private async openLink(href: string): Promise<void> {
    if (!this.sourceUri) {
      return;
    }
    let target: vscode.Uri;
    try {
      if (/^(https?|mailto):/i.test(href)) {
        await vscode.env.openExternal(vscode.Uri.parse(href, true));
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) {
        return; // command:, vscode:, javascript: ... are never followed
      }
      const [pathPart, fragment] = splitFragment(href);
      if (/^file:/i.test(pathPart)) {
        target = vscode.Uri.parse(pathPart, true);
      } else if (pathPart.startsWith('/')) {
        const folder = vscode.workspace.getWorkspaceFolder(this.sourceUri);
        target = folder
          ? vscode.Uri.joinPath(folder.uri, decodeURIComponent(pathPart))
          : vscode.Uri.file(decodeURIComponent(pathPart));
      } else {
        target = vscode.Uri.joinPath(this.sourceUri, '..', decodeURIComponent(pathPart));
      }
      await vscode.workspace.fs.stat(target);
      if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(target.path)) {
        const document = await vscode.workspace.openTextDocument(target);
        const line = fragment ? findHeadingLine(document.getText(), fragment) : 0;
        const column = this.sourceEditor()?.viewColumn ?? vscode.ViewColumn.One;
        await vscode.window.showTextDocument(document, {
          viewColumn: column,
          selection: new vscode.Range(line, 0, line, 0),
        });
      } else {
        await vscode.commands.executeCommand('vscode.open', target);
      }
    } catch {
      void vscode.window.showWarningMessage(`Cannot open link: ${href}`);
    }
  }
}

export function createRenderer(config: PreviewConfig): MarkdownRenderer {
  return new MarkdownRenderer({
    breaks: config.breakOnSingleNewLine,
    math: config.math,
    mermaid: config.mermaid,
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
