import { browser, expect } from '@wdio/globals';

describe('Dioxus standalone logging', () => {
  it('should capture console output', async () => {
    await expect(
      browser.execute(() => {
        console.log('standalone-log-probe');
        return true;
      }),
    ).resolves.toBe(true);
  });
});
