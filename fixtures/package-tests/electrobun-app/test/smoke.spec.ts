import { browser, expect } from '@wdio/globals';

// Package-install smoke test: confirms the *installed* @wdio/electrobun-service tarball can
// launch the CEF app, attach over CDP, and drive the webview. Reduced surface (#app-title +
// #status) — the full feature matrix lives in the e2e suite.
describe('@wdio/electrobun-service package install', () => {
  it('should install the browser.electrobun API surface', async () => {
    expect(typeof browser.electrobun.execute).toBe('function');
  });

  it('should launch the CEF app and render the title', async () => {
    type Doc = { getElementById(id: string): { textContent: string | null } | null };
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
    type Doc = { getElementById(id: string): { textContent: string | null } | null };
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
