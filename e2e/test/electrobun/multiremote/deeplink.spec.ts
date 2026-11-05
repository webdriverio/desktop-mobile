import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

// Multiremote runs only on Windows and Linux, where Electrobun has no deeplinks (blackboardsh/electrobun#465). Once it
// has, the OS still can't tell two copies of one app apart, so reject as the Dioxus service does.
describe('Deeplinks in multiremote (electrobun.triggerDeeplink)', () => {
  it('should reject on an instance', async () => {
    const instanceA = (multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser).getInstance('instanceA');

    await expect(instanceA.electrobun.triggerDeeplink('wdio-electrobun://mr-a')).rejects.toThrow(
      /only supported on macOS/,
    );
  });
});
