import { expect, multiremotebrowser } from '@wdio/globals';

describe('Dioxus multiremote API', () => {
  it('should execute in both instances', async () => {
    const [a, b] = await Promise.all([
      (multiremotebrowser as unknown as { browserA: WebdriverIO.Browser }).browserA.dioxus.execute('return "A"'),
      (multiremotebrowser as unknown as { browserB: WebdriverIO.Browser }).browserB.dioxus.execute('return "B"'),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });
});
