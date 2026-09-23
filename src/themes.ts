/*
 * Preview and code block themes.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Theme tables adapted from crossnote (markdown-engine/index.ts) and
 * Markdown Preview Enhanced (notebooks-manager.ts), University of
 * Illinois/NCSA License, Copyright (c) 2017 ~ 2023 Yiyi Wang.
 */

export const PREVIEW_THEMES = [
  'github-light.css',
  'github-dark.css',
  'sepia.css',
  'newsprint.css',
  'atom-light.css',
  'atom-dark.css',
  'atom-material.css',
  'one-light.css',
  'one-dark.css',
  'solarized-light.css',
  'solarized-dark.css',
  'gothic.css',
  'medium.css',
  'monokai.css',
  'night.css',
  'vue.css',
  'vscode.css',
] as const;

export type PreviewTheme = (typeof PREVIEW_THEMES)[number];

export const CODE_BLOCK_THEMES = [
  'auto.css',
  'atom-dark.css',
  'atom-light.css',
  'atom-material.css',
  'coy.css',
  'darcula.css',
  'dark.css',
  'default.css',
  'funky.css',
  'github.css',
  'github-dark.css',
  'hopscotch.css',
  'monokai.css',
  'okaidia.css',
  'one-dark.css',
  'one-light.css',
  'pen-paper-coffee.css',
  'pojoaque.css',
  'solarized-dark.css',
  'solarized-light.css',
  'twilight.css',
  'vs.css',
  'vscode.css',
  'vue.css',
  'xonokai.css',
] as const;

export type CodeBlockTheme = (typeof CODE_BLOCK_THEMES)[number];

export type ColorScheme = 'light' | 'dark';

export type PreviewColorScheme =
  | 'selectedPreviewTheme'
  | 'editorColorScheme'
  | 'systemColorScheme';

/** Code block theme picked when `codeBlockTheme` is `auto.css`. */
const AUTO_CODE_BLOCK_THEME: Record<PreviewTheme, CodeBlockTheme> = {
  'atom-dark.css': 'atom-dark.css',
  'atom-light.css': 'atom-light.css',
  'atom-material.css': 'atom-material.css',
  'github-dark.css': 'github-dark.css',
  'github-light.css': 'github.css',
  'gothic.css': 'github.css',
  'medium.css': 'github.css',
  'monokai.css': 'monokai.css',
  'newsprint.css': 'pen-paper-coffee.css',
  'night.css': 'darcula.css',
  'one-dark.css': 'one-dark.css',
  'one-light.css': 'one-light.css',
  'sepia.css': 'pen-paper-coffee.css',
  'solarized-light.css': 'solarized-light.css',
  'solarized-dark.css': 'solarized-dark.css',
  'vue.css': 'vue.css',
  'vscode.css': 'vscode.css',
};

/** Themes that ship as a light/dark pair. */
const THEME_PAIRS: Array<[PreviewTheme, PreviewTheme]> = [
  ['atom-light.css', 'atom-dark.css'],
  ['github-light.css', 'github-dark.css'],
  ['one-light.css', 'one-dark.css'],
  ['solarized-light.css', 'solarized-dark.css'],
];

const DARK_THEMES = new Set<PreviewTheme>([
  'atom-dark.css',
  'atom-material.css',
  'github-dark.css',
  'monokai.css',
  'night.css',
  'one-dark.css',
  'solarized-dark.css',
]);

export function isPreviewTheme(value: unknown): value is PreviewTheme {
  return (PREVIEW_THEMES as readonly unknown[]).includes(value);
}

export function isCodeBlockTheme(value: unknown): value is CodeBlockTheme {
  return (CODE_BLOCK_THEMES as readonly unknown[]).includes(value);
}

/**
 * Swap a paired theme to the variant matching `scheme`. Unpaired themes
 * (sepia, newsprint, monokai, ...) are returned unchanged: the user picked
 * them explicitly.
 */
export function themeForColorScheme(
  theme: PreviewTheme,
  scheme: ColorScheme,
): PreviewTheme {
  for (const [light, dark] of THEME_PAIRS) {
    if (theme === light || theme === dark) {
      return scheme === 'light' ? light : dark;
    }
  }
  return theme;
}

export function resolvePreviewTheme(
  theme: PreviewTheme,
  colorScheme: PreviewColorScheme,
  editorScheme: ColorScheme,
  systemScheme: ColorScheme,
): PreviewTheme {
  switch (colorScheme) {
    case 'editorColorScheme':
      return themeForColorScheme(theme, editorScheme);
    case 'systemColorScheme':
      return themeForColorScheme(theme, systemScheme);
    default:
      return theme;
  }
}

export function resolveCodeBlockTheme(
  codeBlockTheme: CodeBlockTheme,
  previewTheme: PreviewTheme,
): CodeBlockTheme {
  return codeBlockTheme === 'auto.css'
    ? AUTO_CODE_BLOCK_THEME[previewTheme]
    : codeBlockTheme;
}

/**
 * Whether a theme has a dark background. `vscode.css` follows the editor,
 * so its answer depends on `editorScheme`.
 */
export function colorSchemeOfTheme(
  theme: PreviewTheme,
  editorScheme: ColorScheme,
): ColorScheme {
  if (theme === 'vscode.css') {
    return editorScheme;
  }
  return DARK_THEMES.has(theme) ? 'dark' : 'light';
}

/**
 * Exports render outside VS Code, where the `--vscode-*` variables the
 * vscode themes rely on do not exist.
 */
export function themesForExport(
  previewTheme: PreviewTheme,
  codeBlockTheme: CodeBlockTheme,
): { previewTheme: PreviewTheme; codeBlockTheme: CodeBlockTheme } {
  return {
    previewTheme: previewTheme === 'vscode.css' ? 'github-light.css' : previewTheme,
    codeBlockTheme: codeBlockTheme === 'vscode.css' ? 'default.css' : codeBlockTheme,
  };
}
