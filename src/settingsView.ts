/*
 * The settings shown in the preview: sections, labels, choices, and the
 * validation of every change the webview asks for. No VS Code API: unit
 * tested. The keys are `folio.*` settings (see package.json).
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { Choice, SettingItem, SettingSection } from './messages';
import { CODE_BLOCK_THEMES, PREVIEW_THEMES, PREVIEW_THEME_LABELS } from './themes';
import { languageName } from './translation/languages';
import { SUPPORTED_LANGUAGES } from './translation/offline/registry';

type Control =
  | { kind: 'toggle'; default: boolean }
  | { kind: 'select'; default: string; options: Choice[] }
  | { kind: 'number'; default: number; min: number; max: number; step: number; unit: string }
  | { kind: 'text'; default: string; placeholder: string; maxLength: number }
  | { kind: 'path'; default: string; placeholder: string; folder: boolean };

type Definition = { key: string; label: string; description?: string } & Control;

interface SectionDefinition {
  id: string;
  title: string;
  items: Definition[];
  languages?: boolean;
  exports?: boolean;
}

const languages = (): Choice[] =>
  SUPPORTED_LANGUAGES.map((value) => ({ value, label: languageName(value) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

const codeBlockThemeLabel = (file: string) =>
  file === 'auto.css'
    ? 'Auto (matches the theme)'
    : file
        .replace(/\.css$/, '')
        .split('-')
        .map((word) => (word === 'vs' ? 'VS' : word.charAt(0).toUpperCase() + word.slice(1)))
        .join(' ');

const SECTIONS: SectionDefinition[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    items: [
      {
        key: 'previewTheme',
        label: 'Theme',
        kind: 'select',
        default: 'github-light.css',
        options: PREVIEW_THEMES.map((value) => ({ value, label: PREVIEW_THEME_LABELS[value] })),
      },
      {
        key: 'previewColorScheme',
        label: 'Light or dark',
        description: 'Keep the theme you pick, or switch between Light and Dark with the editor or the system.',
        kind: 'select',
        default: 'selectedPreviewTheme',
        options: [
          { value: 'selectedPreviewTheme', label: 'Keep my choice' },
          { value: 'editorColorScheme', label: 'Follow the editor' },
          { value: 'systemColorScheme', label: 'Follow the system' },
        ],
      },
      {
        key: 'codeBlockTheme',
        label: 'Code blocks',
        description: 'Syntax highlighting of code blocks.',
        kind: 'select',
        default: 'auto.css',
        options: CODE_BLOCK_THEMES.map((value) => ({ value, label: codeBlockThemeLabel(value) })),
      },
    ],
  },
  {
    id: 'reading',
    title: 'Reading',
    items: [
      {
        key: 'reading.fontSize',
        label: 'Text size',
        kind: 'number',
        default: 16,
        min: 13,
        max: 24,
        step: 1,
        unit: 'px',
      },
      {
        key: 'reading.lineHeight',
        label: 'Line spacing',
        kind: 'select',
        default: 'comfortable',
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'airy', label: 'Airy' },
        ],
      },
      {
        key: 'reading.width',
        label: 'Column width',
        kind: 'select',
        default: 'medium',
        options: [
          { value: 'narrow', label: 'Narrow' },
          { value: 'medium', label: 'Medium' },
          { value: 'wide', label: 'Wide' },
          { value: 'full', label: 'Full width' },
        ],
      },
      {
        key: 'reading.font',
        label: 'Font',
        kind: 'select',
        default: 'theme',
        options: [
          { value: 'theme', label: 'Theme' },
          { value: 'sans', label: 'Sans-serif' },
          { value: 'serif', label: 'Serif' },
          { value: 'hyperlegible', label: 'Atkinson Hyperlegible' },
          { value: 'dyslexic', label: 'OpenDyslexic' },
        ],
      },
      {
        key: 'reading.justify',
        label: 'Justify text',
        description: 'Even margins on both sides, with long words hyphenated.',
        kind: 'toggle',
        default: false,
      },
      {
        key: 'reading.outline',
        label: 'Table of contents',
        description: 'A button that opens the headings of the document, with the one you are reading highlighted.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.outlineFit',
        label: 'Make room for contents',
        description: 'Widen a narrow preview so the table of contents fits beside the text, taking room from the editor next to it. “Always” gives the room back when it closes.',
        kind: 'select',
        default: 'once',
        options: [
          { value: 'once', label: 'First time' },
          { value: 'always', label: 'Always' },
          { value: 'never', label: 'Never' },
        ],
      },
      {
        key: 'reading.outlineAutoClose',
        label: 'Click text to close contents',
        description: 'When the table of contents floats over the text, a click on the text closes it.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.collapsible',
        label: 'Fold sections',
        description: 'An arrow next to each heading folds its section.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.hoverPreviews',
        label: 'Previews on hover',
        description: 'Footnotes and link targets appear when the pointer rests on them.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.keyboard',
        label: 'Keyboard navigation',
        description: 'j/k paragraphs, J/K headings, g/G top and bottom, t contents, Alt+← back.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.progress',
        label: 'Reading time and progress',
        description: 'How long the document takes to read, and a thin progress bar at the top.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'reading.focusMode',
        label: 'Focus mode',
        description: 'Dim everything except the paragraph you are reading.',
        kind: 'toggle',
        default: false,
      },
      {
        key: 'reading.focusScope',
        label: 'Focus on',
        description: 'What stays clear in focus mode.',
        kind: 'select',
        default: 'paragraph',
        options: [
          { value: 'paragraph', label: 'Paragraph' },
          { value: 'sentence', label: 'Sentence' },
        ],
      },
      {
        key: 'reading.resume',
        label: 'Resume reading',
        description: 'Reopen each document where you stopped, when the preview is not following an editor.',
        kind: 'toggle',
        default: true,
      },
    ],
  },
  {
    id: 'translation',
    title: 'Translation',
    items: [
      {
        key: 'translation.enabled',
        label: 'Translation on selection',
        description: 'Show a translation when you select text in the preview.',
        kind: 'toggle',
        default: true,
      },
      { key: 'translation.targetLanguage', label: 'Translate into', kind: 'select', default: 'it', options: languages() },
      {
        key: 'translation.sourceLanguage',
        label: 'Documents written in',
        description: 'Auto detects the language of each selection.',
        kind: 'select',
        default: 'auto',
        options: [{ value: 'auto', label: 'Auto' }, ...languages()],
      },
      {
        key: 'translation.modelsPath',
        label: 'Models folder',
        description: 'Where language models and dictionaries are kept.',
        kind: 'path',
        default: '',
        placeholder: 'Extension storage',
        folder: true,
      },
    ],
  },
  {
    id: 'languages',
    title: 'Offline languages',
    items: [],
    languages: true,
  },
  {
    id: 'preview',
    title: 'Preview',
    items: [
      {
        key: 'scrollSync',
        label: 'Scroll sync',
        description: 'Scroll the editor and the preview together.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'breakOnSingleNewLine',
        label: 'Line breaks',
        description: 'Show a single line break as a new line (GitHub does not).',
        kind: 'toggle',
        default: false,
      },
      { key: 'math.enabled', label: 'Math', description: 'Render $…$ and $$…$$ with KaTeX.', kind: 'toggle', default: true },
      {
        key: 'mermaid.enabled',
        label: 'Mermaid diagrams',
        description: 'Render mermaid code blocks as diagrams.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'wikiLinks',
        label: 'Wiki links',
        description: 'Render [[Page]] links, as Obsidian writes them.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'frontMatter',
        label: 'Front matter',
        description: 'The metadata at the top of a document: hidden, or shown as a header.',
        kind: 'select',
        default: 'hide',
        options: [
          { value: 'hide', label: 'Hide' },
          { value: 'show', label: 'Show' },
        ],
      },
      {
        key: 'customCss',
        label: 'Your stylesheet',
        description: 'A CSS file applied after Folio’s styles, in the preview and in exports.',
        kind: 'path',
        default: '',
        placeholder: 'None',
        folder: false,
      },
      {
        key: 'liveUpdateDebounceMs',
        label: 'Update delay',
        description: 'Wait after an edit before updating the preview.',
        kind: 'number',
        default: 300,
        min: 0,
        max: 2000,
        step: 50,
        unit: 'ms',
      },
      {
        key: 'notes.enabled',
        label: 'Notes',
        description: 'Add notes to selected text.',
        kind: 'toggle',
        default: true,
      },
      {
        key: 'notes.storage',
        label: 'Keep notes',
        description: 'In the document, notes travel with the file and an AI reading it sees them; other Markdown viewers hide them.',
        kind: 'select',
        default: 'document',
        options: [
          { value: 'document', label: 'In the document' },
          { value: 'sidecar', label: 'In a file next to it' },
        ],
      },
      {
        key: 'notes.author',
        label: 'Your name on notes',
        description: 'Shown on your notes and replies.',
        kind: 'text',
        default: '',
        placeholder: 'Git user name',
        maxLength: 100,
      },
      {
        key: 'hideBuiltInPreviewButton',
        label: 'Hide VS Code preview button',
        description: 'Show only this preview’s button in the editor title bar.',
        kind: 'toggle',
        default: true,
      },
    ],
  },
  {
    id: 'export',
    title: 'Export',
    items: [
      {
        key: 'chromePath',
        label: 'Browser for PDF',
        description: 'Chrome, Chromium, Edge or Brave.',
        kind: 'path',
        default: '',
        placeholder: 'Detected automatically',
        folder: false,
      },
    ],
    exports: true,
  },
];

const DEFINITIONS = new Map(SECTIONS.flatMap((section) => section.items).map((item) => [item.key, item]));

/** Every section with the current values, read through `get`. */
export function settingsSections(get: (key: string) => unknown): SettingSection[] {
  return SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    ...(section.languages && { languages: true }),
    ...(section.exports && { exports: true }),
    items: section.items.map((definition): SettingItem => {
      const { default: fallback, ...rest } = definition;
      const raw = get(definition.key);
      if (rest.kind === 'path') {
        const { folder: _folder, ...path } = rest;
        return { ...path, value: typeof raw === 'string' ? raw.trim() : '' };
      }
      if (rest.kind === 'text') {
        return { ...rest, value: typeof raw === 'string' ? raw.trim().slice(0, rest.maxLength) : '' };
      }
      if (rest.kind === 'number' && typeof raw === 'number' && Number.isFinite(raw)) {
        return { ...rest, value: Math.min(rest.max, Math.max(rest.min, raw)) };
      }
      return { ...rest, value: validSetting(definition.key, raw) ?? fallback } as SettingItem;
    }),
  }));
}

/**
 * `value` if the webview may set `key` to it, else undefined. Paths are
 * never accepted: they are chosen with a dialog on the host.
 */
export function validSetting(key: string, value: unknown): string | number | boolean | undefined {
  const definition = DEFINITIONS.get(key);
  switch (definition?.kind) {
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'select':
      return definition.options.some((option) => option.value === value) ? (value as string) : undefined;
    case 'text':
      return typeof value === 'string' && value.trim().length <= definition.maxLength ? value.trim() : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= definition.min && value <= definition.max
        ? value
        : undefined;
    default:
      return undefined;
  }
}

/** For path settings: whether the dialog picks a folder or a file. */
export function pathSetting(key: string): { folder: boolean } | undefined {
  const definition = DEFINITIONS.get(key);
  return definition?.kind === 'path' ? { folder: definition.folder } : undefined;
}

export function isKnownSetting(key: string): boolean {
  return DEFINITIONS.has(key);
}
