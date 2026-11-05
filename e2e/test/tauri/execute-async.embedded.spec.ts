import { browser, expect } from '@wdio/globals';

describe('Execute Async Script (embedded)', () => {
  // browser.execute sends an async function through Execute Async Script.
  describe('browser.execute with an async function', () => {
    it('should return the value it resolves after a delay', async () => {
      const result = await browser.execute(
        async (a, b) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return a + b;
        },
        20,
        22,
      );

      expect(result).toBe(42);
    });

    it('should pass an element argument as the DOM element', async () => {
      const counter = await browser.$('#counter');

      const id = await browser.execute(async (el) => el.id, counter);

      expect(id).toBe('counter');
    });

    it('should reject with the error the function throws', async () => {
      await expect(
        browser.execute(async () => {
          throw new RangeError(`thrown-${40 + 2}`);
        }),
      ).rejects.toMatchObject({ name: 'RangeError', message: 'thrown-42' });
    });
  });

  describe('executeAsyncScript', () => {
    it('should return the value the script passes to done', async () => {
      const result = await browser.executeAsyncScript(
        'var a = arguments[0], b = arguments[1], done = arguments[2];' +
          'setTimeout(function () { done({ sum: a + b, args: [a, b] }); }, 100);',
        [20, 22],
      );

      expect(result).toEqual({ sum: 42, args: [20, 22] });
    });

    it('should reject a script that throws with a javascript error', async () => {
      await expect(browser.executeAsyncScript('throw new Error("thrown-" + (40 + 2));', [])).rejects.toMatchObject({
        name: 'javascript error',
        message: expect.stringContaining('thrown-42'),
      });
    });

    describe('with a short script timeout', () => {
      const scriptTimeoutMs = 1000;
      let originalScriptTimeout: number | null | undefined;

      before(async () => {
        ({ script: originalScriptTimeout } = await browser.getTimeouts());
        await browser.setTimeouts(undefined, undefined, scriptTimeoutMs);
      });

      after(async () => {
        await browser.setTimeouts(undefined, undefined, originalScriptTimeout);
      });

      it('should fail with a script timeout when the script never calls done', async () => {
        await expect(
          browser.executeAsyncScript('window.__wdioScriptStartedAt = Date.now();', []),
        ).rejects.toMatchObject({ name: 'script timeout' });

        // WebdriverIO retries a timed-out script, so time only the last attempt, in the page.
        const waited = await browser.execute(
          () => Date.now() - (window as unknown as { __wdioScriptStartedAt: number }).__wdioScriptStartedAt,
        );
        expect(waited).toBeGreaterThanOrEqual(scriptTimeoutMs);
      });
    });
  });
});
