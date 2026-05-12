import { expect, multiremotebrowser } from '@wdio/globals';

describe('Dioxus multiremote logging', () => {
  it('should execute scripts in browserA', async () => {
    const browserA = (multiremotebrowser as unknown as { browserA: WebdriverIO.Browser }).browserA;
    const r = await browserA.execute(() => {
      console.info('mr-log-A');
      return 'ok';
    });
    expect(r).toBe('ok');
  });
});
