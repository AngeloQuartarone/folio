/*
 * Connects the preview webview to the offline translation engine.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The webview only sends the selected text. Translation runs locally in a
 * worker thread; the network is used only to download a language model,
 * and only when the user explicitly asks for it.
 */
import * as vscode from 'vscode';
import { SECTION, getTranslationConfig } from '../config';
import { LanguageStatus, TranslationReply, WebviewCommand, WebviewMessage } from '../messages';
import { PreviewManager } from '../preview/previewManager';
import { proseSample } from '../render/language';
import { DictionaryInfo, DictionaryStore, dictionaryFor } from './dictionary/dictionaryStore';
import { languageName } from './languages';
import { BergamotEngine } from './offline/engine';
import { ModelStore } from './offline/modelStore';
import { OfflineProvider } from './offline/offlineProvider';
import {
  ModelPair,
  PIVOT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatSize,
  languageModels,
  modelPair,
} from './offline/registry';
import { TranslationService } from './translationService';
import { TranslationError, baseLanguage } from './types';

interface PendingRequest {
  id: number;
  text: string;
  context: string;
}

export class TranslationController implements vscode.Disposable {
  private store!: ModelStore;
  private dictionaries!: DictionaryStore;
  /** The dictionary offered in the last tooltip. */
  private lastDictionary: DictionaryInfo | undefined;
  private engine!: BergamotEngine;
  private service!: TranslationService;
  private inFlight: AbortController | undefined;
  /** The last request, retried after its models are downloaded. */
  private lastRequest: PendingRequest | undefined;
  private lastMissing: string[] = [];
  private documentLanguageSample: { key: string; text: string } | undefined;
  /** Languages whose models are being downloaded. */
  private readonly downloading = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly preview: PreviewManager,
  ) {
    this.createEngine();
    preview.onDidReceiveMessage((message) => void this.onMessage(message));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.translation.modelsPath`)) {
          this.engine.dispose();
          this.dictionaries.dispose();
          this.createEngine();
          this.postLanguages();
        } else if (event.affectsConfiguration(`${SECTION}.translation.sourceLanguage`)) {
          this.service.cache.clear();
        }
        if (event.affectsConfiguration(`${SECTION}.translation.enabled`)) {
          preview.postMessage({
            type: 'translationSettings',
            enabled: getTranslationConfig().enabled,
          });
        }
      }),
    );
  }

  get modelsDirectory(): string {
    return this.store.directory;
  }

  dispose(): void {
    this.inFlight?.abort();
    this.engine.dispose();
    this.dictionaries.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  /** "Folio: Manage Offline Languages". */
  async manageLanguages(): Promise<void> {
    type Item = vscode.QuickPickItem & { status: LanguageStatus };
    const items: Item[] = this.languageStatuses()
      .filter((status) => status.state !== 'builtin')
      .map((status) => ({
        label: status.label,
        description: status.state === 'installed' ? 'installed' : status.size,
        detail: status.state === 'partial' ? 'Partly installed: keep it checked to complete it' : undefined,
        picked: status.state !== 'missing',
        status,
      }));
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Offline languages: checked are kept or downloaded, unchecked are removed',
      canPickMany: true,
      placeHolder: `Models folder: ${this.store.directory}`,
    });
    if (!picked) {
      return;
    }
    const wanted = new Set(picked.map((item) => item.status.code));
    const toRemove = items.filter((item) => item.status.state !== 'missing' && !wanted.has(item.status.code));
    const toDownload = picked.filter((item) => item.status.state !== 'installed');
    if (toRemove.length) {
      await this.removeLanguages(toRemove.map((item) => item.status.code));
    }
    if (toDownload.length) {
      await this.downloadLanguages(toDownload.map((item) => item.status.code));
    }
  }

  /** Every language with the state of its models, English first. */
  private languageStatuses(): LanguageStatus[] {
    return SUPPORTED_LANGUAGES.map((code): LanguageStatus => {
      const label = languageName(code);
      if (code === PIVOT_LANGUAGE) {
        return { code, label, state: 'builtin', size: '' };
      }
      const pairs = languageModels(code);
      const missing = this.store.missing(pairs);
      const size = missing.length ? formatSize(missing.reduce((sum, pair) => sum + pair.size, 0)) : '';
      const state = this.downloading.has(code)
        ? 'downloading'
        : !missing.length
          ? 'installed'
          : missing.length < pairs.length
            ? 'partial'
            : 'missing';
      return { code, label, state, size };
    }).sort((a, b) =>
      a.state === 'builtin' ? -1 : b.state === 'builtin' ? 1 : a.label.localeCompare(b.label),
    );
  }

  private postLanguages(): void {
    this.preview.postMessage({ type: 'languages', languages: this.languageStatuses() });
  }

  private async downloadLanguages(codes: string[]): Promise<void> {
    const pending = codes.filter((code) => !this.downloading.has(code));
    const pairs = this.store.missing(pending.flatMap(languageModels));
    if (!pairs.length) {
      this.postLanguages();
      return;
    }
    pending.forEach((code) => this.downloading.add(code));
    this.postLanguages();
    try {
      await this.download(pairs);
    } finally {
      pending.forEach((code) => this.downloading.delete(code));
      this.postLanguages();
    }
  }

  private async removeLanguages(codes: string[]): Promise<void> {
    const names = codes.map((code) => languageName(code)).join(', ');
    const confirm = await vscode.window.showWarningMessage(
      `Remove the offline models of ${names}?`,
      { modal: true, detail: 'You can download them again at any time.' },
      'Remove',
    );
    if (confirm === 'Remove') {
      this.engine.dispose();
      codes.flatMap(languageModels).forEach((pair) => this.store.remove(pair));
      codes.forEach((code) => this.dictionaries.removeLanguage(code));
      this.service.cache.clear();
    }
    this.postLanguages();
  }

  private createEngine(): void {
    const configured = getTranslationConfig().modelsPath;
    const directory = configured || vscode.Uri.joinPath(this.context.globalStorageUri, 'models').fsPath;
    this.store = new ModelStore(directory);
    this.dictionaries = new DictionaryStore(directory);
    const workerPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'bergamot',
      'translator-worker.js',
    ).fsPath;
    this.engine = new BergamotEngine(this.store, workerPath);
    const provider = new OfflineProvider({ engine: this.engine, store: this.store });
    this.service = new TranslationService(async () => provider);
  }

  /** Download with a cancellable progress notification. Returns true on success. */
  private async download(pairs: ModelPair[]): Promise<boolean> {
    const total = pairs.reduce((sum, pair) => sum + pair.size, 0);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading offline translation model (${formatSize(total)})`,
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          let before = 0;
          let reported = 0;
          for (const pair of pairs) {
            const name = `${languageName(pair.from)} → ${languageName(pair.to)}`;
            await this.store.download(
              pair,
              (done) => {
                const percent = ((before + done) / total) * 100;
                progress.report({ message: name, increment: percent - reported });
                reported = percent;
              },
              controller.signal,
            );
            before += pair.size;
          }
        },
      );
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        void vscode.window.showErrorMessage(
          `Model download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postLanguages();
      return;
    }
    if (message.type === 'languageModels') {
      const code = message.language;
      if (code !== PIVOT_LANGUAGE && SUPPORTED_LANGUAGES.includes(code)) {
        if (message.action === 'download') {
          await this.downloadLanguages([code]);
        } else if (message.action === 'remove') {
          await this.removeLanguages([code]);
        }
      }
      return;
    }
    if (message.type === 'command') {
      await this.runWebviewCommand(message.command);
      return;
    }
    if (message.type !== 'translate' || !getTranslationConfig().enabled) {
      return;
    }
    this.lastRequest = { id: message.id, text: message.text, context: message.context };
    await this.translate(this.lastRequest);
  }

  private async translate(request: PendingRequest): Promise<void> {
    const config = getTranslationConfig();
    // Only the latest selection matters.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    let reply: TranslationReply;
    try {
      const result = await this.service.translate(
        {
          text: request.text,
          context: request.context,
          targetLanguage: config.targetLanguage,
          sourceLanguage: config.sourceLanguage,
          fallbackText: await this.documentSample(),
        },
        controller.signal,
      );
      reply = {
        type: 'translation',
        id: request.id,
        status: 'ok',
        text: result.text,
        sourceLabel: languageName(result.detectedLanguage),
        targetLabel: languageName(config.targetLanguage),
        sameLanguage: result.sameLanguage,
        ...(result.sameLanguage
          ? {}
          : this.otherMeanings(request.text, result.detectedLanguage, config.targetLanguage, result.text)),
      };
    } catch (error) {
      if (error instanceof TranslationError && error.code === 'cancelled') {
        return;
      }
      reply = this.errorReply(request.id, error);
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
      }
    }
    this.preview.postMessage(reply);
  }

  /**
   * For a single word: its other meanings from the dictionary, or an offer
   * to download the dictionary when it is not installed.
   */
  private otherMeanings(
    text: string,
    from: string,
    to: string,
    translation: string,
  ): Pick<Extract<TranslationReply, { status: 'ok' }>, 'alternatives' | 'action'> {
    const word = text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const info = dictionaryFor(baseLanguage(from), baseLanguage(to));
    if (!word || /\s/.test(word) || !info || !this.dictionaries.supported) {
      return {};
    }
    let meanings: string[] | undefined;
    try {
      meanings = this.dictionaries.lookup(info, word);
    } catch {
      return {}; // a damaged file: the translation alone is still useful
    }
    if (!meanings) {
      this.lastDictionary = info;
      return {
        action: { label: `Other meanings · ${formatSize(info.size)}`, command: 'downloadDictionary' },
      };
    }
    const main = translation.trim().toLowerCase();
    return { alternatives: meanings.filter((meaning) => meaning.toLowerCase() !== main) };
  }

  private async downloadDictionary(info: DictionaryInfo): Promise<boolean> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading the ${languageName(info.from)} → ${languageName(info.to)} dictionary (${formatSize(info.size)})`,
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          let reported = 0;
          await this.dictionaries.download(
            info,
            (done, total) => {
              const percent = (done / total) * 100;
              progress.report({ increment: percent - reported });
              reported = percent;
            },
            controller.signal,
          );
        },
      );
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        void vscode.window.showErrorMessage(
          `Dictionary download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  private errorReply(id: number, error: unknown): TranslationReply {
    if (!(error instanceof TranslationError)) {
      return {
        type: 'translation',
        id,
        status: 'error',
        message: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const reply: TranslationReply = { type: 'translation', id, status: 'error', message: error.message };
    if (error.code === 'modelMissing' && error.pairs?.length) {
      this.lastMissing = error.pairs;
      const size = error.pairs.reduce((sum, key) => sum + (modelPair(key)?.size ?? 0), 0);
      reply.action = { label: `Download (${formatSize(size)})`, command: 'downloadModels' };
    } else if (
      error.code === 'config' ||
      error.code === 'undetected' ||
      error.code === 'unsupportedLanguage'
    ) {
      reply.action = { label: 'Settings', command: 'openTranslationSettings' };
    }
    return reply;
  }

  private async runWebviewCommand(command: WebviewCommand): Promise<void> {
    switch (command) {
      case 'downloadModels': {
        const pairs = this.lastMissing.map(modelPair).filter((pair): pair is ModelPair => !!pair);
        const request = this.lastRequest;
        const downloaded = pairs.length > 0 && (await this.download(pairs));
        this.postLanguages();
        if (downloaded && request) {
          await this.translate(request); // the tooltip is waiting for this id
        } else if (request) {
          this.preview.postMessage({
            type: 'translation',
            id: request.id,
            status: 'error',
            message: 'The model was not downloaded.',
          });
        }
        break;
      }
      case 'downloadDictionary': {
        const info = this.lastDictionary;
        const request = this.lastRequest;
        if (info && (await this.downloadDictionary(info)) && request) {
          await this.translate(request); // the tooltip is waiting for this id
        } else if (request) {
          this.preview.postMessage({
            type: 'translation',
            id: request.id,
            status: 'error',
            message: 'The dictionary was not downloaded.',
          });
        }
        break;
      }
      case 'openTranslationSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.`);
        break;
    }
  }

  /**
   * Text of the previewed document without front matter, notes and code, used to
   * detect the language when the selected sentence is too short.
   */
  private async documentSample(): Promise<string | undefined> {
    const uri = this.preview.activeSourceUri;
    if (!uri) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const key = `${uri.toString()}@${document.version}`;
    if (this.documentLanguageSample?.key !== key) {
      const text = proseSample(document.getText());
      this.documentLanguageSample = { key, text };
    }
    return this.documentLanguageSample.text;
  }
}
