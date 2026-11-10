import { browser, expect } from '@wdio/globals';
import type { DioxusMock } from '@wdio/native-types';

// The standard capability sets clearMocks, resetMocks and restoreMocks, with prefixes that give each option
// its own command so one can't mask another. Each pair mocks in one test and checks in the next that the
// service applied the option; nothing restores between them.
describe('Dioxus mock options', () => {
  after(async () => {
    await browser.dioxus.restoreAllMocks();
  });

  describe('clearMocks', () => {
    let mock: DioxusMock;

    it('should record a call to a mocked command', async () => {
      mock = await browser.dioxus.mock('mock_options_clear');
      await mock.mockReturnValue('mocked');

      expect(await browser.dioxus.execute(({ invoke }) => invoke('mock_options_clear'))).toBe('mocked');
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);
    });

    it('should clear the calls before the next test and keep the implementation', async () => {
      expect(mock.mock.calls).toStrictEqual([]);
      await mock.update();
      expect(mock.mock.calls).toStrictEqual([]);
      expect(await browser.dioxus.execute(({ invoke }) => invoke('mock_options_clear'))).toBe('mocked');
    });
  });

  describe('resetMocks', () => {
    it('should mock a command', async () => {
      const mock = await browser.dioxus.mock('mock_options_reset');
      await mock.mockReturnValue('mocked');

      expect(await browser.dioxus.execute(({ invoke }) => invoke('mock_options_reset'))).toBe('mocked');
    });

    it('should reset the mock before the next test', async () => {
      // Compared in the page: the external provider returns undefined as null.
      const returnedUndefined = await browser.dioxus.execute(
        async ({ invoke }) => (await invoke('mock_options_reset')) === undefined,
      );
      expect(returnedUndefined).toBe(true);
    });
  });

  describe('restoreMocks', () => {
    it('should mock a command', async () => {
      const mock = await browser.dioxus.mock('get_command_line_args');
      await mock.mockReturnValue('mocked');

      expect(await browser.dioxus.execute(({ invoke }) => invoke('get_command_line_args'))).toBe('mocked');
    });

    it('should restore the command before the next test', async () => {
      expect(browser.dioxus.isMockFunction('get_command_line_args')).toBe(false);
      expect(await browser.dioxus.execute(({ invoke }) => invoke('get_command_line_args'))).toEqual(expect.any(Array));
    });
  });
});
