import { expect, multiRemoteBrowser } from '@wdio/globals';

describe('Dioxus multiremote advanced', () => {
  it('should run commands in parallel on independent instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');
    const [argsA, argsB] = await Promise.all([
      browserA.dioxus.execute(({ invoke }) => invoke('get_command_line_args')),
      browserB.dioxus.execute(({ invoke }) => invoke('get_command_line_args')),
    ]);
    expect(argsA).toEqual(['--browser=A']);
    expect(argsB).toEqual(['--browser=B']);
  });
});
