import { browser, expect } from '@wdio/globals';

// The webview callbacks run in the CEF page context; the e2e tsconfig has no DOM lib, so reach
// `document` through a minimally-typed globalThis.
type Doc = { getElementById(id: string): { textContent: string | null } | null };

// Package-install smoke test: confirms the *installed* @wdio/electrobun-service tarball can
// launch the CEF app, attach over CDP, and drive the webview. Reduced surface (#app-title +
// #status) — the full feature matrix lives in the e2e suite.
describe('@wdio/electrobun-service package install', () => {
  it('should install the browser.electrobun API surface', async () => {
    expect(typeof browser.electrobun.execute).toBe('function');
  });

  it('should launch the CEF app and render the title', async () => {
    const readTitle = () =>
      browser.electrobun.execute(() => {
        const el = (globalThis as unknown as { document: Doc }).document.getElementById('app-title');
        return el ? el.textContent : undefined;
      });
    // The webview may still be painting when the bridge attaches — poll rather than read once.
    let title: string | null | undefined;
    await browser.waitUntil(
      async () => {
        title = await readTitle();
        return typeof title === 'string' && title.includes('Electrobun');
      },
      { timeout: 10_000, timeoutMsg: 'fixture #app-title never rendered' },
    );
    expect(title).toContain('Electrobun');
  });

  it('should reflect the view script through the status element', async () => {
    // The mainview script overwrites #status to "Application loaded successfully" on load,
    // so reading it confirms the view's JS ran (not just the static HTML). Poll in case the
    // script hasn't run yet when the bridge first attaches.
    const readStatus = () =>
      browser.electrobun.execute(() => {
        const el = (globalThis as unknown as { document: Doc }).document.getElementById('status');
        return el ? el.textContent : undefined;
      });
    let status: string | null | undefined;
    await browser.waitUntil(
      async () => {
        status = await readStatus();
        return typeof status === 'string' && status.includes('loaded successfully');
      },
      { timeout: 10_000, timeoutMsg: '#status was not updated by the view script' },
    );
    expect(status).toContain('loaded successfully');
  });
});
