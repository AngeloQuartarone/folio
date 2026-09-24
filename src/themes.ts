/*
 * Preview and code block themes.
 *
 * Copyright (c) 2026 Angelo Quartarone.
 * Theme tables adapted from crossnote (markdown-engine/index.ts) and
 * Markdown Preview Enhanced (notebooks-manager.ts), University of
 * Illinois/NCSA License, Copyright (c) 2017 ~ 2023 Yiyi Wang.
 */

export const PREVIEW_THEMES = ['github-light.css', 'github-dark.css', 'sepia.css'] as const;

export type PreviewTheme = (typeof PREVIEW_THEMES)[number];

/** Names shown in the preview's quick settings. */
export const PREVIEW_THEME_LABELS: Record<PreviewTheme, string> = {
  'github-light.css': 'Light',
  'github-dark.css': 'Dark',
  'sepia.css': 'Sepia',
};

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
  'github-light.css': 'github.css',
  'github-dark.css': 'github-dark.css',
  'sepia.css': 'pen-paper-coffee.css',
};

/** Themes that ship as a light/dark pair. */
const THEME_PAIRS: Array<[PreviewTheme, PreviewTheme]> = [['github-light.css', 'github-dark.css']];

const DARK_THEMES = new Set<PreviewTheme>(['github-dark.css']);

export function isPreviewTheme(value: unknown): value is PreviewTheme {
  return (PREVIEW_THEMES as readonly unknown[]).includes(value);
}

export function isCodeBlockTheme(value: unknown): value is CodeBlockTheme {
  return (CODE_BLOCK_THEMES as readonly unknown[]).includes(value);
}

/**
 * Swap a paired theme to the variant matching `scheme`. Sepia is returned
 * unchanged: the user picked it explicitly.
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

/** Whether a theme has a dark background. */
export function colorSchemeOfTheme(theme: PreviewTheme): ColorScheme {
  return DARK_THEMES.has(theme) ? 'dark' : 'light';
}

/**
 * Exports are for paper and sharing: always the Light theme, whatever the
 * preview shows. They also render outside VS Code, where the `--vscode-*`
 * variables the vscode code block theme relies on do not exist.
 */
export function themesForExport(
  codeBlockTheme: CodeBlockTheme,
): { previewTheme: PreviewTheme; codeBlockTheme: CodeBlockTheme } {
  const previewTheme: PreviewTheme = 'github-light.css';
  const code = resolveCodeBlockTheme(codeBlockTheme, previewTheme);
  return { previewTheme, codeBlockTheme: code === 'vscode.css' ? 'default.css' : code };
}
