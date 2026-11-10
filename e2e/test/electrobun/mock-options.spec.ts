import { browser, expect } from '@wdio/globals';
import type { ElectrobunMock } from '@wdio/native-types';

// The fixture has no webview function to mock, so each pair defines one first.
async function defineTarget(name: string): Promise<void> {
  await browser.electrobun.execute((_eb, fnName) => {
    (globalThis as unknown as Record<string, unknown>)[fnName as string] = (...args: unknown[]) => ({
      real: true,
      args,
    });
  }, name);
}

async function callTarget(name: string, ...args: unknown[]): Promise<unknown> {
  return browser.electrobun.execute(
    (_eb, fnName, callArgs) =>
      (globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[fnName as string](
        ...(callArgs as unknown[]),
      ),
    name,
    args,
  );
}

// The standard capability sets clearMocks, resetMocks and restoreMocks, and this file doesn't restore
// between tests. Each pair mocks in one test and checks in the next that the service applied the option.
describe('Electrobun mock options', () => {
  after(async () => {
    await browser.electrobun.restoreAllMocks();
  });

  describe('clearMocks', () => {
    let mock: ElectrobunMock;

    it('should record a call to a mocked function', async () => {
      await defineTarget('mockOptionsClear');
      mock = await browser.electrobun.mock('mockOptionsClear');
      await mock.mockReturnValue('mocked');

      expect(await callTarget('mockOptionsClear')).toBe('mocked');
      await mock.update();
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('should clear the calls before the next test and keep the implementation', async () => {
      expect(mock.mock.calls).toStrictEqual([]);
      await mock.update();
      expect(mock.mock.calls).toStrictEqual([]);
      expect(await callTarget('mockOptionsClear')).toBe('mocked');
    });
  });

  describe('resetMocks', () => {
    it('should mock a function', async () => {
      await defineTarget('mockOptionsReset');
      const mock = await browser.electrobun.mock('mockOptionsReset');
      await mock.mockReturnValue('mocked');

      expect(await callTarget('mockOptionsReset')).toBe('mocked');
    });

    it('should reset the mock before the next test', async () => {
      expect(await callTarget('mockOptionsReset')).toBeUndefined();
    });
  });

  describe('restoreMocks', () => {
    it('should mock a function', async () => {
      await defineTarget('mockOptionsRestore');
      const mock = await browser.electrobun.mock('mockOptionsRestore');
      await mock.mockReturnValue('mocked');

      expect(await callTarget('mockOptionsRestore')).toBe('mocked');
    });

    it('should restore the original before the next test', async () => {
      expect(browser.electrobun.isMockFunction('mockOptionsRestore')).toBe(false);
      expect(await callTarget('mockOptionsRestore', 'arg')).toEqual({ real: true, args: ['arg'] });
    });
  });
});
