import { browser, expect } from '@wdio/globals';

describe('Dioxus embedded logging notes', () => {
  it('console.info works in embedded mode', async () => {
    await expect(
      browser.execute(() => {
        console.info('embedded-log-probe');
        return true;
      }),
    ).resolves.toBe(true);
  });

  it('console.warn works in embedded mode', async () => {
    await expect(
      browser.execute(() => {
        console.warn('embedded-warn-probe');
        return true;
      }),
    ).resolves.toBe(true);
  });
});
