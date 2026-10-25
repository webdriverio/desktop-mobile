import { expect, multiRemoteBrowser } from '@wdio/globals';

describe('Dioxus multiremote advanced', () => {
  it('should run commands in parallel on independent instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');
    const [platformA, platformB] = await Promise.all([
      browserA.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
      browserB.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
    ]);
    expect((platformA as { os: string }).os).toBeTruthy();
    expect((platformB as { os: string }).os).toBeTruthy();
  });
});
