import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearWindowState,
  getActiveWindowLabel,
  getCurrentWindowLabel,
  getDefaultWindowLabel,
  listWindowLabels,
  setCurrentWindowLabel,
  switchWindowByLabel,
} from '../src/window.js';

function makeBrowser(opts: { sessionId?: string; executeReturns?: unknown[]; handles?: string[] } = {}): {
  browser: WebdriverIO.Browser;
  executeCalls: string[];
} {
  const executeCalls: string[] = [];
  const executeReturns = opts.executeReturns ?? [];
  let executeIdx = 0;

  const browser = {
    sessionId: opts.sessionId ?? 'session-A',
    execute: vi.fn((script: string) => {
      executeCalls.push(script);
      const ret = executeReturns[executeIdx++];
      return Promise.resolve(ret);
    }),
    getWindowHandles: vi.fn().mockResolvedValue(opts.handles ?? ['h-main', 'h-window-1']),
    getWindowHandle: vi.fn().mockResolvedValue('h-main'),
    switchToWindow: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebdriverIO.Browser;

  return { browser, executeCalls };
}

afterEach(() => {
  clearWindowState();
});

describe('window helpers', () => {
  describe('getDefaultWindowLabel', () => {
    it("should return 'main'", () => {
      expect(getDefaultWindowLabel()).toBe('main');
    });
  });

  describe('getCurrentWindowLabel / setCurrentWindowLabel', () => {
    it("should default to 'main' when nothing has been set", () => {
      const { browser } = makeBrowser({ sessionId: 'fresh' });
      expect(getCurrentWindowLabel(browser)).toBe('main');
    });

    it('should cache labels per sessionId', () => {
      const { browser: a } = makeBrowser({ sessionId: 'sess-a' });
      const { browser: b } = makeBrowser({ sessionId: 'sess-b' });
      setCurrentWindowLabel(a, 'window-1');
      expect(getCurrentWindowLabel(a)).toBe('window-1');
      expect(getCurrentWindowLabel(b)).toBe('main');
    });
  });

  describe('clearWindowState', () => {
    beforeEach(() => {
      const { browser: a } = makeBrowser({ sessionId: 'sess-a' });
      const { browser: b } = makeBrowser({ sessionId: 'sess-b' });
      setCurrentWindowLabel(a, 'window-1');
      setCurrentWindowLabel(b, 'window-2');
    });

    it('should clear a specific session by browser ref', () => {
      const { browser: a } = makeBrowser({ sessionId: 'sess-a' });
      clearWindowState(a);
      expect(getCurrentWindowLabel(a)).toBe('main');
      const { browser: b } = makeBrowser({ sessionId: 'sess-b' });
      expect(getCurrentWindowLabel(b)).toBe('window-2');
    });

    it('should clear a specific session by sessionId string', () => {
      clearWindowState('sess-a');
      const { browser: a } = makeBrowser({ sessionId: 'sess-a' });
      expect(getCurrentWindowLabel(a)).toBe('main');
    });

    it('should clear every session when called with no args', () => {
      clearWindowState();
      const { browser: a } = makeBrowser({ sessionId: 'sess-a' });
      const { browser: b } = makeBrowser({ sessionId: 'sess-b' });
      expect(getCurrentWindowLabel(a)).toBe('main');
      expect(getCurrentWindowLabel(b)).toBe('main');
    });
  });

  describe('getActiveWindowLabel', () => {
    it('should invoke __active_window and return its result', async () => {
      const { browser, executeCalls } = makeBrowser({ executeReturns: ['window-1'] });
      const label = await getActiveWindowLabel(browser);
      expect(label).toBe('window-1');
      expect(executeCalls[0]).toContain('__active_window');
    });

    it("should fall back to 'main' when the bridge returns null", async () => {
      const { browser } = makeBrowser({ executeReturns: [null] });
      expect(await getActiveWindowLabel(browser)).toBe('main');
    });

    it("should fall back to 'main' when the bridge throws", async () => {
      const browser = {
        sessionId: 'fail',
        execute: vi.fn().mockRejectedValue(new Error('no bridge')),
      } as unknown as WebdriverIO.Browser;
      expect(await getActiveWindowLabel(browser)).toBe('main');
    });
  });

  describe('listWindowLabels', () => {
    it('should invoke __list_windows and return the array', async () => {
      const { browser, executeCalls } = makeBrowser({ executeReturns: [['main', 'window-1']] });
      const labels = await listWindowLabels(browser);
      expect(labels).toEqual(['main', 'window-1']);
      expect(executeCalls[0]).toContain('__list_windows');
    });

    it('should throw when the bridge returns a non-array', async () => {
      const { browser } = makeBrowser({ executeReturns: ['not-an-array'] });
      await expect(listWindowLabels(browser)).rejects.toThrow(/expected __list_windows to return an array/);
    });

    it('should throw when the array contains non-string items', async () => {
      const { browser } = makeBrowser({ executeReturns: [['main', null, 42]] });
      await expect(listWindowLabels(browser)).rejects.toThrow(
        /__list_windows returned non-string items: \[string, null, number\]/,
      );
    });
  });

  describe('switchWindowByLabel', () => {
    it('should switch to the matching handle and update the cache', async () => {
      // execute calls in order:
      // 1. listWindowLabels — returns ['main', 'window-1']
      // 2. (inside resolveLabelToHandle) per-handle __active_window queries
      //    For handle h-main: 'main'
      //    For handle h-window-1: 'window-1' -> match, return early
      const { browser } = makeBrowser({
        executeReturns: [['main', 'window-1'], 'main', 'window-1'],
        handles: ['h-main', 'h-window-1'],
      });

      await switchWindowByLabel(browser, 'window-1');

      // resolveLabelToHandle iterates handles ('h-main' then 'h-window-1')
      // and the driver is already on the matching handle when it returns,
      // so switchWindowByLabel no longer issues a redundant final switch.
      expect(vi.mocked(browser.switchToWindow).mock.calls.map((c) => c[0])).toEqual(['h-main', 'h-window-1']);
      expect(getCurrentWindowLabel(browser)).toBe('window-1');
    });

    it('should throw with a discoverable message when the label is not in the bridge list', async () => {
      const { browser } = makeBrowser({ executeReturns: [['main']] });
      await expect(switchWindowByLabel(browser, 'nope')).rejects.toThrow(
        /window label "nope" not found. Available: main/,
      );
    });

    it('should restore the original handle when the switch fails', async () => {
      const browser = {
        sessionId: 'restore',
        execute: vi
          .fn()
          .mockResolvedValueOnce(['main', 'window-1']) // listWindowLabels
          .mockResolvedValue('main'), // every per-handle query returns the wrong label
        getWindowHandles: vi.fn().mockResolvedValue(['h-main']),
        getWindowHandle: vi.fn().mockResolvedValue('h-main'),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      // resolveLabelToHandle throws with the package-prefixed error; the
      // outer catch restores the original handle and re-throws the inner
      // error unmodified (no double prefix).
      await expect(switchWindowByLabel(browser, 'window-1')).rejects.toThrow(
        /no window with label "window-1" found after checking all handles/,
      );
      const restoreCalls = vi.mocked(browser.switchToWindow).mock.calls.map((c) => c[0]);
      expect(restoreCalls).toContain('h-main');
    });
  });
});
