import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Tauri API', () => {
  it('should execute basic commands', async () => {
    // Test basic command execution using the execute API
    const result = await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'));
    expect(result).toHaveProperty('os');
    expect(result).toHaveProperty('arch');
    expect(result).toHaveProperty('hostname');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('cpu');
  });

  it('should handle command errors gracefully', async () => {
    // Test error handling for invalid commands
    await expect(browser.tauri.execute(({ core }) => core.invoke('invalid_command'))).rejects.toThrow();
  });

  it('should execute commands with parameters', async () => {
    // Test command execution with parameters
    const result = (await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'))) as { os: string };
    expect(result).toHaveProperty('os');
    expect(typeof result.os).toBe('string');
  });

  describe('execute - different script types', () => {
    it('should execute function with Tauri APIs and args (with-args branch)', async () => {
      // This tests the with-args branch: function receives Tauri APIs as first param, user args after
      const result = await browser.tauri.execute(
        (tauri, arg1, arg2) => {
          return { tauriHasCore: typeof tauri?.core?.invoke === 'function', arg1, arg2 };
        },
        'first',
        'second',
      );
      expect(result.tauriHasCore).toBe(true);
      expect(result.arg1).toBe('first');
      expect(result.arg2).toBe('second');
    });

    it('should execute statement-style string (return statement)', async () => {
      // This tests the no-args branch with statement-style script like "return document.title"
      const result = await browser.tauri.execute('return 42');
      expect(result).toBe(42);
    });

    it('should execute expression-style string', async () => {
      // This tests the no-args branch with expression-style script
      const result = await browser.tauri.execute('1 + 2 + 3');
      expect(result).toBe(6);
    });

    it('should execute string with variable declaration', async () => {
      // Statement-style: declare variables and return
      const result = await browser.tauri.execute(`
        const x = 10;
        const y = 20;
        return x + y;
      `);
      expect(result).toBe(30);
    });

    it('should execute function with Tauri APIs (no args)', async () => {
      // Function without args should still receive Tauri APIs
      const result = await browser.tauri.execute((tauri) => {
        return { hasCore: typeof tauri?.core !== 'undefined' };
      });
      expect(result.hasCore).toBe(true);
    });

    it('should execute string that accesses Tauri APIs', async () => {
      // String script that uses window.__TAURI__ directly
      const result = await browser.tauri.execute(`
        return typeof window.__TAURI__?.core;
      `);
      expect(result).toBe('object');
    });

    it('should execute async function with args', async () => {
      const result = await browser.tauri.execute(async (tauri, value) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { received: value, hasTauri: !!tauri?.core };
      }, 'async-test');
      expect(result.received).toBe('async-test');
      expect(result.hasTauri).toBe(true);
    });
  });

  describe('emitEvent', () => {
    type EventTestGlobals = {
      __wdioEvents?: unknown[];
      __wdioUnlisten?: () => Promise<void>;
      __TAURI__: {
        event: {
          listen: (
            event: string,
            handler: (event: { payload: unknown }) => void,
            options?: { target: { kind: string; label: string } },
          ) => Promise<() => Promise<void>>;
        };
      };
    };

    // execute() can rerun a script, so drop any earlier listener first or two could be left behind
    const listen = (event: string, target?: { kind: string; label: string }) =>
      browser.tauri.execute(
        async (_tauri, ev: string, t?: { kind: string; label: string }) => {
          const g = globalThis as unknown as EventTestGlobals;
          await g.__wdioUnlisten?.();
          g.__wdioEvents = [];
          g.__wdioUnlisten = await g.__TAURI__.event.listen(
            ev,
            (e) => {
              g.__wdioEvents?.push(e.payload);
            },
            t ? { target: t } : undefined,
          );
        },
        event,
        target,
      );

    const receivedEvents = () =>
      browser.tauri.execute(() => (globalThis as unknown as EventTestGlobals).__wdioEvents ?? []);

    afterEach(async () => {
      try {
        await browser.tauri.execute(async () => {
          const g = globalThis as unknown as EventTestGlobals;
          const unlisten = g.__wdioUnlisten;
          g.__wdioUnlisten = undefined;
          await unlisten?.();
        });
      } finally {
        await browser.tauri.restoreAllMocks('plugin:event|');
      }
    });

    it("should reach listeners while plugin:event|emit is mocked, without the mock seeing the test's emit", async () => {
      const emitMock = await browser.tauri.mock('plugin:event|emit');
      await listen('wdio:test-emit-mocked');
      await browser.tauri.emitEvent('wdio:test-emit-mocked', { mocked: true });

      await browser.waitUntil(async () => (await receivedEvents()).length > 0, {
        timeout: 5000,
        timeoutMsg: 'expected the listener to receive the event while plugin:event|emit is mocked',
      });
      expect(await receivedEvents()).toEqual([{ mocked: true }]);
      expect(emitMock).toHaveBeenCalledTimes(0);

      // The mock records an emit made through the mock-aware invoke, so the zero above means emitEvent skipped it
      await browser.tauri.execute((tauri) =>
        tauri.core.invoke('plugin:event|emit', { event: 'wdio:test-emit-mocked', payload: { viaMock: true } }),
      );
      expect(emitMock).toHaveBeenCalledTimes(1);
    });

    it('should emit an event to listeners when target is omitted', async () => {
      await listen('wdio:test-emit');
      await browser.tauri.emitEvent('wdio:test-emit', { message: 'hello from emitEvent' });

      await browser.waitUntil(async () => (await receivedEvents()).length > 0, {
        timeout: 5000,
        timeoutMsg: 'expected wdio:test-emit listener to receive event',
      });
      expect(await receivedEvents()).toEqual([{ message: 'hello from emitEvent' }]);
    });

    it('should emit only to the target window when a target is provided', async () => {
      // Listen as the main window, so an event sent to another label doesn't arrive.
      await listen('wdio:test-emit-to', { kind: 'WebviewWindow', label: 'main' });

      // Events arrive in order, so if an earlier one leaked, it would arrive before the last.
      await browser.tauri.emitEvent('wdio:test-emit-to', { to: 'other' }, 'no-such-window');
      // Same label but a different kind, which Tauri doesn't deliver
      await browser.tauri.emitEvent('wdio:test-emit-to', { to: 'main as a Window' }, { kind: 'Window', label: 'main' });
      await browser.tauri.emitEvent('wdio:test-emit-to', { to: 'main' }, 'main');

      await browser.waitUntil(async () => (await receivedEvents()).length > 0, {
        timeout: 5000,
        timeoutMsg: 'expected wdio:test-emit-to listener on main to receive event',
      });
      expect(await receivedEvents()).toEqual([{ to: 'main' }]);
    });
  });
});
