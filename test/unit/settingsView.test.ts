import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isKnownSetting, pathSetting, settingsSections, validSetting } from '../../src/settingsView';

const contributed = Object.keys(
  JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).contributes.configuration.properties,
).map((key) => key.replace(/^folio\./, ''));

describe('settings view', () => {
  it('shows every contributed setting exactly once', () => {
    const keys = settingsSections(() => undefined).flatMap((section) => section.items.map((item) => item.key));
    assert.deepEqual([...keys].sort(), [...contributed].sort());
  });

  it('reads current values, falling back to the defaults', () => {
    const values: Record<string, unknown> = { previewTheme: 'sepia.css', scrollSync: false, codeBlockTheme: 'nope.css' };
    const items = settingsSections((key) => values[key]).flatMap((section) => section.items);
    const value = (key: string) => items.find((item) => item.key === key)?.value;
    assert.equal(value('previewTheme'), 'sepia.css');
    assert.equal(value('scrollSync'), false);
    assert.equal(value('codeBlockTheme'), 'auto.css', 'invalid values show the default');
    assert.equal(value('translation.modelsPath'), '');
  });

  it('clamps numbers for display', () => {
    const items = settingsSections((key) => (key === 'liveUpdateDebounceMs' ? 5000 : undefined)).flatMap((s) => s.items);
    assert.equal(items.find((item) => item.key === 'liveUpdateDebounceMs')?.value, 2000);
  });

  it('accepts only valid values from the webview', () => {
    assert.equal(validSetting('previewTheme', 'github-dark.css'), 'github-dark.css');
    assert.equal(validSetting('previewTheme', '../../evil.css'), undefined);
    assert.equal(validSetting('translation.targetLanguage', 'de'), 'de');
    assert.equal(validSetting('translation.targetLanguage', 'ja'), undefined);
    assert.equal(validSetting('scrollSync', 'yes'), undefined);
    assert.equal(validSetting('liveUpdateDebounceMs', 500), 500);
    assert.equal(validSetting('liveUpdateDebounceMs', -1), undefined);
    assert.equal(validSetting('chromePath', '/bin/sh'), undefined, 'paths only through the dialog');
    assert.equal(validSetting('translation.modelsPath', '/tmp'), undefined);
    assert.equal(validSetting('editor.fontSize', 12), undefined);
  });

  it('describes path settings for the dialog', () => {
    assert.deepEqual(pathSetting('translation.modelsPath'), { folder: true });
    assert.deepEqual(pathSetting('chromePath'), { folder: false });
    assert.equal(pathSetting('previewTheme'), undefined);
    assert.equal(isKnownSetting('scrollSync'), true);
    assert.equal(isKnownSetting('other'), false);
  });
});
