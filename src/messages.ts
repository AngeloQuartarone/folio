/*
 * Messages exchanged between the extension host and the preview webview.
 * Copyright (c) 2026 Angelo Quartarone.
 */

/** Commands the webview may ask the host to run (nothing else is accepted). */
export type WebviewCommand =
  | 'downloadModels'
  | 'downloadDictionary'
  | 'openTranslationSettings'
  | 'exportPdf'
  | 'exportHtml'
  | 'manageOfflineLanguages'
  | 'openSettings';

/** How a setting is edited in the preview's settings. */
export type SettingControl =
  | { kind: 'toggle'; value: boolean }
  | { kind: 'select'; value: string; options: Choice[] }
  | { kind: 'number'; value: number; min: number; max: number; step: number; unit: string }
  /** A file or folder, chosen with VS Code's dialog (never typed in the webview). */
  | { kind: 'path'; value: string; placeholder: string };

/** One `folio.*` setting, with its current value. */
export type SettingItem = { key: string; label: string; description?: string } & SettingControl;

export interface SettingSection {
  id: string;
  title: string;
  items: SettingItem[];
  /** Shows the offline languages list after the items. */
  languages?: boolean;
  /** Shows the export buttons after the items. */
  exports?: boolean;
}

/** An offline language as shown in the quick settings panel. */
export interface LanguageStatus {
  code: string;
  label: string;
  /** `builtin`: English, the pivot language, needs no model of its own. */
  state: 'builtin' | 'installed' | 'partial' | 'missing' | 'downloading';
  /** What is left to download, e.g. "45 MB" (empty when nothing is). */
  size: string;
}

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
      /** Single words: other meanings from the dictionary, most common first. */
      alternatives?: string[];
      /** Single words whose dictionary is not installed yet: offer it. */
      action?: { label: string; command: WebviewCommand };
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
  | { type: 'languages'; languages: LanguageStatus[] }
  /** Current values of every setting, after one changed. */
  | { type: 'settings'; sections: SettingSection[] }
  /** The notes of the previewed document (after loading and after each change). */
  | { type: 'notes'; sourceUri: string; notes: NoteData[] }
  | TranslationReply;

/** Webview → extension host. */
export type WebviewMessage =
  | { type: 'ready'; systemColorScheme: 'light' | 'dark' }
  | { type: 'revealLine'; sourceUri: string; line: number }
  /**
   * Text selected in the preview, to select in the source editor too (lines
   * 0-based, end exclusive); `text` is empty when the selection was cleared.
   */
  | { type: 'selectSource'; sourceUri: string; line: number; endLine: number; text: string; occurrence: number }
  | { type: 'openLink'; sourceUri: string; href: string }
  | { type: 'translate'; id: number; text: string; context: string }
  | { type: 'command'; command: WebviewCommand }
  | { type: 'languageModels'; action: 'download' | 'remove'; language: string }
  /** The first source line visible in the preview, to resume reading there. */
  | { type: 'readingPosition'; sourceUri: string; line: number }
  | { type: 'note'; sourceUri: string; action: 'add' | 'update' | 'delete'; note: NoteData }
  /** Validated by the host against the settings description. */
  | { type: 'setSetting'; key: string; value: unknown }
  /** Pick a path setting with a dialog, or reset a setting to its default. */
  | { type: 'choosePath'; key: string }
  | { type: 'resetSetting'; key: string };

/** Settings the webview reads from `<meta id="preview-settings">`. */
export interface WebviewSettings {
  scrollSync: boolean;
  mermaidTheme: 'default' | 'dark';
  mermaidScriptUri: string;
  translationEnabled: boolean;
  /** Every setting, grouped for the settings view (the quick panel uses a few). */
  sections: SettingSection[];
  /** Typography and the reading aids (table of contents, focus mode…). */
  reading: ReadingSettings;
}

/** A note on some text of the document (see src/notes/notesStore.ts). */
export interface NoteData {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  /** 1-based source line of the block the quote was in. */
  line: number;
  text: string;
  created: string;
  updated: string;
}

export interface ReadingSettings {
  fontSize: number;
  lineHeight: 'compact' | 'comfortable' | 'airy';
  width: 'narrow' | 'medium' | 'wide' | 'full';
  font: 'theme' | 'sans' | 'serif';
  outline: boolean;
  progress: boolean;
  focusMode: boolean;
  resume: boolean;
  notes: boolean;
}
