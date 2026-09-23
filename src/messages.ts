/*
 * Messages exchanged between the extension host and the preview webview.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** Extension host → webview. */
export type HostMessage =
  | {
      type: 'update';
      html: string;
      lineCount: number;
      sourceUri: string;
      /** Keep the current scroll position instead of syncing to `line`. */
      preserveScroll: boolean;
      line?: number;
    }
  | { type: 'scrollToLine'; line: number; topRatio?: number };

/** Webview → extension host. */
export type WebviewMessage =
  | { type: 'ready'; systemColorScheme: 'light' | 'dark' }
  | { type: 'revealLine'; sourceUri: string; line: number }
  | { type: 'openLink'; sourceUri: string; href: string };

/** Settings the webview reads from `<meta id="preview-settings">`. */
export interface WebviewSettings {
  scrollSync: boolean;
  mermaidTheme: 'default' | 'dark';
  mermaidScriptUri: string;
}
