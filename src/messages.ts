/*
 * Messages exchanged between the extension host and the preview webview.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** Commands the webview may ask the host to run (nothing else is accepted). */
export type WebviewCommand =
  | 'downloadModels'
  | 'openTranslationSettings'
  | 'exportPdf'
  | 'exportHtml'
  | 'manageOfflineLanguages'
  | 'openSettings';

/** Settings the quick settings panel may change (validated by the host). */
export type QuickSetting =
  | { key: 'previewTheme'; value: string }
  | { key: 'targetLanguage'; value: string }
  | { key: 'enabled'; value: boolean }
  | { key: 'scrollSync'; value: boolean };

export interface Choice {
  value: string;
  label: string;
}

export type TranslationReply =
  | {
      type: 'translation';
      id: number;
      status: 'ok';
      text: string;
      /** e.g. "English" */
      sourceLabel: string;
      /** e.g. "Italian" */
      targetLabel: string;
      sameLanguage: boolean;
    }
  | {
      type: 'translation';
      id: number;
      status: 'error';
      message: string;
      action?: { label: string; command: WebviewCommand };
    };

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
  | { type: 'scrollToLine'; line: number; topRatio?: number }
  | { type: 'translationSettings'; enabled: boolean }
  | TranslationReply;

/** Webview → extension host. */
export type WebviewMessage =
  | { type: 'ready'; systemColorScheme: 'light' | 'dark' }
  | { type: 'revealLine'; sourceUri: string; line: number }
  | { type: 'openLink'; sourceUri: string; href: string }
  | { type: 'translate'; id: number; text: string; context: string }
  | { type: 'command'; command: WebviewCommand }
  | ({ type: 'setSetting' } & QuickSetting);

/** Settings the webview reads from `<meta id="preview-settings">`. */
export interface WebviewSettings {
  scrollSync: boolean;
  mermaidTheme: 'default' | 'dark';
  mermaidScriptUri: string;
  translationEnabled: boolean;
  /** Current values and choices for the quick settings panel. */
  quickSettings: {
    previewTheme: string;
    themes: Choice[];
    targetLanguage: string;
    languages: Choice[];
  };
}
