import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

const root = () => multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;

// Both instances run the same app, and the OS can't pick one of them.
describe('Deeplinks in multiremote (dioxus.triggerDeeplink)', () => {
  const refusal = /can't reach a multiremote instance/;

  it('should reject on an instance', async () => {
    await expect(root().getInstance('browserA').dioxus.triggerDeeplink('wdiotest://mr-a')).rejects.toThrow(refusal);
  });

  it('should reject on the root', async () => {
    await expect(root().dioxus.triggerDeeplink('wdiotest://mr-root')).rejects.toThrow(refusal);
  });
});
