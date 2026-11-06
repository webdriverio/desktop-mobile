import { browser } from '@wdio/electron-service';
import { expect } from '@wdio/globals';
import { createDeeplinkHelpers } from '../../lib/deeplink.js';

// Global type declarations for deeplink testing
declare global {
  var receivedDeeplinks: string[];
  var deeplinkCount: number;
}

const { clearDeeplinkState, waitForDeeplink, waitForDeeplinkStability } = createDeeplinkHelpers(() => browser.electron);

describe('Deeplink Testing (browser.electron.triggerDeeplink)', () => {
  beforeEach(async () => {
    await clearDeeplinkState();
  });

  afterEach(async () => {
    // Wait for any pending protocol handler invocations to settle
    // This prevents deeplinks from one test bleeding into the next
    await waitForDeeplinkStability();
  });

  describe('Basic Deeplink Functionality', () => {
    it('should trigger a simple deeplink', async () => {
      await browser.electron.triggerDeeplink('testapp://simple');
      await waitForDeeplink(1, 'App did not receive the deeplink within 5 seconds');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks).toContain('testapp://simple');
    });

    it('should handle deeplinks with paths', async () => {
      await browser.electron.triggerDeeplink('testapp://open/file/path');
      await waitForDeeplink(1, 'App did not receive the deeplink with path');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks).toContain('testapp://open/file/path');
    });
  });

  describe('URL Parameter Preservation', () => {
    it('should preserve simple query parameters', async () => {
      await browser.electron.triggerDeeplink('testapp://action?param1=value1&param2=value2');
      await waitForDeeplink(1, 'App did not receive the deeplink with parameters');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      const receivedUrl = deeplinks[0];

      expect(receivedUrl).toContain('param1=value1');
      expect(receivedUrl).toContain('param2=value2');
    });

    it('should preserve complex query parameters', async () => {
      const complexUrl = 'testapp://action?name=John%20Doe&age=30&tags[]=tag1&tags[]=tag2';
      await browser.electron.triggerDeeplink(complexUrl);
      await waitForDeeplink(1, 'App did not receive the complex deeplink');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      const receivedUrl = deeplinks[0];

      expect(receivedUrl).toMatch(/name=John(\+|%20)Doe/);
      expect(receivedUrl).toContain('age=30');
      expect(receivedUrl).toContain('tags');
    });

    it('should preserve URL fragments', async () => {
      await browser.electron.triggerDeeplink('testapp://page?section=intro#heading');
      await waitForDeeplink(1, 'App did not receive the deeplink with fragment');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      const receivedUrl = deeplinks[0];

      expect(receivedUrl).toContain('section=intro');
      expect(receivedUrl).toContain('#heading');
    });
  });

  describe('Multiple Deeplinks', () => {
    it('should handle multiple deeplinks in sequence', async () => {
      await browser.electron.triggerDeeplink('testapp://first');
      await waitForDeeplink(1, 'App did not receive first deeplink');

      await browser.electron.triggerDeeplink('testapp://second');
      await waitForDeeplink(2, 'App did not receive second deeplink');

      await browser.electron.triggerDeeplink('testapp://third');
      await waitForDeeplink(3, 'App did not receive third deeplink');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks).toHaveLength(3);
      expect(deeplinks).toContain('testapp://first');
      expect(deeplinks).toContain('testapp://second');
      expect(deeplinks).toContain('testapp://third');
    });
  });

  describe('Single Instance Behavior', () => {
    it('should not create a new window when triggering deeplinks', async () => {
      const initialWindowCount = await browser.electron.execute(
        (electron) => electron.BrowserWindow.getAllWindows().length,
      );

      await browser.electron.triggerDeeplink('testapp://window-test-1');
      await waitForDeeplink(1);

      await browser.electron.triggerDeeplink('testapp://window-test-2');
      await waitForDeeplink(2);

      await browser.electron.triggerDeeplink('testapp://window-test-3');
      await waitForDeeplink(3);

      const finalWindowCount = await browser.electron.execute(
        (electron) => electron.BrowserWindow.getAllWindows().length,
      );

      expect(finalWindowCount).toBe(initialWindowCount);

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid URL format', async () => {
      await expect(browser.electron.triggerDeeplink('not a valid url')).rejects.toThrow(/Invalid deeplink URL/);
    });

    it('should reject http protocol', async () => {
      await expect(browser.electron.triggerDeeplink('http://example.com')).rejects.toThrow(/Invalid deeplink protocol/);
    });

    it('should reject https protocol', async () => {
      await expect(browser.electron.triggerDeeplink('https://example.com')).rejects.toThrow(
        /Invalid deeplink protocol/,
      );
    });

    it('should reject file protocol', async () => {
      await expect(browser.electron.triggerDeeplink('file:///path/to/file')).rejects.toThrow(
        /Invalid deeplink protocol/,
      );
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should handle Windows userData parameter correctly on Windows', async () => {
      const testUrl = 'testapp://windows-test?foo=bar';
      await browser.electron.triggerDeeplink(testUrl);
      await waitForDeeplink(1, 'App did not receive the deeplink');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      const receivedUrl = deeplinks[0];

      expect(receivedUrl).not.toContain('userData=');
      expect(receivedUrl).toContain('foo=bar');
      expect(receivedUrl).toContain('testapp://windows-test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle URLs with special characters', async () => {
      const specialUrl = 'testapp://test?message=Hello%20World%21&emoji=%F0%9F%9A%80';
      await browser.electron.triggerDeeplink(specialUrl);
      await waitForDeeplink(1, 'App did not receive the deeplink with special characters');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks).toHaveLength(1);
      expect(deeplinks[0]).toMatch(/message=Hello(\+|%20)World/);
    });

    it('should handle URLs with no path or parameters', async () => {
      await browser.electron.triggerDeeplink('testapp://');
      await waitForDeeplink(1, 'App did not receive minimal deeplink');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      expect(deeplinks).toContain('testapp://');
    });

    it('should handle URLs with empty parameter values', async () => {
      await browser.electron.triggerDeeplink('testapp://test?empty=&filled=value');
      await waitForDeeplink(1, 'App did not receive deeplink with empty parameters');

      const deeplinks = await browser.electron.execute(() => globalThis.receivedDeeplinks);
      const receivedUrl = deeplinks[0];

      expect(receivedUrl).toContain('empty=');
      expect(receivedUrl).toContain('filled=value');
    });
  });
});
