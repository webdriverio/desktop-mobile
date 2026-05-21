import { expect, multiremotebrowser } from '@wdio/globals';

describe('Dioxus multiremote advanced', () => {
  it('should run commands in parallel on independent instances', async () => {
    const browserA = (multiremotebrowser as unknown as { browserA: WebdriverIO.Browser }).browserA;
    const browserB = (multiremotebrowser as unknown as { browserB: WebdriverIO.Browser }).browserB;
    const [platformA, platformB] = await Promise.all([
      browserA.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
      browserB.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
    ]);
    expect((platformA as { os: string }).os).toBeTruthy();
    expect((platformB as { os: string }).os).toBeTruthy();
  });
});
