/*
 * JSON POST with timeout and uniform network errors.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { FetchFn, TranslationError } from '../types';

export interface HttpResponse {
  status: number;
  body: unknown;
  /** Raw text, when the body is not JSON. */
  text: string;
}

export async function postJson(
  fetchFn: FetchFn,
  url: string,
  payload: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  providerName: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? anySignal(signal, timeout) : timeout;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new TranslationError('cancelled', 'Translation cancelled.');
    }
    if (timeout.aborted) {
      throw new TranslationError(
        'timeout',
        `${providerName} did not answer within ${Math.round(timeoutMs / 1000)} s.`,
      );
    }
    throw new TranslationError(
      'network',
      `Cannot reach ${providerName}. Check your internet connection or the server URL.` +
        (error instanceof Error && error.message ? ` (${error.message})` : ''),
    );
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

/** `AbortSignal.any` needs Node 20.3; VS Code 1.85 runs Node 18. */
function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** `message` / `error` field of an error body, if any. */
export function serverMessage(response: HttpResponse): string {
  const body = response.body as { message?: unknown; error?: unknown } | undefined;
  const message = body?.message ?? body?.error;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return response.text.trim().slice(0, 200);
}
