import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

// The fixture opens two CEF windows (src/bun/index.ts): the main counter view
// (mainview) and a second view (secondview). The CDP bridge labels content
// targets in registration order — the first becomes 'main', the next 'window-1'
// (see @wdio/cdp-bridge TargetRegistry).
//
// ⚠️ NOT RUN IN CI (skipped). Multi-window exercises an upstream CEF per-instance
// profile-isolation gap: BrowserWindow forces a `persist:default` partition the
// chrome-runtime can't create as a non-global profile, so secondview falls back to
// a racy global context and isn't reliably enumerable as 'window-1'. Not fixable
// from the fixture/service. The CI matrix runs only `standard` (see ci.yml + the
// agent-os plan "Framework gaps"). Runnable LOCALLY via
// `TEST_TYPE=window pnpm test:e2e:electrobun`; re-folded into CI once electrobun
// ships per-window partitions / an ephemeral-per-webview fallback.

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
    // The execute callback runs in the active CEF webview; reach the page DOM via
    // a minimally-typed globalThis (the e2e tsconfig has no DOM lib).
    type Doc = { getElementById(id: string): { id: string } | null };

    it('should evaluate against the active window after switching', async () => {
      await browser.electrobun.switchWindow('window-1');
      const id = await browser.electrobun.execute(() => {
        const el = (globalThis as unknown as { document: Doc }).document.getElementById('second-title');
        return el ? el.id : undefined;
      });
      expect(id).toBe('second-title');

      await browser.electrobun.switchWindow('main');
      const mainId = await browser.electrobun.execute(() => {
        const el = (globalThis as unknown as { document: Doc }).document.getElementById('app-title');
        return el ? el.id : undefined;
      });
      expect(mainId).toBe('app-title');
    });
  });
});
