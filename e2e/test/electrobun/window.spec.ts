import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';
import type { PageWindow } from '../../lib/pageGlobals.js';

// The fixture opens two CEF windows (src/bun/index.ts): a main view and a second
// view. The CDP bridge labels page targets in registration order — first 'main',
// next 'window-1'.
//
// ⚠️ Runs in CI on Windows only (native WebView2 renderer, not CEF). On the macOS
// CEF path the second view falls back to a racy global context and isn't reliably
// enumerable as 'window-1' — an upstream CEF gap, not fixable from the
// fixture/service. Per-platform status + root cause: package README.
// Run locally: `TEST_TYPE=window pnpm test:e2e:electrobun`.

describe('Electrobun Multi-Window Support', () => {
  beforeEach(async () => {
    // Reset to the main window before each test so a prior switch doesn't leak.
    try {
      await browser.electrobun.switchWindow('main');
    } catch {
      // If 'main' is not yet enumerated, continue — listWindows tests cover that.
    }
  });

  describe('listWindows()', () => {
    it('should list all available windows', async () => {
      const windows = await browser.electrobun.listWindows();
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBeGreaterThanOrEqual(2);
      expect(windows).toContain('main');
    });

    it('should label the second window in registration order', async () => {
      const windows = await browser.electrobun.listWindows();
      expect(windows).toContain('window-1');
    });
  });

  describe('switchWindow()', () => {
    it('should switch to the main window', async () => {
      await browser.electrobun.switchWindow('main');
      const title = await browser.$('#app-title');
      await expect(title).toExist();
    });

    it('should switch to the second window', async () => {
      await browser.electrobun.switchWindow('window-1');
      const marker = await browser.$('#second-marker');
      await expect(marker).toExist();
    });

    it('should be able to switch back to main after switching away', async () => {
      await browser.electrobun.switchWindow('window-1');
      await expect(browser.$('#second-title')).toExist();

      await browser.electrobun.switchWindow('main');
      await expect(browser.$('#app-title')).toExist();
    });

    it('should throw for a non-existent window', async () => {
      await expect(browser.electrobun.switchWindow('nonexistent-window-12345')).rejects.toThrow();
    });
  });

  describe('per-window execute', () => {
    it('should evaluate against the active window after switching', async () => {
      await browser.electrobun.switchWindow('window-1');
      const id = await browser.electrobun.execute(() => {
        const el = (globalThis as unknown as PageWindow).document.getElementById('second-title');
        return el ? el.id : undefined;
      });
      expect(id).toBe('second-title');

      await browser.electrobun.switchWindow('main');
      const mainId = await browser.electrobun.execute(() => {
        const el = (globalThis as unknown as PageWindow).document.getElementById('app-title');
        return el ? el.id : undefined;
      });
      expect(mainId).toBe('app-title');
    });
  });
});
