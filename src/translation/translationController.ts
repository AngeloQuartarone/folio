/*
 * Connects the preview webview to the translation service.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The webview only sends the selected text; every network request is made
 * here, in the extension host. API keys live in SecretStorage.
 */
import * as vscode from 'vscode';
import { SECTION, getTranslationConfig } from '../config';
import { TranslationReply, WebviewCommand, WebviewMessage } from '../messages';
import { PreviewManager } from '../preview/previewManager';
import { languageName } from './languages';
import { PROVIDERS, ProviderId, isProviderId } from './providers';
import { TranslationService } from './translationService';
import { TranslationError, TranslationProvider } from './types';

const REQUEST_TIMEOUT_MS = 15_000;

export function secretKey(provider: string): string {
  return `${SECTION}.apiKey.${provider}`;
}

export class TranslationController implements vscode.Disposable {
  private readonly service = new TranslationService(() => this.createProvider());
  private inFlight: AbortController | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly preview: PreviewManager,
  ) {
    preview.onDidReceiveMessage((message) => void this.onMessage(message));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${SECTION}.provider`) ||
          event.affectsConfiguration(`${SECTION}.libreTranslateUrl`)
        ) {
          this.service.cache.clear();
        }
        if (event.affectsConfiguration(`${SECTION}.enabled`)) {
          preview.postMessage({
            type: 'translationSettings',
            enabled: getTranslationConfig().enabled,
          });
        }
      }),
      context.secrets.onDidChange((event) => {
        if (event.key.startsWith(`${SECTION}.apiKey.`)) {
          this.service.cache.clear();
        }
      }),
    );
  }

  dispose(): void {
    this.inFlight?.abort();
    this.disposables.forEach((d) => d.dispose());
  }

  /** "Markdown Translate: Set API Key". */
  async setApiKey(providerArg?: string): Promise<void> {
    const current = getTranslationConfig().provider;
    let provider: string | undefined = isProviderId(providerArg) ? providerArg : undefined;
    if (!provider) {
      const picked = await vscode.window.showQuickPick(
        Object.entries(PROVIDERS).map(([id, { displayName }]) => ({
          label: displayName,
          description: id === current ? 'current provider' : undefined,
          id,
        })),
        { title: 'Set API key for…', placeHolder: PROVIDERS[current]?.displayName },
      );
      provider = picked?.id;
    }
    if (!provider) {
      return;
    }
    const name = PROVIDERS[provider].displayName;
    const hasKey = !!(await this.context.secrets.get(secretKey(provider)));
    const value = await vscode.window.showInputBox({
      title: `${name} API key`,
      prompt:
        provider === 'deepl'
          ? 'DeepL API key (Free keys end with ":fx"). Leave empty to remove the stored key.'
          : 'LibreTranslate API key (optional for self-hosted servers). Leave empty to remove it.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: hasKey ? 'A key is stored — type a new one to replace it' : undefined,
    });
    if (value === undefined) {
      return;
    }
    if (value.trim()) {
      await this.context.secrets.store(secretKey(provider), value.trim());
      void vscode.window.showInformationMessage(`${name} API key saved.`);
    } else if (hasKey) {
      await this.context.secrets.delete(secretKey(provider));
      void vscode.window.showInformationMessage(`${name} API key removed.`);
    }
  }

  private async createProvider(): Promise<TranslationProvider> {
    const config = getTranslationConfig();
    const id: ProviderId = isProviderId(config.provider) ? config.provider : 'deepl';
    return PROVIDERS[id].create({
      apiKey: await this.context.secrets.get(secretKey(id)),
      libreTranslateUrl: config.libreTranslateUrl,
      fetch: (url, init) => fetch(url, init),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'command') {
      await this.runWebviewCommand(message.command);
      return;
    }
    if (message.type !== 'translate') {
      return;
    }
    const config = getTranslationConfig();
    if (!config.enabled) {
      return;
    }
    // Only the latest selection matters.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    let reply: TranslationReply;
    try {
      const result = await this.service.translate(
        { text: message.text, context: message.context, targetLanguage: config.targetLanguage },
        controller.signal,
      );
      // Names in English, like the rest of the UI ("German → Italian").
      const locale = 'en';
      reply = {
        type: 'translation',
        id: message.id,
        status: 'ok',
        text: result.text,
        sourceLabel: languageName(result.detectedLanguage, locale),
        targetLabel: languageName(config.targetLanguage, locale),
        sameLanguage: result.sameLanguage,
      };
    } catch (error) {
      if (error instanceof TranslationError && error.code === 'cancelled') {
        return;
      }
      reply = errorReply(message.id, error);
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
      }
    }
    this.preview.postMessage(reply);
  }

  private async runWebviewCommand(command: WebviewCommand): Promise<void> {
    switch (command) {
      case 'setApiKey':
        await vscode.commands.executeCommand(`${SECTION}.setApiKey`, getTranslationConfig().provider);
        break;
      case 'openTranslationSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.`);
        break;
    }
  }
}

function errorReply(id: number, error: unknown): TranslationReply {
  if (!(error instanceof TranslationError)) {
    return {
      type: 'translation',
      id,
      status: 'error',
      message: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const reply: TranslationReply = { type: 'translation', id, status: 'error', message: error.message };
  if (error.code === 'missingKey' || error.code === 'invalidKey') {
    reply.action = { label: 'Set API Key', command: 'setApiKey' };
  } else if (
    error.code === 'config' ||
    error.code === 'network' ||
    (error.code === 'badRequest' && error.status !== undefined)
  ) {
    reply.action = { label: 'Settings', command: 'openTranslationSettings' };
  }
  return reply;
}
