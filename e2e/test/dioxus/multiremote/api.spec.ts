import { expect, multiRemoteBrowser } from '@wdio/globals';

describe('Dioxus multiremote API', () => {
  it('should execute in both instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const [a, b] = await Promise.all([
      multi.getInstance('browserA').dioxus.execute('return "A"'),
      multi.getInstance('browserB').dioxus.execute('return "B"'),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });
});
