import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

// Electrobun deeplinks are macOS-only in v1: triggerDeeplink rejects on other
// platforms (Windows/Linux URL-scheme registration is not yet available upstream).
// The fixture's Bun backend (src/bun/index.ts) handles `open-url` and pushes the
// URL into the main view's window.__wdioDeeplinks array + the #status element.
const isMacOS = process.platform === 'darwin';

// The execute callback runs in the CEF webview, where globalThis is the page
// window — that's where the fixture's open-url handler pushes __wdioDeeplinks.
function readDeeplinks(): Promise<string[]> {
  return browser.electrobun.execute(
    () => ((globalThis as unknown as { __wdioDeeplinks?: string[] }).__wdioDeeplinks ?? []) as string[],
  );
}

async function clearDeeplinks(): Promise<void> {
  await browser.electrobun.execute(() => {
    (globalThis as unknown as { __wdioDeeplinks?: string[] }).__wdioDeeplinks = [];
  });
}

async function waitForDeeplink(expectedCount = 1, timeoutMsg = 'App did not receive the deeplink'): Promise<void> {
  await browser.waitUntil(
    async () => {
      const links = await readDeeplinks();
      return links.length >= expectedCount;
    },
    { timeout: 30000, timeoutMsg },
  );
}

describe('Electrobun Deeplink Testing (browser.electrobun.triggerDeeplink)', () => {
  describe('Platform support', () => {
    it('should reject triggerDeeplink on non-macOS platforms', async function () {
      if (isMacOS) {
        this.skip();
      }
      await expect(browser.electrobun.triggerDeeplink('wdio-electrobun://simple')).rejects.toThrow();
    });
  });

  describe('Basic Deeplink Functionality', () => {
    beforeEach(async function () {
      if (!isMacOS) {
        this.skip();
      }
      await browser.electrobun.switchWindow('main');
      await clearDeeplinks();
    });

    it('should trigger a simple deeplink', async () => {
      await browser.electrobun.triggerDeeplink('wdio-electrobun://simple');
      await waitForDeeplink(1, 'App did not receive the deeplink within 30 seconds');

      const deeplinks = await readDeeplinks();
      expect(deeplinks[0]).toMatch(/^wdio-electrobun:\/\/simple\/?$/);
    });

    it('should handle deeplinks with paths', async () => {
      await browser.electrobun.triggerDeeplink('wdio-electrobun://open/file/path');
      await waitForDeeplink(1, 'App did not receive the deeplink with path');

      const deeplinks = await readDeeplinks();
      expect(deeplinks.some((url) => url.includes('open/file/path'))).toBe(true);
    });

    it('should preserve query parameters', async () => {
      await browser.electrobun.triggerDeeplink('wdio-electrobun://action?param1=value1&param2=value2');
      await waitForDeeplink(1, 'App did not receive the deeplink with parameters');

      const deeplinks = await readDeeplinks();
      const received = deeplinks[0];
      expect(received).toContain('param1=value1');
      expect(received).toContain('param2=value2');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async function () {
      if (!isMacOS) {
        this.skip();
      }
    });

    it('should reject an invalid URL format', async () => {
      await expect(browser.electrobun.triggerDeeplink('not a valid url')).rejects.toThrow();
    });

    it('should reject the http protocol', async () => {
      await expect(browser.electrobun.triggerDeeplink('http://example.com')).rejects.toThrow(
        /Invalid deeplink protocol/,
      );
    });

    it('should reject the https protocol', async () => {
      await expect(browser.electrobun.triggerDeeplink('https://example.com')).rejects.toThrow(
        /Invalid deeplink protocol/,
      );
    });

    it('should reject the file protocol', async () => {
      await expect(browser.electrobun.triggerDeeplink('file:///path/to/file')).rejects.toThrow(
        /Invalid deeplink protocol/,
      );
    });
  });
});
