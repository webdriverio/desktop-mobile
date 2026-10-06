import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

describe('Tauri Multiremote - Advanced Patterns', () => {
  it('should execute commands on the targeted instance', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    const [argsA, argsB] = (await Promise.all([
      browserA.tauri.execute(({ core }) => core.invoke('get_command_line_args')),
      browserB.tauri.execute(({ core }) => core.invoke('get_command_line_args')),
    ])) as [string[], string[]];

    // endsWith: on Windows msedgedriver may re-prefix args as Chrome switches
    expect(argsA.some((arg) => arg.endsWith('browser=A'))).toBe(true);
    expect(argsB.some((arg) => arg.endsWith('browser=B'))).toBe(true);
  });

  it('should handle sequential execution in multiremote', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Sequential execution - get timestamps to verify order
    const resultA = (await browserA.tauri.execute(() => Date.now())) as number;
    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 100));
    const resultB = (await browserB.tauri.execute(() => Date.now())) as number;

    // ResultB should be after resultA
    expect(resultB).toBeGreaterThan(resultA);

    // Both should be valid timestamps (within last 10 seconds)
    const now = Date.now();
    expect(now - resultA).toBeLessThan(10000);
    expect(now - resultB).toBeLessThan(10000);
  });
});
