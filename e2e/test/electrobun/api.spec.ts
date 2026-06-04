import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Electrobun API', () => {
  it('should execute a basic expression', async () => {
    const result = await browser.electrobun.execute('1 + 2 + 3');
    expect(result).toBe(6);
  });

  it('should execute a statement-style script with a return', async () => {
    const result = await browser.electrobun.execute('return 42');
    expect(result).toBe(42);
  });

  it('should execute a script with variable declarations', async () => {
    const result = await browser.electrobun.execute(`
      const x = 10;
      const y = 20;
      return x + y;
    `);
    expect(result).toBe(30);
  });

  it('should access the DOM from a string script', async () => {
    const result = await browser.electrobun.execute('return document.title');
    expect(typeof result).toBe('string');
  });

  describe('execute - different script types', () => {
    it('should pass the electrobun surface as the first callback arg', async () => {
      const result = await browser.electrobun.execute((eb) => ({ hasSurface: typeof eb === 'object' }));
      expect(result.hasSurface).toBe(true);
    });

    it('should execute a function with the surface and args (with-args branch)', async () => {
      const result = await browser.electrobun.execute((_eb, arg1, arg2) => ({ arg1, arg2 }), 'first', 'second');
      expect(result.arg1).toBe('first');
      expect(result.arg2).toBe('second');
    });

    it('should execute an async function with args', async () => {
      const result = await browser.electrobun.execute(async (_eb, value) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { received: value };
      }, 'async-test');
      expect(result.received).toBe('async-test');
    });

    it('should read the fixture DOM from a function script', async () => {
      // The callback runs in the CEF webview, so `document` is the page DOM. The
      // e2e tsconfig has no DOM lib (these specs run via tsx, not tsc), so reach
      // it through a minimally-typed globalThis rather than a bare global.
      type Doc = { getElementById(id: string): { textContent: string | null } | null };
      const readTitle = () =>
        browser.electrobun.execute(() => {
          const el = (globalThis as unknown as { document: Doc }).document.getElementById('app-title');
          return el ? el.textContent : undefined;
        });
      // The webview may still be painting when the bridge attaches, so poll for the
      // title rather than reading once (avoids a flaky read-before-render).
      let result: string | null | undefined;
      await browser.waitUntil(
        async () => {
          result = await readTitle();
          return typeof result === 'string' && result.includes('Electrobun');
        },
        { timeout: 10_000, timeoutMsg: 'fixture #app-title never rendered' },
      );
      expect(result).toContain('Electrobun');
    });
  });
});
