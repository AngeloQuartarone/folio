import * as assert from 'node:assert/strict';
import {
  colorSchemeOfTheme,
  resolveCodeBlockTheme,
  resolvePreviewTheme,
  themesForExport,
} from '../../src/themes';

describe('themes', () => {
  it('switches paired themes with the editor color scheme', () => {
    assert.equal(
      resolvePreviewTheme('github-light.css', 'editorColorScheme', 'dark', 'light'),
      'github-dark.css',
    );
    assert.equal(
      resolvePreviewTheme('one-dark.css', 'systemColorScheme', 'dark', 'light'),
      'one-light.css',
    );
  });

  it('keeps explicit and unpaired themes', () => {
    assert.equal(
      resolvePreviewTheme('github-light.css', 'selectedPreviewTheme', 'dark', 'dark'),
      'github-light.css',
    );
    assert.equal(resolvePreviewTheme('sepia.css', 'editorColorScheme', 'dark', 'dark'), 'sepia.css');
  });

  it('maps auto code block theme from the preview theme', () => {
    assert.equal(resolveCodeBlockTheme('auto.css', 'github-light.css'), 'github.css');
    assert.equal(resolveCodeBlockTheme('auto.css', 'sepia.css'), 'pen-paper-coffee.css');
    assert.equal(resolveCodeBlockTheme('okaidia.css', 'sepia.css'), 'okaidia.css');
  });

  it('knows which themes are dark', () => {
    assert.equal(colorSchemeOfTheme('github-dark.css', 'light'), 'dark');
    assert.equal(colorSchemeOfTheme('sepia.css', 'dark'), 'light');
    assert.equal(colorSchemeOfTheme('vscode.css', 'dark'), 'dark');
  });

  it('replaces vscode themes for export', () => {
    assert.deepEqual(themesForExport('vscode.css', 'vscode.css'), {
      previewTheme: 'github-light.css',
      codeBlockTheme: 'default.css',
    });
  });
});
