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
import { TranslationReply, WebviewCommand, WebviewMessage } from '../messages';
import { PreviewManager } from '../preview/previewManager';
import { stripFrontMatter } from '../render/plugins';
import { languageName } from './languages';
import { BergamotEngine } from './offline/engine';
import { ModelStore } from './offline/modelStore';
import { OfflineProvider } from './offline/offlineProvider';
import { MODEL_PAIRS, ModelPair, formatSize, modelPair } from './offline/registry';
import { TranslationService } from './translationService';
import { TranslationError } from './types';

interface PendingRequest {
  id: number;
  text: string;
  context: string;
}

export class TranslationController implements vscode.Disposable {
  private store!: ModelStore;
  private engine!: BergamotEngine;
  private service!: TranslationService;
  private inFlight: AbortController | undefined;
  /** The last request, retried after its models are downloaded. */
  private lastRequest: PendingRequest | undefined;
  private lastMissing: string[] = [];
  private documentLanguageSample: { key: string; text: string } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly preview: PreviewManager,
  ) {
    this.createEngine();
    preview.onDidReceiveMessage((message) => void this.onMessage(message));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.modelsPath`)) {
          this.engine.dispose();
          this.createEngine();
        } else if (event.affectsConfiguration(`${SECTION}.sourceLanguage`)) {
          this.service.cache.clear();
        }
        if (event.affectsConfiguration(`${SECTION}.enabled`)) {
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
    this.disposables.forEach((d) => d.dispose());
  }

  /** "Markdown Translate: Manage Offline Languages". */
  async manageLanguages(): Promise<void> {
    type Item = vscode.QuickPickItem & { pair: ModelPair };
    const items: Item[] = MODEL_PAIRS.map((pair) => ({
      label: `${languageName(pair.from)} → ${languageName(pair.to)}`,
      description: formatSize(pair.size),
      detail: this.store.isInstalled(pair) ? 'installed' : undefined,
      picked: this.store.isInstalled(pair),
      pair,
    })).sort((a, b) => a.label.localeCompare(b.label));
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Offline languages: checked models are kept or downloaded, unchecked are removed',
      canPickMany: true,
      placeHolder: `Models folder: ${this.store.directory}`,
    });
    if (!picked) {
      return;
    }
    const wanted = new Set(picked.map((item) => item.pair.key));
    const toRemove = MODEL_PAIRS.filter((pair) => this.store.isInstalled(pair) && !wanted.has(pair.key));
    const toDownload = MODEL_PAIRS.filter((pair) => wanted.has(pair.key) && !this.store.isInstalled(pair));
    if (toRemove.length) {
      const names = toRemove.map((pair) => `${languageName(pair.from)} → ${languageName(pair.to)}`);
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${names.join(', ')}?`,
        { modal: true },
        'Remove',
      );
      if (confirm === 'Remove') {
        this.engine.dispose();
        toRemove.forEach((pair) => this.store.remove(pair));
      }
    }
    if (toDownload.length) {
      await this.download(toDownload);
    }
  }

  private createEngine(): void {
    const configured = getTranslationConfig().modelsPath;
    const directory = configured || vscode.Uri.joinPath(this.context.globalStorageUri, 'models').fsPath;
    this.store = new ModelStore(directory);
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
        if (pairs.length && (await this.download(pairs)) && request) {
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
      case 'openTranslationSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.`);
        break;
    }
  }

  /**
   * Text of the previewed document without front matter and code, used to
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
      const text = stripFrontMatter(document.getText())
        .replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/<[^>]+>|\]\([^)]*\)|[#>*_|[\]-]/g, ' ')
        .slice(0, 4000);
      this.documentLanguageSample = { key, text };
    }
    return this.documentLanguageSample.text;
  }
}
