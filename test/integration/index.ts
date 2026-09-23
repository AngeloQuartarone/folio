/*
 * Integration tests, run inside a real VS Code (Extension Development Host)
 * by scripts/run-integration-tests.mjs.
 */
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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

/** Minimal LibreTranslate-compatible server. */
async function fakeLibreTranslate(): Promise<{ url: string; requests: any[]; close(): void }> {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      requests.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/detect') {
        res.end(JSON.stringify([{ language: json.q.startsWith('Ciao') ? 'it' : 'en', confidence: 90 }]));
      } else if (json.q === 'quota') {
        res.statusCode = 429;
        res.end(JSON.stringify({ error: 'Too many requests' }));
      } else {
        res.end(JSON.stringify({ translatedText: `[${json.target}] ${json.q}` }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => server.close() };
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
      assert.match(html, /mermaid\.min\.js/);
      assert.doesNotMatch(html, /title: Sample/);
      rmSync(output, { force: true });
    });

    it('translates through the extension host (LibreTranslate)', async () => {
      const api = await activate();
      const server = await fakeLibreTranslate();
      const config = vscode.workspace.getConfiguration('markdownTranslate');
      try {
        await config.update('provider', 'libretranslate', vscode.ConfigurationTarget.Global);
        await config.update('libreTranslateUrl', server.url, vscode.ConfigurationTarget.Global);
        await config.update('targetLanguage', 'it', vscode.ConfigurationTarget.Global);

        const reply = await translateThroughHost(api, 'cat', 'The cat sleeps.');
        assert.equal(reply.status, 'ok');
        if (reply.status === 'ok') {
          assert.equal(reply.text, '[it] cat');
          assert.equal(reply.sourceLabel, 'English');
          assert.equal(reply.targetLabel, 'Italian');
        }
        assert.deepEqual(server.requests[0], { path: '/detect', body: { q: 'The cat sleeps.' } });

        const cachedCount = server.requests.length;
        await translateThroughHost(api, 'cat', 'The cat sleeps.');
        assert.equal(server.requests.length, cachedCount, 'second lookup served from cache');

        const same = await translateThroughHost(api, 'Ciao', 'Ciao a tutti.');
        assert.equal(same.status === 'ok' && same.sameLanguage, true);

        const quota = await translateThroughHost(api, 'quota', 'quota');
        assert.equal(quota.status, 'error');
      } finally {
        server.close();
        for (const key of ['provider', 'libreTranslateUrl', 'targetLanguage']) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    });

    it('offers "Set API Key" when the DeepL key is missing', async () => {
      const api = await activate();
      const reply = await translateThroughHost(api, 'hello', 'hello world');
      assert.equal(reply.status, 'error');
      if (reply.status === 'error') {
        assert.match(reply.message, /No DeepL API key/);
        assert.deepEqual(reply.action, { label: 'Set API Key', command: 'setApiKey' });
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


