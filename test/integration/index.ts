/*
 * Integration tests, run inside a real VS Code (Extension Development Host)
 * by scripts/run-integration-tests.mjs.
 */
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import Mocha from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { HostMessage, TranslationReply, WebviewMessage } from '../../src/messages';

const EXTENSION_ID = 'your-publisher-id.markdown-translate-preview';

function fixture(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  return vscode.Uri.joinPath(folder, name);
}

async function activate(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(extension, 'extension is installed');
  return extension.activate();
}

function waitForMessage(
  api: ExtensionApi,
  predicate: (message: WebviewMessage) => boolean,
  timeoutMs = 20_000,
): Promise<WebviewMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for webview')), timeoutMs);
    api.preview.onDidReceiveMessage((message) => {
      if (predicate(message)) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
}

function previewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.endsWith('markdownTranslate.preview'),
    );
}

/** Feed a webview message to the controller and capture its reply. */
function translateThroughHost(api: ExtensionApi, text: string, context: string): Promise<TranslationReply> {
  return new Promise((resolve) => {
    const original = api.preview.postMessage.bind(api.preview);
    api.preview.postMessage = (message: HostMessage) => {
      if (message.type === 'translation') {
        api.preview.postMessage = original;
        resolve(message);
      }
      original(message);
    };
    // Same entry point the webview's postMessage reaches.
    void (api.translation as any).onMessage({ type: 'translate', id: 1, text, context });
  });
}

function defineTests(): void {
  describe('Markdown Translate Preview', function () {
    this.timeout(60_000);

    it('opens the preview and the webview script runs under the CSP', async () => {
      const api = await activate();
      const document = await vscode.workspace.openTextDocument(fixture('sample.md'));
      await vscode.window.showTextDocument(document);
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      await vscode.commands.executeCommand('markdownTranslate.openPreviewToTheSide');
      await ready;
      assert.equal(previewTabs().length, 1);
      assert.equal(api.preview.activeSourceUri?.toString(), document.uri.toString());
    });

    it('reloads the preview when the theme changes', async () => {
      const api = await activate();
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      const config = vscode.workspace.getConfiguration('markdownTranslate');
      await config.update('previewTheme', 'sepia.css', vscode.ConfigurationTarget.Global);
      await ready;
      assert.ok(api.preview.webviewPanel?.webview.html.includes('preview_theme/sepia.css'));
      await config.update('previewTheme', undefined, vscode.ConfigurationTarget.Global);
    });

    it('exports HTML next to the Markdown file', async () => {
      const output = fixture('sample.html').fsPath;
      rmSync(output, { force: true });
      await vscode.commands.executeCommand('markdownTranslate.exportHtml', fixture('sample.md'));
      assert.ok(existsSync(output));
      const html = readFileSync(output, 'utf8');
      assert.match(html, /<h1 id="sample-document"/);
      assert.match(html, /class="katex"/);
      assert.match(html, /mermaid\.initialize/);
      assert.doesNotMatch(html, /<script[^>]*\ssrc=/, 'no external scripts');
      assert.doesNotMatch(html, /title: Sample/);
      rmSync(output, { force: true });
    });

    it('offers to download a missing model instead of using the network', async () => {
      const api = await activate();
      const empty = mkdtempSync(path.join(tmpdir(), 'mtp-nomodels-'));
      const config = vscode.workspace.getConfiguration('markdownTranslate');
      try {
        await config.update('modelsPath', empty, vscode.ConfigurationTarget.Global);
        const reply = await translateThroughHost(api, 'cat', 'The cat sleeps on the sofa.');
        assert.equal(reply.status, 'error');
        if (reply.status === 'error') {
          assert.match(reply.message, /English → Italian model is not installed/);
          assert.equal(reply.action?.command, 'downloadModels');
          assert.match(reply.action?.label ?? '', /Download \(\d+ MB\)/);
        }
      } finally {
        await config.update('modelsPath', undefined, vscode.ConfigurationTarget.Global);
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('translates offline with the Bergamot engine', async function () {
      // Needs models on disk (e.g. downloaded once with "Manage Offline Languages").
      const modelsDir = process.env['MTP_MODELS_DIR'];
      if (!modelsDir) {
        this.skip();
      }
      const api = await activate();
      const config = vscode.workspace.getConfiguration('markdownTranslate');
      try {
        await config.update('modelsPath', modelsDir, vscode.ConfigurationTarget.Global);
        await config.update('targetLanguage', 'it', vscode.ConfigurationTarget.Global);

        const sentence = await translateThroughHost(api, 'The cat sleeps on the sofa.', 'The cat sleeps on the sofa.');
        assert.deepEqual(
          sentence.status === 'ok' && [sentence.text, sentence.sourceLabel, sentence.targetLabel],
          ['Il gatto dorme sul divano.', 'English', 'Italian'],
        );

        const word = await translateThroughHost(api, 'Gift', 'Das ist ein Gift, trink es nicht.');
        assert.equal(word.status === 'ok' && word.text, 'veleno');

        const same = await translateThroughHost(api, 'gatto', 'Il gatto dorme sul divano.');
        assert.equal(same.status === 'ok' && same.sameLanguage, true);
      } finally {
        for (const key of ['modelsPath', 'targetLanguage']) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    });

    it('exports PDF when a Chromium browser is available', async function () {
      const { findChrome } = await import('../../src/export/chrome');
      if (!findChrome('')) {
        this.skip();
      }
      const output = fixture('sample.pdf').fsPath;
      rmSync(output, { force: true });
      await vscode.commands.executeCommand('markdownTranslate.exportPdf', fixture('sample.md'));
      assert.ok(existsSync(output), 'PDF written');
      assert.equal(readFileSync(output).subarray(0, 5).toString(), '%PDF-');
      if (!process.env['KEEP_EXPORTS']) {
        rmSync(output, { force: true });
      }
    });
  });
}

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60_000 });
  mocha.suite.emit('pre-require', globalThis, 'integration', mocha);
  defineTests();
  return new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} integration test(s) failed`)) : resolve(),
    );
  });
}


