/*
 * Typed access to the `markdownTranslate.*` settings.
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

export const SECTION = 'markdownTranslate';

export interface PreviewConfig {
  previewTheme: PreviewTheme;
  codeBlockTheme: CodeBlockTheme;
  previewColorScheme: PreviewColorScheme;
  scrollSync: boolean;
  liveUpdateDebounceMs: number;
  breakOnSingleNewLine: boolean;
  math: boolean;
  mermaid: boolean;
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
      scheme === 'selectedPreviewTheme' || scheme === 'systemColorScheme'
        ? scheme
        : 'editorColorScheme',
    scrollSync: c.get<boolean>('scrollSync', true),
    liveUpdateDebounceMs: Math.max(0, c.get<number>('liveUpdateDebounceMs', 300)),
    breakOnSingleNewLine: c.get<boolean>('breakOnSingleNewLine', false),
    math: c.get<boolean>('math.enabled', true),
    mermaid: c.get<boolean>('mermaid.enabled', true),
    chromePath: c.get<string>('chromePath', '').trim(),
  };
}

export function editorColorScheme(): 'light' | 'dark' {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}
