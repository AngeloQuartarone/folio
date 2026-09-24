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
  | 'openSettings'
  | 'copyNotesForAI';

/** How a setting is edited in the preview's settings. */
export type SettingControl =
  | { kind: 'toggle'; value: boolean }
  | { kind: 'select'; value: string; options: Choice[] }
  | { kind: 'number'; value: number; min: number; max: number; step: number; unit: string }
  | { kind: 'text'; value: string; placeholder: string; maxLength: number }
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
      /** The document's language (ISO 639-1), when detected: for hyphenation. */
      lang?: string;
    }
  | { type: 'scrollToLine'; line: number; topRatio?: number }
  | { type: 'translationSettings'; enabled: boolean }
  | { type: 'languages'; languages: LanguageStatus[] }
  /** Current values of every setting, after one changed. */
  | { type: 'settings'; sections: SettingSection[] }
  /** The start of another Markdown file a link points to (see linkPreview below). */
  | { type: 'linkPreview'; id: number; html: string; title: string }
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
  /** Hovering a link to another Markdown file: render the start of it. */
  | { type: 'linkPreview'; id: number; sourceUri: string; href: string }
  /** Back to a place in another Markdown document (after following a link). */
  | { type: 'navigate'; uri: string; line: number }
  | { type: 'translate'; id: number; text: string; context: string }
  | { type: 'command'; command: WebviewCommand }
  | { type: 'languageModels'; action: 'download' | 'remove'; language: string }
  /** The first source line visible in the preview, to resume reading there. */
  | { type: 'readingPosition'; sourceUri: string; line: number }
  /** A change to the notes; the host adds the author and the dates. */
  | ({ type: 'note'; sourceUri: string } & (
      | { action: 'add'; note: NoteData }
      | { action: 'edit'; id: string; text: string }
      | { action: 'reply'; id: string; text: string }
      | { action: 'delete' | 'resolve' | 'reopen'; id: string }
    ))
  /**
   * The table of contents opened in a preview too narrow to show it beside
   * the text: widen the preview from `width` to `wanted`, or at least to
   * `needed` (CSS pixels).
   */
  | { type: 'fitOutline'; width: number; wanted: number; needed: number }
  | { type: 'outlineClosed' }
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
  author?: string;
  /** Absent while the note is open. */
  status?: 'resolved';
  /** Answers, e.g. from an AI that read the notes in the document. */
  replies?: Array<{ author: string; text: string; created: string }>;
}

export interface ReadingSettings {
  fontSize: number;
  lineHeight: 'compact' | 'comfortable' | 'airy';
  width: 'narrow' | 'medium' | 'wide' | 'full';
  font: 'theme' | 'sans' | 'serif' | 'hyperlegible' | 'dyslexic';
  /** Justified, hyphenated paragraphs. */
  justify: boolean;
  outline: boolean;
  /** A click on the text closes the table of contents when it floats over it. */
  outlineAutoClose: boolean;
  /** Sections fold with an arrow next to their heading. */
  collapsible: boolean;
  /** Footnotes and link targets shown when the pointer rests on them. */
  hoverPreviews: boolean;
  /** j/k, J/K, g/G, t and Alt+← move through the document. */
  keyboard: boolean;
  progress: boolean;
  focusMode: boolean;
  focusScope: 'paragraph' | 'sentence';
  resume: boolean;
  notes: boolean;
}
