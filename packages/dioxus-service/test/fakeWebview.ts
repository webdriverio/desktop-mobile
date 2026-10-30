import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import { vi } from 'vitest';

import { markAsEmbedded } from '../src/commands/execute.js';

export type Webview = Record<string, unknown>;

// A webview with the service's spy injected, whose app invoke answers 'unmocked'.
export function makeWebview(): Webview {
  const win: Webview = { __WDIO_DIOXUS__: { invoke: async () => 'unmocked' } };
  new Function('window', createIpcInterceptor('dioxus').buildBrowserIpcInjectionScript())(win);
  return win;
}

// Runs scripts as the embedded driver does: awaits the result and sends it back as JSON.
// A script that rejects comes back as the `name: message` string guest-js reports.
export function makeWebviewBrowser(win: Webview): WebdriverIO.Browser {
  const browser = {
    execute: vi.fn(async (script: string) => {
      let result: unknown;
      try {
        result = await new Function('window', script)(win);
      } catch (e) {
        throw new Error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      }
      return JSON.parse(JSON.stringify(result ?? null));
    }),
  } as unknown as WebdriverIO.Browser;
  markAsEmbedded(browser);
  return browser;
}
