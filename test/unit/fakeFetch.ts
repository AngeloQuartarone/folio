import type { FetchFn } from '../../src/translation/types';

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

type Handler = (call: RecordedCall) => { status?: number; json?: unknown; text?: string } | Error;

/** A fetch double that records calls and answers with `handler`. */
export function fakeFetch(handler: Handler): FetchFn & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: RecordedCall = {
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const answer = handler(call);
    if (answer instanceof Error) {
      throw answer;
    }
    const text = answer.text ?? (answer.json === undefined ? '' : JSON.stringify(answer.json));
    return new Response(text, { status: answer.status ?? 200 });
  }) as FetchFn & { calls: RecordedCall[] };
  fn.calls = calls;
  return fn;
}
