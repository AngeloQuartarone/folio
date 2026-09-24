/*
 * Typed access to the `folio.*` settings.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import * as vscode from 'vscode';
import {
  CodeBlockTheme,
  PreviewColorScheme,
  PreviewTheme,
  isCodeBlockTheme,
  isPreviewTheme,
} from './themes';

export const SECTION = 'folio';

/** Settings that require rebuilding the preview when they change. */
export const PREVIEW_SETTINGS = [
  'previewTheme',
  'codeBlockTheme',
  'previewColorScheme',
  'scrollSync',
  'breakOnSingleNewLine',
  'math.enabled',
  'mermaid.enabled',
  'wikiLinks',
  'frontMatter',
  'customCss',
  'reading',
  'notes.enabled',
].map((key) => `${SECTION}.${key}`);

export interface TranslationConfig {
  enabled: boolean;
  targetLanguage: string;
  /** "auto" or a language code. */
  sourceLanguage: string;
  /** Folder with the offline models; empty = extension storage. */
  modelsPath: string;
}

export function getTranslationConfig(): TranslationConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: c.get<boolean>('translation.enabled', true),
    targetLanguage: c.get<string>('translation.targetLanguage', 'it').trim() || 'it',
    sourceLanguage: c.get<string>('translation.sourceLanguage', 'auto').trim() || 'auto',
    modelsPath: c.get<string>('translation.modelsPath', '').trim(),
  };
}

export interface PreviewConfig {
  previewTheme: PreviewTheme;
  codeBlockTheme: CodeBlockTheme;
  previewColorScheme: PreviewColorScheme;
  scrollSync: boolean;
  liveUpdateDebounceMs: number;
  breakOnSingleNewLine: boolean;
  math: boolean;
  mermaid: boolean;
  wikiLinks: boolean;
  frontMatter: 'hide' | 'show';
  /** A CSS file of the user's, as written in the setting (see resolveUserPath). */
  customCss: string;
  chromePath: string;
}

export function getPreviewConfig(): PreviewConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const previewTheme = c.get<string>('previewTheme');
  const codeBlockTheme = c.get<string>('codeBlockTheme');
  const scheme = c.get<string>('previewColorScheme');
  return {
    previewTheme: isPreviewTheme(previewTheme) ? previewTheme : 'github-light.css',
    codeBlockTheme: isCodeBlockTheme(codeBlockTheme) ? codeBlockTheme : 'auto.css',
    previewColorScheme:
      scheme === 'editorColorScheme' || scheme === 'systemColorScheme'
        ? scheme
        : 'selectedPreviewTheme',
    scrollSync: c.get<boolean>('scrollSync', true),
    liveUpdateDebounceMs: Math.max(0, c.get<number>('liveUpdateDebounceMs', 300)),
    breakOnSingleNewLine: c.get<boolean>('breakOnSingleNewLine', false),
    math: c.get<boolean>('math.enabled', true),
    mermaid: c.get<boolean>('mermaid.enabled', true),
    wikiLinks: c.get<boolean>('wikiLinks', true),
    frontMatter: c.get<string>('frontMatter') === 'show' ? 'show' : 'hide',
    customCss: c.get<string>('customCss', '').trim(),
    chromePath: c.get<string>('chromePath', '').trim(),
  };
}

export type LineHeight = 'compact' | 'comfortable' | 'airy';
export type ColumnWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type ReadingFont = 'theme' | 'sans' | 'serif' | 'hyperlegible' | 'dyslexic';

export interface ReadingConfig {
  fontSize: number;
  lineHeight: LineHeight;
  width: ColumnWidth;
  font: ReadingFont;
  justify: boolean;
  outline: boolean;
  outlineAutoClose: boolean;
  collapsible: boolean;
  hoverPreviews: boolean;
  keyboard: boolean;
  progress: boolean;
  focusMode: boolean;
  focusScope: 'paragraph' | 'sentence';
  resume: boolean;
  notes: boolean;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

export function getReadingConfig(): ReadingConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const size = c.get<number>('reading.fontSize', 16);
  return {
    fontSize: Number.isFinite(size) ? Math.min(24, Math.max(13, Math.round(size))) : 16,
    lineHeight: oneOf(c.get('reading.lineHeight'), ['compact', 'comfortable', 'airy'] as const, 'comfortable'),
    width: oneOf(c.get('reading.width'), ['narrow', 'medium', 'wide', 'full'] as const, 'medium'),
    font: oneOf(c.get('reading.font'), ['theme', 'sans', 'serif', 'hyperlegible', 'dyslexic'] as const, 'theme'),
    justify: c.get<boolean>('reading.justify', false),
    outline: c.get<boolean>('reading.outline', true),
    outlineAutoClose: c.get<boolean>('reading.outlineAutoClose', true),
    collapsible: c.get<boolean>('reading.collapsible', true),
    hoverPreviews: c.get<boolean>('reading.hoverPreviews', true),
    keyboard: c.get<boolean>('reading.keyboard', true),
    progress: c.get<boolean>('reading.progress', true),
    focusMode: c.get<boolean>('reading.focusMode', false),
    focusScope: oneOf(c.get('reading.focusScope'), ['paragraph', 'sentence'] as const, 'paragraph'),
    resume: c.get<boolean>('reading.resume', true),
    notes: c.get<boolean>('notes.enabled', true),
  };
}

export type OutlineFit = 'once' | 'always' | 'never';

/** Whether the preview is widened to fit the table of contents (see src/preview/outlineFit.ts). */
export function getOutlineFit(): OutlineFit {
  return oneOf(vscode.workspace.getConfiguration(SECTION).get('reading.outlineFit'), ['once', 'always', 'never'] as const, 'once');
}

export type NotesStorage = 'document' | 'sidecar';

export interface NotesConfig {
  /** `document`: a comment at the end of the Markdown file; `sidecar`: `<file>.folio.json`. */
  storage: NotesStorage;
  /** Name on new notes and replies; empty = the Git user name, else the system user. */
  author: string;
}

export function getNotesConfig(): NotesConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    storage: oneOf(c.get('notes.storage'), ['document', 'sidecar'] as const, 'document'),
    author: c.get<string>('notes.author', '').trim().slice(0, 100),
  };
}

export function editorColorScheme(): 'light' | 'dark' {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}
