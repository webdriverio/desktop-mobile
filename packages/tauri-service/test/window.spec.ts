import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pluginCacheModule from '../src/pluginCache.js';
import {
  clearWindowState,
  ensureActiveWindowFocus,
  getActiveWindowLabel,
  getCurrentDevtoolsPort,
  getCurrentWindowLabel,
  getDefaultWindowLabel,
  getLastCommand,
  listWindowLabels,
  setCurrentWindowLabel,
  setSessionProvider,
  suppressActiveWindowFocus,
  switchWindowByLabel,
  updateLastCommand,
} from '../src/window.js';

describe('window management', () => {
  beforeEach(() => {
    clearWindowState();
  });

  afterEach(() => {
    clearWindowState();
  });

  describe('getActiveWindowLabel', () => {
    it('should return active window label from tauri API', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValue('main'),
        },
      } as unknown as WebdriverIO.Browser;

      const result = await getActiveWindowLabel(mockBrowser);
      expect(result).toBe('main');
      expect(mockBrowser.tauri.execute).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should return "main" as fallback on error', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockRejectedValue(new Error('API error')),
        },
      } as unknown as WebdriverIO.Browser;

      const result = await getActiveWindowLabel(mockBrowser);
      expect(result).toBe('main');
    });
  });

  describe('listWindowLabels', () => {
    it('should return list of window labels', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValue(['main', 'splash']),
        },
      } as unknown as WebdriverIO.Browser;

      const result = await listWindowLabels(mockBrowser);
      expect(result).toEqual(['main', 'splash']);
    });

    it('should propagate errors', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockRejectedValue(new Error('API error')),
        },
      } as unknown as WebdriverIO.Browser;

      await expect(listWindowLabels(mockBrowser)).rejects.toThrow('API error');
    });

    it('should throw when result is not an array', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValue('not-an-array'),
        },
      } as unknown as WebdriverIO.Browser;

      await expect(listWindowLabels(mockBrowser)).rejects.toThrow('Expected array but got string');
    });
  });

  describe('getDefaultWindowLabel', () => {
    it('should return "main" as the default window label', () => {
      expect(getDefaultWindowLabel()).toBe('main');
    });
  });

  describe('getCurrentWindowLabel and setCurrentWindowLabel', () => {
    it('should return default label when no label is set', () => {
      const mockBrowser = {
        sessionId: 'test-session',
      } as unknown as WebdriverIO.Browser;

      expect(getCurrentWindowLabel(mockBrowser)).toBe('main');
    });

    it('should return set label after calling setCurrentWindowLabel', () => {
      const mockBrowser = {
        sessionId: 'test-session',
      } as unknown as WebdriverIO.Browser;

      setCurrentWindowLabel(mockBrowser, 'settings');
      expect(getCurrentWindowLabel(mockBrowser)).toBe('settings');
    });

    it('should track different labels for different sessions', () => {
      const browser1 = { sessionId: 'session-1' } as unknown as WebdriverIO.Browser;
      const browser2 = { sessionId: 'session-2' } as unknown as WebdriverIO.Browser;

      setCurrentWindowLabel(browser1, 'popup');
      setCurrentWindowLabel(browser2, 'settings');

      expect(getCurrentWindowLabel(browser1)).toBe('popup');
      expect(getCurrentWindowLabel(browser2)).toBe('settings');
    });
  });

  describe('switchWindowByLabel', () => {
    it('should throw when window label is not found', async () => {
      const mockBrowser = {
        sessionId: 'test-session',
        tauri: {
          execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
        },
        getWindowHandle: vi.fn().mockReturnValue('original-handle'),
      } as unknown as WebdriverIO.Browser;

      await expect(switchWindowByLabel(mockBrowser, 'nonexistent')).rejects.toThrow(
        'Window label "nonexistent" not found',
      );
    });

    describe('embedded provider (default)', () => {
      it('should switch directly using the label as the window handle', async () => {
        const mockBrowser = {
          sessionId: 'embedded-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        // No setSessionProvider call — default is 'embedded'
        await switchWindowByLabel(mockBrowser, 'splash');

        expect(mockBrowser.switchToWindow).toHaveBeenCalledWith('splash');
        expect(mockBrowser.switchToWindow).toHaveBeenCalledTimes(1);
      });

      it('should not call getWindowHandles for embedded provider', async () => {
        const mockBrowser = {
          sessionId: 'embedded-session-2',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main']),
          },
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          getWindowHandles: vi.fn(),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await switchWindowByLabel(mockBrowser, 'main');

        expect(mockBrowser.getWindowHandles).not.toHaveBeenCalled();
      });

      it('should throw a descriptive error when embedded direct switch fails', async () => {
        const mockBrowser = {
          sessionId: 'embedded-err-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          switchToWindow: vi.fn().mockRejectedValueOnce(new Error('no such window')).mockResolvedValue(undefined),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await expect(switchWindowByLabel(mockBrowser, 'splash')).rejects.toThrow(
          'Failed to switch to window with label "splash": no such window',
        );

        // Should have restored focus to original window
        expect(mockBrowser.switchToWindow).toHaveBeenCalledWith('original-handle');
      });
    });

    describe('official provider', () => {
      it('should iterate handles and resolve label via IPC', async () => {
        const mockBrowser = {
          sessionId: 'official-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          getWindowHandles: vi.fn().mockResolvedValue(['uuid-aaa', 'uuid-bbb']),
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          executeAsync: vi.fn().mockResolvedValueOnce('main').mockResolvedValueOnce('splash'),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        setSessionProvider(mockBrowser, 'official');
        await switchWindowByLabel(mockBrowser, 'splash');

        expect(mockBrowser.getWindowHandles).toHaveBeenCalled();
        expect(mockBrowser.switchToWindow).toHaveBeenCalledWith('uuid-bbb');
      });

      it('should stop iterating handles once the target label is found', async () => {
        const mockBrowser = {
          sessionId: 'official-stop-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          getWindowHandles: vi.fn().mockResolvedValue(['uuid-1', 'uuid-2', 'uuid-3']),
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          executeAsync: vi.fn().mockResolvedValueOnce('main'),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        setSessionProvider(mockBrowser, 'official');
        await switchWindowByLabel(mockBrowser, 'main');

        // Should call executeAsync only once (found on first handle)
        expect(mockBrowser.executeAsync).toHaveBeenCalledTimes(1);
        expect(mockBrowser.switchToWindow).toHaveBeenLastCalledWith('uuid-1');
      });

      it('should skip stale handles and continue', async () => {
        const mockBrowser = {
          sessionId: 'official-stale-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          getWindowHandles: vi.fn().mockResolvedValue(['stale-uuid', 'uuid-splash']),
          switchToWindow: vi.fn().mockRejectedValueOnce(new Error('no such window')).mockResolvedValue(undefined),
          executeAsync: vi.fn().mockResolvedValueOnce('splash'),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        setSessionProvider(mockBrowser, 'official');
        await switchWindowByLabel(mockBrowser, 'splash');

        expect(mockBrowser.switchToWindow).toHaveBeenLastCalledWith('uuid-splash');
      });

      it('should throw with discovered labels when no handle matches', async () => {
        const mockBrowser = {
          sessionId: 'official-nomatch-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'ghost']),
          },
          getWindowHandles: vi.fn().mockResolvedValue(['uuid-1']),
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          executeAsync: vi.fn().mockResolvedValueOnce('main'),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        setSessionProvider(mockBrowser, 'official');
        await expect(switchWindowByLabel(mockBrowser, 'ghost')).rejects.toThrow('ghost');
      });
    });

    describe('crabnebula provider', () => {
      it('should use handle iteration (same path as official)', async () => {
        const mockBrowser = {
          sessionId: 'cn-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          getWindowHandles: vi.fn().mockResolvedValue(['cn-uuid-main', 'cn-uuid-splash']),
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          executeAsync: vi.fn().mockResolvedValueOnce('main').mockResolvedValueOnce('splash'),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        setSessionProvider(mockBrowser, 'crabnebula');
        await switchWindowByLabel(mockBrowser, 'splash');

        expect(mockBrowser.getWindowHandles).toHaveBeenCalled();
        expect(mockBrowser.switchToWindow).toHaveBeenLastCalledWith('cn-uuid-splash');
      });
    });

    describe('IPC validation failure handling', () => {
      it('should attempt switch directly when listWindowLabels throws a transient IPC error', async () => {
        const mockBrowser = {
          sessionId: 'ipc-fail-session',
          tauri: {
            execute: vi.fn().mockRejectedValueOnce(new Error('Tauri plugin not available')),
          },
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await expect(switchWindowByLabel(mockBrowser, 'settings')).resolves.not.toThrow();
        expect(mockBrowser.switchToWindow).toHaveBeenCalledWith('settings');
      });

      it('should still reject with a clear error when label is genuinely absent', async () => {
        const mockBrowser = {
          sessionId: 'absent-label-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'splash']),
          },
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await expect(switchWindowByLabel(mockBrowser, 'ghost')).rejects.toThrow(
          'Window label "ghost" not found. Available windows: main, splash',
        );
      });

      it('should clear pluginAvailabilityCache after a successful switch', async () => {
        const spy = vi.spyOn(pluginCacheModule, 'clearPluginAvailabilityCache');
        const mockBrowser = {
          sessionId: 'cache-clear-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main', 'settings']),
          },
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await switchWindowByLabel(mockBrowser, 'settings');

        expect(spy).toHaveBeenCalledWith(mockBrowser);
        spy.mockRestore();
      });
    });

    describe('auto-focus suppression', () => {
      it('should suppress ensureActiveWindowFocus after switchWindowByLabel', async () => {
        const mockBrowser = {
          sessionId: 'autofocus-session',
          tauri: {
            execute: vi.fn().mockResolvedValueOnce(['main']),
          },
          switchToWindow: vi.fn().mockResolvedValue(undefined),
          getWindowHandle: vi.fn().mockReturnValue('original-handle'),
        } as unknown as WebdriverIO.Browser;

        await switchWindowByLabel(mockBrowser, 'main');

        // After an explicit switchWindow, ensureActiveWindowFocus should skip IPC
        vi.clearAllMocks();
        const focusBrowser = { ...mockBrowser, tauri: { execute: vi.fn() } } as unknown as WebdriverIO.Browser;
        // Re-use same sessionId so the cache check applies
        Object.defineProperty(focusBrowser, 'sessionId', { value: 'autofocus-session' });
        await ensureActiveWindowFocus(focusBrowser, 'getTitle');
        expect(focusBrowser.tauri.execute).not.toHaveBeenCalled();
      });

      it('should suppress ensureActiveWindowFocus after a raw WebDriver window switch', async () => {
        const mockBrowser = {
          sessionId: 'raw-switch-session',
          tauri: { execute: vi.fn() },
        } as unknown as WebdriverIO.Browser;

        suppressActiveWindowFocus(mockBrowser);
        await ensureActiveWindowFocus(mockBrowser, 'getTitle');

        expect(mockBrowser.tauri.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateLastCommand and getLastCommand', () => {
    it('should store and retrieve last command', () => {
      const mockBrowser = {
        sessionId: 'test-session-123',
      } as unknown as WebdriverIO.Browser;

      updateLastCommand(mockBrowser, 'click');
      const result = getLastCommand(mockBrowser);
      expect(result).toBe('click');
    });

    it('should return undefined for unknown session', () => {
      const mockBrowser = {
        sessionId: 'unknown-session',
      } as unknown as WebdriverIO.Browser;

      const result = getLastCommand(mockBrowser);
      expect(result).toBeUndefined();
    });
  });

  describe('clearWindowState', () => {
    it('should clear all cached window state', () => {
      const mockBrowser = {
        sessionId: 'test-session',
      } as unknown as WebdriverIO.Browser;

      updateLastCommand(mockBrowser, 'click');
      clearWindowState();
      const result = getLastCommand(mockBrowser);
      expect(result).toBeUndefined();
    });

    it('should clear a specific session state', () => {
      const browser1 = { sessionId: 'session-1' } as unknown as WebdriverIO.Browser;
      const browser2 = { sessionId: 'session-2' } as unknown as WebdriverIO.Browser;

      updateLastCommand(browser1, 'click');
      updateLastCommand(browser2, 'setValue');

      clearWindowState('session-1');

      expect(getLastCommand(browser1)).toBeUndefined();
      expect(getLastCommand(browser2)).toBe('setValue');
    });

    it('should clear all state when no argument is provided', () => {
      const browser1 = { sessionId: 'session-a' } as unknown as WebdriverIO.Browser;
      const browser2 = { sessionId: 'session-b' } as unknown as WebdriverIO.Browser;

      updateLastCommand(browser1, 'click');
      updateLastCommand(browser2, 'setValue');

      clearWindowState();

      expect(getLastCommand(browser1)).toBeUndefined();
      expect(getLastCommand(browser2)).toBeUndefined();
    });
  });

  describe('getCurrentDevtoolsPort', () => {
    it('should extract port from debuggerAddress capability', async () => {
      const mockBrowser = {
        capabilities: {
          'goog:chromeOptions': {
            debuggerAddress: 'localhost:12345',
          },
        },
      } as unknown as WebdriverIO.Browser;

      const port = await getCurrentDevtoolsPort(mockBrowser);
      expect(port).toBe(12345);
    });

    it('should return undefined when no debuggerAddress exists', async () => {
      const mockBrowser = {
        capabilities: {
          'goog:chromeOptions': {},
        },
      } as unknown as WebdriverIO.Browser;

      const port = await getCurrentDevtoolsPort(mockBrowser);
      expect(port).toBeUndefined();
    });

    it('should return undefined when no goog:chromeOptions exists', async () => {
      const mockBrowser = {
        capabilities: {},
      } as unknown as WebdriverIO.Browser;

      const port = await getCurrentDevtoolsPort(mockBrowser);
      expect(port).toBeUndefined();
    });

    it('should return undefined when debuggerAddress has no port', async () => {
      const mockBrowser = {
        capabilities: {
          'goog:chromeOptions': {
            debuggerAddress: 'no-port-here',
          },
        },
      } as unknown as WebdriverIO.Browser;

      const port = await getCurrentDevtoolsPort(mockBrowser);
      expect(port).toBeUndefined();
    });
  });

  describe('ensureActiveWindowFocus', () => {
    it('should not check focus for non-DOM commands', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn(),
        },
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'url');
      expect(mockBrowser.tauri.execute).not.toHaveBeenCalled();
    });

    it('should check focus for DOM commands', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'main', title: 'main window', is_visible: true, is_focused: true }]),
        },
        getWindowHandles: vi.fn().mockResolvedValue(['handle1', 'handle2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
        getTitle: vi.fn().mockResolvedValue('main window'),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'getTitle');
      expect(mockBrowser.tauri.execute).toHaveBeenCalled();
    });

    it('should handle when no window states are available', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockRejectedValue(new Error('API error')),
        },
        getWindowHandles: vi.fn().mockResolvedValue(['handle1', 'handle2']),
        getTitle: vi.fn().mockResolvedValue('main window'),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'getTitle');
      expect(mockBrowser.tauri.execute).toHaveBeenCalled();
    });

    it('should not switch when already on the active window', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'main', title: 'My App', is_visible: true, is_focused: true }]),
        },
        getTitle: vi.fn().mockResolvedValue('My App'),
        getWindowHandles: vi.fn(),
        switchToWindow: vi.fn(),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'findElement');

      expect(mockBrowser.getWindowHandles).not.toHaveBeenCalled();
      expect(mockBrowser.switchToWindow).not.toHaveBeenCalled();
    });

    it('should switch to a different active window when title does not match', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'settings', title: 'Settings', is_visible: true, is_focused: true }]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Main Window')
          .mockResolvedValueOnce('Main Window')
          .mockResolvedValueOnce('Settings'),
        getWindowHandles: vi.fn().mockResolvedValue(['handle1', 'handle2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'findElement');

      expect(mockBrowser.getWindowHandles).toHaveBeenCalled();
    });
  });

  describe('findActiveWindow (via ensureActiveWindowFocus)', () => {
    it('should prefer visible AND focused window', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValueOnce([
            { label: 'bg', title: 'Background', is_visible: false, is_focused: false },
            { label: 'main', title: 'Main', is_visible: true, is_focused: true },
            { label: 'other', title: 'Other', is_visible: true, is_focused: false },
          ]),
        },
        getTitle: vi.fn().mockResolvedValue('Background'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2', 'h3']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      (mockBrowser.getTitle as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Background')
        .mockResolvedValueOnce('Background')
        .mockResolvedValueOnce('Main')
        .mockResolvedValueOnce('Other')
        .mockResolvedValueOnce('Main');

      await ensureActiveWindowFocus(mockBrowser, '$');

      const switchCalls = (mockBrowser.switchToWindow as ReturnType<typeof vi.fn>).mock.calls;
      const lastHandle = switchCalls[switchCalls.length - 1]?.[0];
      expect(lastHandle).toBe('h2');
    });

    it('should fall back to visible-only window when none are focused', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValueOnce([
            { label: 'hidden', title: 'Hidden', is_visible: false, is_focused: false },
            { label: 'visible', title: 'Visible', is_visible: true, is_focused: false },
          ]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Hidden')
          .mockResolvedValueOnce('Hidden')
          .mockResolvedValueOnce('Visible')
          .mockResolvedValueOnce('Visible'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'findElement');

      const switchCalls = (mockBrowser.switchToWindow as ReturnType<typeof vi.fn>).mock.calls;
      const lastHandle = switchCalls[switchCalls.length - 1]?.[0];
      expect(lastHandle).toBe('h2');
    });

    it('should fall back to focused-only window when none are visible', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValueOnce([
            { label: 'hidden1', title: 'Hidden1', is_visible: false, is_focused: false },
            { label: 'focused', title: 'Focused', is_visible: false, is_focused: true },
          ]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Hidden1')
          .mockResolvedValueOnce('Hidden1')
          .mockResolvedValueOnce('Focused')
          .mockResolvedValueOnce('Focused'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'findElements');

      const switchCalls = (mockBrowser.switchToWindow as ReturnType<typeof vi.fn>).mock.calls;
      const lastHandle = switchCalls[switchCalls.length - 1]?.[0];
      expect(lastHandle).toBe('h2');
    });

    it('should fall back to first available window when none are visible or focused', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValueOnce([
            { label: 'first', title: 'First', is_visible: false, is_focused: false },
            { label: 'second', title: 'Second', is_visible: false, is_focused: false },
          ]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Something Else')
          .mockResolvedValueOnce('First')
          .mockResolvedValueOnce('Second')
          .mockResolvedValueOnce('First'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, '$$');

      const switchCalls = (mockBrowser.switchToWindow as ReturnType<typeof vi.fn>).mock.calls;
      const lastHandle = switchCalls[switchCalls.length - 1]?.[0];
      expect(lastHandle).toBe('h1');
    });

    it('should return early when window states list is empty', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi.fn().mockResolvedValueOnce([]),
        },
        getTitle: vi.fn(),
        getWindowHandles: vi.fn(),
        switchToWindow: vi.fn(),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'getTitle');

      expect(mockBrowser.getTitle).not.toHaveBeenCalled();
      expect(mockBrowser.getWindowHandles).not.toHaveBeenCalled();
    });
  });

  describe('switchToWindowByTitle (via ensureActiveWindowFocus)', () => {
    it('should successfully switch to window matching title', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'target', title: 'Target Window', is_visible: true, is_focused: true }]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Other Window')
          .mockResolvedValueOnce('Other Window')
          .mockResolvedValueOnce('Target Window')
          .mockResolvedValueOnce('Target Window'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await ensureActiveWindowFocus(mockBrowser, 'elementClick');

      expect(mockBrowser.switchToWindow).toHaveBeenCalled();
    });

    it('should handle when no window matches the target title', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'ghost', title: 'Ghost Window', is_visible: true, is_focused: true }]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Current')
          .mockResolvedValueOnce('Window A')
          .mockResolvedValueOnce('Window B'),
        getWindowHandles: vi.fn().mockResolvedValue(['h1', 'h2']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await expect(ensureActiveWindowFocus(mockBrowser, 'findElement')).resolves.not.toThrow();
    });

    it('should handle stale window handle gracefully', async () => {
      const mockBrowser = {
        tauri: {
          execute: vi
            .fn()
            .mockResolvedValueOnce([{ label: 'target', title: 'Target', is_visible: true, is_focused: true }]),
        },
        getTitle: vi
          .fn()
          .mockResolvedValueOnce('Current')
          .mockResolvedValueOnce('Target')
          .mockResolvedValueOnce('Target'),
        getWindowHandles: vi.fn().mockResolvedValue(['stale-handle', 'good-handle']),
        switchToWindow: vi.fn().mockRejectedValueOnce(new Error('no such window')).mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;

      await expect(ensureActiveWindowFocus(mockBrowser, 'getTitle')).resolves.not.toThrow();
    });
  });
});

describe('DOM command filtering', () => {
  beforeEach(() => {
    clearWindowState();
  });

  afterEach(() => {
    clearWindowState();
  });

  it('should only switch on specific DOM commands', async () => {
    const mockBrowser = {
      tauri: {
        execute: vi.fn(),
      },
      getWindowHandles: vi.fn().mockResolvedValue(['handle1', 'handle2']),
      switchToWindow: vi.fn().mockResolvedValue(undefined),
      getTitle: vi.fn().mockResolvedValue('main window'),
    } as unknown as WebdriverIO.Browser;

    const domCommands = ['getTitle', 'findElement', 'findElements', '$', '$$', 'elementClick'];

    for (const cmd of domCommands) {
      await ensureActiveWindowFocus(mockBrowser, cmd);
      expect(mockBrowser.tauri.execute).toHaveBeenCalledWith(expect.any(Function));
      vi.clearAllMocks();
    }
  });
});
