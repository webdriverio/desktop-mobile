import { expect, multiRemoteBrowser } from '@wdio/globals';

describe('Dioxus multiremote logging', () => {
  it('should execute scripts in browserA', async () => {
    const browserA = (multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser).getInstance('browserA');
    const r = await browserA.execute(() => {
      console.info('mr-log-A');
      return 'ok';
    });
    expect(r).toBe('ok');
  });
});
