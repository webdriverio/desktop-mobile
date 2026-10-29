import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

function assertHasOwnProperty<Property extends PropertyKey>(
  value: unknown,
  property: Property,
): asserts value is Record<Property, unknown> {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, property)) {
    throw new Error(`Expected property ${String(property)} to exist on value`);
  }
}

describe('Tauri APIs using Multiremote', () => {
  it('should retrieve platform info through the Tauri API on multiple instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Service already ensures readiness via waitUntilWindowAvailable in before() hook
    // No need for additional readiness checks

    const [resultA, resultB] = await Promise.all([
      browserA.tauri.execute(({ core }) => core.invoke('get_platform_info')),
      browserB.tauri.execute(({ core }) => core.invoke('get_platform_info')),
    ]);
    assertHasOwnProperty(resultA, 'os');
    assertHasOwnProperty(resultB, 'os');
    assertHasOwnProperty(resultA, 'arch');
    assertHasOwnProperty(resultB, 'arch');
    expect(resultA.os).toBe(resultB.os); // Same OS for both instances
  });

  it('should execute commands independently on multiple instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Both instances should be able to execute concurrently without interference
    const [resultA, resultB] = await Promise.all([
      browserA.tauri.execute(({ core }) => core.invoke('get_platform_info')),
      browserB.tauri.execute(({ core }) => core.invoke('get_platform_info')),
    ]);

    assertHasOwnProperty(resultA, 'hostname');
    assertHasOwnProperty(resultB, 'hostname');
    assertHasOwnProperty(resultA, 'memory');
    assertHasOwnProperty(resultB, 'memory');

    // Verify instances can operate independently by checking they have unique hostnames
    // (or at least that both queries succeeded independently)
    expect(typeof resultA.hostname).toBe('string');
    expect(typeof resultB.hostname).toBe('string');
  });

  describe('emitEvent', () => {
    type EventTestGlobals = {
      __wdioEvents?: unknown[];
      __wdioUnlisten?: () => Promise<void>;
      __TAURI__: {
        event: {
          listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => Promise<void>>;
        };
      };
    };

    const instances = () => {
      const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
      return [multi.getInstance('browserA'), multi.getInstance('browserB')];
    };

    afterEach(async () => {
      await Promise.all(
        instances().map((instance) =>
          instance.tauri.execute(async () => {
            const g = globalThis as unknown as EventTestGlobals;
            const unlisten = g.__wdioUnlisten;
            g.__wdioUnlisten = undefined;
            await unlisten?.();
          }),
        ),
      );
    });

    it('should emit on every instance when called on the root', async () => {
      await Promise.all(
        instances().map((instance) =>
          instance.tauri.execute(async () => {
            const g = globalThis as unknown as EventTestGlobals;
            await g.__wdioUnlisten?.();
            g.__wdioEvents = [];
            g.__wdioUnlisten = await g.__TAURI__.event.listen('wdio:test-emit-root', (e) => {
              g.__wdioEvents?.push(e.payload);
            });
          }),
        ),
      );

      await (multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser).tauri.emitEvent('wdio:test-emit-root', {
        from: 'root',
      });

      for (const instance of instances()) {
        const receivedEvents = () =>
          instance.tauri.execute(() => (globalThis as unknown as EventTestGlobals).__wdioEvents ?? []);
        await instance.waitUntil(async () => (await receivedEvents()).length > 0, {
          timeout: 5000,
          timeoutMsg: 'expected each instance to receive the root emit',
        });
        expect(await receivedEvents()).toEqual([{ from: 'root' }]);
      }
    });
  });
});
