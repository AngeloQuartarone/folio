/*
 * Integration tests, run inside a real VS Code (Extension Development Host)
 * by scripts/run-integration-tests.mjs.
 */
import * as assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import Mocha from 'mocha';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import type { HostMessage, TranslationReply, WebviewMessage } from '../../src/messages';

const EXTENSION_ID = 'angeloquartarone.folio-markdown-reader';

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

/** Wait until `condition` holds (host work is asynchronous). */
async function until(condition: () => boolean | Promise<boolean>, what = 'condition', timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function previewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.endsWith('folio.preview'),
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
  describe('Folio', function () {
    this.timeout(60_000);

    it('opens the preview and the webview script runs under the CSP', async () => {
      const api = await activate();
      const document = await vscode.workspace.openTextDocument(fixture('sample.md'));
      await vscode.window.showTextDocument(document);
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      await vscode.commands.executeCommand('folio.openPreviewToTheSide');
      await ready;
      assert.equal(previewTabs().length, 1);
      assert.equal(api.preview.activeSourceUri?.toString(), document.uri.toString());
    });

    it('reloads the preview when the theme changes', async () => {
      const api = await activate();
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      const config = vscode.workspace.getConfiguration('folio');
      await config.update('previewTheme', 'sepia.css', vscode.ConfigurationTarget.Global);
      await ready;
      assert.ok(api.preview.webviewPanel?.webview.html.includes('preview_theme/sepia.css'));
      await config.update('previewTheme', undefined, vscode.ConfigurationTarget.Global);
    });

    it('applies quick settings from the preview and rejects invalid ones', async () => {
      const api = await activate();
      const config = () => vscode.workspace.getConfiguration('folio');
      const send = (message: unknown) => (api.preview as any).onMessage(message);
      try {
        send({ type: 'setSetting', key: 'translation.targetLanguage', value: 'de' });
        send({ type: 'setSetting', key: 'previewTheme', value: '../../evil.css' });
        send({ type: 'setSetting', key: 'chromePath', value: '/bin/sh' });
        send({ type: 'setSetting', key: 'liveUpdateDebounceMs', value: 450 });
        send({ type: 'setSetting', key: 'translation.modelsPath', value: '/tmp' });
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.equal(config().get('translation.targetLanguage'), 'de');
        assert.equal(config().get('previewTheme'), 'github-light.css');
        assert.equal(config().get('chromePath'), '');
        assert.equal(config().get('liveUpdateDebounceMs'), 450);
        assert.equal(config().get('translation.modelsPath'), '');
        send({ type: 'resetSetting', key: 'liveUpdateDebounceMs' });
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(config().get('liveUpdateDebounceMs'), 300);
      } finally {
        await config().update('translation.targetLanguage', undefined, vscode.ConfigurationTarget.Global);
      }
    });

    it('selects the text chosen in the preview in the visible source editor', async () => {
      const api = await activate();
      const document = await vscode.workspace.openTextDocument(fixture('sample.md'));
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      await vscode.commands.executeCommand('folio.openPreviewToTheSide');
      const line = document.getText().split('\n').findIndex((text) => text.startsWith('Some **bold**'));
      (api.preview as any).onMessage({
        type: 'selectSource',
        sourceUri: document.uri.toString(),
        line,
        endLine: line + 1,
        text: 'bold text,',
        occurrence: 0,
      });
      assert.equal(document.getText(editor.selection), 'bold** text,');
      assert.equal(editor.selection.start.line, line);
    });

    it('does not echo the preview scroll back to the preview', async () => {
      const api = await activate();
      const document = await vscode.workspace.openTextDocument(fixture('demo.md'));
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      await vscode.commands.executeCommand('folio.openPreviewToTheSide');
      await ready;
      const manager = api.preview as any;
      const sent: HostMessage[] = [];
      const post = manager.post;
      manager.post = (message: HostMessage) => {
        sent.push(message);
        post.call(manager, message);
      };
      try {
        manager.onMessage({ type: 'revealLine', sourceUri: document.uri.toString(), line: 60 });
        // A late visible-range event from the editor settling on that line.
        await new Promise((resolve) => setTimeout(resolve, 700));
        manager.onEditorScroll(editor);
        assert.deepEqual(sent.filter((message) => message.type === 'scrollToLine'), []);
      } finally {
        manager.post = post;
        // The next tests expect the preview on sample.md again.
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture('sample.md')), vscode.ViewColumn.One);
        await vscode.window.tabGroups.close(
          vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()),
        );
      }
    });

    it('never opens the source file when only the preview is visible', async () => {
      const api = await activate();
      const uri = fixture('sample.md');
      const sourceTabs = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
      await vscode.window.tabGroups.close(sourceTabs());
      assert.equal(api.preview.activeSourceUri?.toString(), uri.toString());
      (api.preview as any).onMessage({
        type: 'selectSource',
        sourceUri: uri.toString(),
        line: 6,
        endLine: 7,
        text: 'bold',
        occurrence: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(sourceTabs().length, 0);
      assert.ok(!vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === uri.toString()));
    });

    it('saves notes next to the document and removes the file when none are left', async () => {
      const api = await activate();
      const uri = fixture('sample.md');
      const file = `${uri.fsPath}.folio.json`;
      rmSync(file, { force: true });
      const config = vscode.workspace.getConfiguration('folio');
      await config.update('notes.storage', 'sidecar', vscode.ConfigurationTarget.Global);
      const sent: HostMessage[] = [];
      const original = api.preview.postMessage.bind(api.preview);
      api.preview.postMessage = (message: HostMessage) => {
        sent.push(message);
        original(message);
      };
      const note = {
        id: 'test-1',
        quote: 'bold',
        prefix: 'Some ',
        suffix: ' text',
        line: 7,
        text: 'Check this',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      try {
        (api.preview as any).onMessage({ type: 'note', sourceUri: uri.toString(), action: 'add', note });
        await until(() => existsSync(file));
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).notes[0].text, 'Check this');
        await until(() => sent.some((message) => message.type === 'notes' && message.notes.length === 1));
        (api.preview as any).onMessage({ type: 'note', sourceUri: uri.toString(), action: 'delete', id: 'test-1' });
        await until(() => !existsSync(file));
        assert.equal(readFileSync(uri.fsPath, 'utf8').includes('folio:notes'), false, 'the document is untouched');
      } finally {
        api.preview.postMessage = original;
        rmSync(file, { force: true });
        await config.update('notes.storage', undefined, vscode.ConfigurationTarget.Global);
      }
    });

    it('keeps notes in the document: moves old ones, reads replies, exports without them', async () => {
      const api = await activate();
      const uri = fixture('notes-roundtrip.md');
      const sidecar = `${uri.fsPath}.folio.json`;
      const original = '# Notes\r\n\r\nSome bold text about the river bank.\r\n';
      writeFileSync(uri.fsPath, original);
      const old = {
        id: 'old-1',
        quote: 'river bank',
        prefix: 'about the ',
        suffix: '.',
        line: 3,
        text: 'Written before notes lived in the document',
        created: '2026-09-01T10:00:00.000Z',
        updated: '2026-09-01T10:00:00.000Z',
      };
      writeFileSync(sidecar, JSON.stringify({ version: 1, notes: [old] }));
      const config = vscode.workspace.getConfiguration('folio');
      await config.update('notes.author', 'Tester', vscode.ConfigurationTarget.Global);
      const sent: HostMessage[] = [];
      const post = api.preview.postMessage.bind(api.preview);
      api.preview.postMessage = (message: HostMessage) => {
        sent.push(message);
        post(message);
      };
      const lastNotes = () => {
        const last = [...sent].reverse().find((message) => message.type === 'notes');
        return last?.type === 'notes' ? last.notes : [];
      };
      const send = (message: object) => (api.preview as any).onMessage({ type: 'note', sourceUri: uri.toString(), ...message });
      try {
        const ready = waitForMessage(api, (message) => message.type === 'ready');
        api.preview.show(uri);
        await ready;
        await until(() => lastNotes().length === 1, 'the old note is shown');

        send({
          action: 'add',
          note: { ...old, id: 'new-1', quote: 'bold', prefix: 'Some ', suffix: ' text', text: 'Check this', created: '', updated: '' },
        });
        await until(() => readFileSync(uri.fsPath, 'utf8').includes('folio:notes'), 'the note is saved in the document');
        await until(() => !existsSync(sidecar), 'the old file is removed once its notes are in the saved document');
        const saved = readFileSync(uri.fsPath, 'utf8');
        assert.ok(saved.startsWith(original), 'the text above the block is unchanged');
        assert.equal(saved.replace(/\r\n/g, '').includes('\n'), false, 'Windows line endings are kept');
        assert.match(saved, /"id":"new-1","author":"Tester"/);
        assert.match(saved, /"id":"old-1"/);

        // An AI answers in the file, on disk.
        const answered = saved.replace(
          /("id":"new-1",[^\r\n]*?)"line":/,
          '$1"replies":[{"author":"Claude","text":"Looks right."}],"line":',
        );
        assert.notEqual(answered, saved);
        writeFileSync(uri.fsPath, answered);
        await until(
          () => lastNotes().find((note) => note.id === 'new-1')?.replies?.[0]?.author === 'Claude',
          'the reply is shown',
        );

        send({ action: 'resolve', id: 'new-1' });
        await until(() => /"id":"new-1","author":"Tester","status":"resolved"/.test(readFileSync(uri.fsPath, 'utf8')));

        await vscode.commands.executeCommand('folio.copyNotesForAI', uri);
        const prompt = await vscode.env.clipboard.readText();
        assert.match(prompt, /notes-roundtrip\.md/);
        assert.match(prompt, /"river bank"/);

        const output = fixture('notes-roundtrip.html').fsPath;
        await vscode.commands.executeCommand('folio.exportHtml', uri);
        assert.doesNotMatch(readFileSync(output, 'utf8'), /folio:notes|Check this|Looks right/, 'the export has no notes');
        rmSync(output, { force: true });

        send({ action: 'delete', id: 'new-1' });
        send({ action: 'delete', id: 'old-1' });
        await until(() => readFileSync(uri.fsPath, 'utf8') === original, 'the block goes when no notes are left');
      } finally {
        api.preview.postMessage = post;
        await config.update('notes.author', undefined, vscode.ConfigurationTarget.Global);
        rmSync(uri.fsPath, { force: true });
        rmSync(sidecar, { force: true });
        api.preview.show(fixture('sample.md'));
      }
    });

    it('previews another Markdown file on hover, and goes back to a place in another document', async () => {
      const api = await activate();
      const uri = fixture('sample.md');
      const ready = waitForMessage(api, (message) => message.type === 'ready');
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
      api.preview.show(uri, vscode.ViewColumn.Beside);
      await ready.catch(() => undefined);
      const sent: HostMessage[] = [];
      const original = api.preview.postMessage.bind(api.preview);
      (api.preview as any).post = (message: HostMessage) => {
        sent.push(message);
        original(message);
      };
      try {
        (api.preview as any).onMessage({ type: 'linkPreview', id: 7, sourceUri: uri.toString(), href: './other.md#second' });
        await until(() => sent.some((message) => message.type === 'linkPreview'), 'a preview of other.md');
        const preview = sent.find((message) => message.type === 'linkPreview');
        assert.ok(preview?.type === 'linkPreview');
        assert.equal(preview.id, 7);
        assert.equal(preview.title, 'other.md › Second');
        assert.match(preview.html, /<h2 id="second"/);
        assert.doesNotMatch(preview.html, /<h1/, 'only the section the link points to');

        (api.preview as any).onMessage({ type: 'linkPreview', id: 8, sourceUri: uri.toString(), href: 'https://example.com/a.md' });
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.ok(!sent.some((message) => message.type === 'linkPreview' && message.id === 8), 'no previews of web pages');

        const other = fixture('other.md');
        (api.preview as any).onMessage({ type: 'navigate', uri: other.toString(), line: 2 });
        await until(() => vscode.window.activeTextEditor?.document.uri.toString() === other.toString(), 'other.md opens');
        assert.equal(vscode.window.activeTextEditor?.selection.active.line, 2);
        await until(() => api.preview.activeSourceUri?.toString() === other.toString(), 'the preview follows');

        (api.preview as any).onMessage({ type: 'navigate', uri: 'command:workbench.action.quit', line: 0 });
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), other.toString(), 'only Markdown files');
      } finally {
        delete (api.preview as any).post;
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
      }
    });

    it('finds wiki link pages anywhere in the workspace, and applies the user stylesheet', async () => {
      const api = await activate();
      const uri = fixture('sample.md');
      const folder = fixture('wiki-sub').fsPath;
      const page = path.join(folder, 'Wiki Target.md');
      const css = fixture('folio-test.css').fsPath;
      const config = vscode.workspace.getConfiguration('folio');
      mkdirSync(folder, { recursive: true });
      writeFileSync(page, '# Wiki Target\n\n## Part\n\nText.\n');
      writeFileSync(css, 'body { --folio-probe: 42px; }');
      try {
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
        const ready = waitForMessage(api, (message) => message.type === 'ready');
        api.preview.show(uri, vscode.ViewColumn.Beside);
        await ready.catch(() => undefined);
        (api.preview as any).onMessage({ type: 'openLink', sourceUri: uri.toString(), href: 'Wiki%20Target.md#part' });
        await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === page, 'the page is found in a subfolder');
        assert.equal(vscode.window.activeTextEditor?.selection.active.line, 2, 'at its heading');

        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
        await until(() => api.preview.activeSourceUri?.toString() === uri.toString());
        await config.update('customCss', 'folio-test.css', vscode.ConfigurationTarget.Global);
        await until(() => !!api.preview.webviewPanel?.webview.html.includes('--folio-probe: 42px'), 'the preview has the stylesheet');
        writeFileSync(css, 'body { --folio-probe: 43px; }');
        await until(() => !!api.preview.webviewPanel?.webview.html.includes('--folio-probe: 43px'), 'saving it reloads the preview');
        const output = fixture('sample.html').fsPath;
        await vscode.commands.executeCommand('folio.exportHtml', uri);
        assert.match(readFileSync(output, 'utf8'), /--folio-probe: 43px/, 'exports have it too');
        rmSync(output, { force: true });
      } finally {
        await config.update('customCss', undefined, vscode.ConfigurationTarget.Global);
        rmSync(folder, { recursive: true, force: true });
        rmSync(css, { force: true });
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
      }
    });

    it('opens Markdown files in the reader tab, and back to the source', async () => {
      const api = await activate();
      const uri = fixture('other.md');
      const config = vscode.workspace.getConfiguration('folio');
      const readerTabs = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'folio.reader');
      try {
        const ready = waitForMessage(api, (message) => message.type === 'ready');
        await vscode.commands.executeCommand('vscode.openWith', uri, 'folio.reader');
        await ready;
        assert.equal(api.preview.webviewPanel?.viewType, 'folio.reader', 'the reader tab is the preview');
        assert.equal(api.preview.activeSourceUri?.toString(), uri.toString());
        assert.equal(readerTabs().length, 1);
        assert.equal(previewTabs().length, 0, 'one preview at a time');

        await vscode.commands.executeCommand('folio.openSource', uri);
        await until(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(), 'the source opens');

        await config.update('openInReader', true, vscode.ConfigurationTarget.Global);
        await until(() => vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations')?.['*.md'] === 'folio.reader', 'associated');
        await config.update('openInReader', undefined, vscode.ConfigurationTarget.Global);
        await until(() => !vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations')?.['*.md'], 'and no more');
      } finally {
        await config.update('openInReader', undefined, vscode.ConfigurationTarget.Global);
        for (const tab of readerTabs()) {
          await vscode.window.tabGroups.close(tab);
        }
        await vscode.window.showTextDocument(fixture('sample.md'), { viewColumn: vscode.ViewColumn.One });
        const back = waitForMessage(api, (message) => message.type === 'ready');
        api.preview.show(fixture('sample.md'), vscode.ViewColumn.Beside);
        await back.catch(() => undefined);
      }
    });

    it('toggles focus mode in the preview from the command', async () => {
      const api = await activate();
      const sent: HostMessage[] = [];
      const original = api.preview.postMessage.bind(api.preview);
      api.preview.postMessage = (message: HostMessage) => {
        sent.push(message);
        original(message);
      };
      try {
        await vscode.commands.executeCommand('folio.toggleFocusMode');
        assert.ok(sent.some((message) => message.type === 'toggleFocusMode'));
      } finally {
        api.preview.postMessage = original;
      }
    });

    it('remembers where the user stopped reading', async () => {
      const api = await activate();
      const uri = fixture('sample.md');
      (api.preview as any).onMessage({ type: 'readingPosition', sourceUri: uri.toString(), line: 12 });
      assert.equal((api.preview as any).readingPosition(uri), 12);
    });

    it('exports HTML next to the Markdown file', async () => {
      const output = fixture('sample.html').fsPath;
      rmSync(output, { force: true });
      await vscode.commands.executeCommand('folio.exportHtml', fixture('sample.md'));
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
      const config = vscode.workspace.getConfiguration('folio');
      try {
        await config.update('translation.modelsPath', empty, vscode.ConfigurationTarget.Global);
        const reply = await translateThroughHost(api, 'cat', 'The cat sleeps on the sofa.');
        assert.equal(reply.status, 'error');
        if (reply.status === 'error') {
          assert.match(reply.message, /English → Italian model is not installed/);
          assert.equal(reply.action?.command, 'downloadModels');
          assert.match(reply.action?.label ?? '', /Download \(\d+ MB\)/);
        }
      } finally {
        await config.update('translation.modelsPath', undefined, vscode.ConfigurationTarget.Global);
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
      const config = vscode.workspace.getConfiguration('folio');
      try {
        await config.update('translation.modelsPath', modelsDir, vscode.ConfigurationTarget.Global);
        await config.update('translation.targetLanguage', 'it', vscode.ConfigurationTarget.Global);

        const sentence = await translateThroughHost(api, 'The cat sleeps on the sofa.', 'The cat sleeps on the sofa.');
        assert.deepEqual(
          sentence.status === 'ok' && [sentence.text, sentence.sourceLabel, sentence.targetLabel],
          ['Il gatto dorme sul divano.', 'English', 'Italian'],
        );

        const bank = await translateThroughHost(api, 'bank', 'The river bank was covered in flowers.');
        assert.equal(bank.status === 'ok' && bank.text, 'riva', 'the sentence picks the meaning');

        // German needs its own model (German → English), not always installed.
        if (existsSync(path.join(modelsDir!, 'deen'))) {
          const word = await translateThroughHost(api, 'Gift', 'Das ist ein Gift, trink es nicht.');
          assert.equal(word.status === 'ok' && word.text, 'veleno');
        }

        const same = await translateThroughHost(api, 'gatto', 'Il gatto dorme sul divano.');
        assert.equal(same.status === 'ok' && same.sameLanguage, true);
      } finally {
        for (const key of ['translation.modelsPath', 'translation.targetLanguage']) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    });

    it('translates a whole document block by block, keeping bold, links and code', async function () {
      const modelsDir = process.env['MTP_MODELS_DIR'];
      if (!modelsDir) {
        this.skip();
      }
      const api = await activate();
      const config = vscode.workspace.getConfiguration('folio');
      const uri = fixture('sample.md');
      const sent: HostMessage[] = [];
      const original = api.preview.postMessage.bind(api.preview);
      api.preview.postMessage = (message: HostMessage) => {
        sent.push(message);
        original(message);
      };
      try {
        await config.update('translation.modelsPath', modelsDir, vscode.ConfigurationTarget.Global);
        await config.update('translation.targetLanguage', 'it', vscode.ConfigurationTarget.Global);
        await config.update('translation.sourceLanguage', 'en', vscode.ConfigurationTarget.Global);
        const ready = waitForMessage(api, (message) => message.type === 'ready');
        api.preview.show(uri, vscode.ViewColumn.Beside);
        await ready.catch(() => undefined);
        (api.preview as any).onMessage({
          type: 'translateDocument',
          sourceUri: api.preview.activeSourceUri!.toString(),
          requestId: 3,
          blocks: [
            { id: 1, html: 'The <strong>cat</strong> sleeps on the <a href="#sofa">sofa</a> all afternoon.' },
            { id: 2, html: 'Run <span data-folio-keep="0"></span> to install the extension.' },
          ],
        });
        const replies = () => sent.filter((message) => message.type === 'documentTranslation' && message.requestId === 3);
        await until(() => replies().some((message) => message.type === 'documentTranslation' && message.status === 'done'), 'the document is translated', 60_000);
        const byId = (id: number) => {
          const reply = replies().find((message) => message.type === 'documentTranslation' && message.id === id);
          return reply?.type === 'documentTranslation' ? reply.html ?? '' : '';
        };
        const started = replies()[0];
        assert.ok(started?.type === 'documentTranslation' && started.status === 'started');
        assert.equal(started.type === 'documentTranslation' && `${started.sourceLabel} → ${started.targetLabel}`, 'English → Italian');
        console.log('      translated:', byId(1), '|', byId(2));
        assert.match(byId(1), /<strong>gatto<\/strong>/i);
        assert.match(byId(1), /<a href="#sofa">[^<]+<\/a>/);
        assert.match(byId(2), /<span data-folio-keep="0"><\/span>/, 'code placeholders survive');
      } finally {
        api.preview.postMessage = original;
        for (const key of ['translation.modelsPath', 'translation.targetLanguage', 'translation.sourceLanguage']) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    });

    it('offers the other meanings of a single word, and shows them from the dictionary', async function () {
      // Needs the English → Italian model; the dictionary is added in a copy of the folder.
      const modelsDir = process.env['MTP_MODELS_DIR'];
      const dictionary = process.env['MTP_DICTIONARY_EN_IT'];
      if (!modelsDir || !dictionary) {
        this.skip();
      }
      const api = await activate();
      const config = vscode.workspace.getConfiguration('folio');
      const folder = mkdtempSync(path.join(tmpdir(), 'mtp-dict-'));
      try {
        symlinkSync(path.join(modelsDir, 'enit'), path.join(folder, 'enit'));
        await config.update('translation.modelsPath', folder, vscode.ConfigurationTarget.Global);
        await config.update('translation.targetLanguage', 'it', vscode.ConfigurationTarget.Global);

        const offer = await translateThroughHost(api, 'bold', 'Some bold text in the document.');
        assert.equal(offer.status === 'ok' && offer.action?.command, 'downloadDictionary');
        assert.match((offer.status === 'ok' && offer.action?.label) || '', /Other meanings · \d+ MB/);

        mkdirSync(path.join(folder, 'dictionaries'));
        copyFileSync(dictionary, path.join(folder, 'dictionaries', 'en-it.sqlite3'));
        const word = await translateThroughHost(api, 'bold', 'Some bold text in the document.');
        assert.ok(word.status === 'ok' && word.alternatives?.includes('audace'), JSON.stringify(word));
        assert.ok(word.status === 'ok' && !word.alternatives?.includes(word.text), 'the main translation is not repeated');

        const sentence = await translateThroughHost(api, 'The river bank.', 'The river bank.');
        assert.equal(sentence.status === 'ok' && sentence.alternatives, undefined, 'only for single words');
      } finally {
        for (const key of ['translation.modelsPath', 'translation.targetLanguage']) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
        rmSync(folder, { recursive: true, force: true });
      }
    });

    it('exports PDF when a Chromium browser is available', async function () {
      const { findChrome } = await import('../../src/export/chrome');
      if (!findChrome('')) {
        this.skip();
      }
      const output = fixture('sample.pdf').fsPath;
      rmSync(output, { force: true });
      await vscode.commands.executeCommand('folio.exportPdf', fixture('sample.md'));
      assert.ok(existsSync(output), 'PDF written');
      assert.equal(readFileSync(output).subarray(0, 5).toString(), '%PDF-');
      if (!process.env['KEEP_EXPORTS']) {
        rmSync(output, { force: true });
      }
    });

    it('widens a narrow preview to fit the table of contents, and gives the room back', async () => {
      const api = await activate();
      const config = vscode.workspace.getConfiguration('folio');
      const global = vscode.ConfigurationTarget.Global;
      type Layout = { orientation: 0 | 1; groups: Array<{ size?: number }> };
      const widths = async () =>
        (await vscode.commands.executeCommand<Layout>('vscode.getEditorLayout')).groups.map((group) => group.size!);
      // The preview gets a quarter of the editor area: too narrow.
      const narrow = async () => {
        await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.75 }, { size: 0.25 }] });
        return (await widths())[1];
      };
      // What the preview asks for when its table of contents opens (see Outline.fit).
      const fit = (width: number) =>
        (api.preview as any).onMessage({ type: 'fitOutline', width, wanted: width + 200, needed: width + 100 });
      const close = () => (api.preview as any).onMessage({ type: 'outlineClosed' });
      const pause = () => new Promise((resolve) => setTimeout(resolve, 400));
      let reloads = 0;
      api.preview.onDidReceiveMessage((message) => {
        if (message.type === 'ready') {
          reloads++;
        }
      });
      const uri = fixture('sample.md');
      try {
        await config.update('reading.outlineFit', 'once', global);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
        const ready = waitForMessage(api, (message) => message.type === 'ready');
        api.preview.show(uri, vscode.ViewColumn.Beside);
        await ready;
        reloads = 0;

        const width = await narrow();
        const [editor] = await widths();
        fit(width);
        await until(async () => (await widths())[1] >= width + 198, 'the preview is widened');
        assert.ok((await widths())[0] <= editor - 198, 'the room comes from the editor beside it');
        close();
        await pause();
        assert.ok((await widths())[1] >= width + 198, '"once" keeps the new width when the contents close');
        const again = await narrow();
        fit(again);
        await pause();
        assert.ok(Math.abs((await widths())[1] - again) <= 2, '"once" widens only the first time');
        assert.equal(reloads, 0, 'resizing does not reload the preview');

        const reloaded = waitForMessage(api, (message) => message.type === 'ready');
        await config.update('reading.outlineFit', 'always', global);
        await reloaded;
        reloads = 0;
        const start = await narrow();
        fit(start);
        await until(async () => (await widths())[1] >= start + 198, '"always" widens again');
        close();
        await until(async () => Math.abs((await widths())[1] - start) <= 2, 'and gives the room back');

        fit(start);
        await until(async () => (await widths())[1] >= start + 198, 'widened');
        await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
        const resized = (await widths())[1];
        close();
        await pause();
        assert.ok(Math.abs((await widths())[1] - resized) <= 2, 'a layout changed meanwhile is left as it is');
        assert.equal(reloads, 0);

        await config.update('reading.outlineFit', 'never', global);
        const last = await narrow();
        fit(last);
        await pause();
        assert.ok(Math.abs((await widths())[1] - last) <= 2, '"never" never resizes');
      } finally {
        await config.update('reading.outlineFit', undefined, global);
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


