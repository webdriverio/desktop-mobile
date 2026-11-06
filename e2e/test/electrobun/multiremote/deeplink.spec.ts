import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

// The multiremote suite runs only on Windows and Linux, which have no Electrobun deeplinks yet (blackboardsh/electrobun#465).
// Once they do, the OS still can't tell two copies of one app apart: add a same-app refusal, as Dioxus has, and assert it.
describe('Deeplinks in multiremote (electrobun.triggerDeeplink)', () => {
  it('should reject on an instance', async () => {
    const instanceA = (multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser).getInstance('instanceA');

    await expect(instanceA.electrobun.triggerDeeplink('wdio-electrobun://mr-a')).rejects.toThrow(
      /only supported on macOS/,
    );
  });
});
