import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';
import { createDeeplinkHelpers, tauriDeeplinkEmitsInApp } from '../../../lib/deeplink.js';

declare global {
  var receivedDeeplinks: string[];
  var deeplinkCount: number;
}

type InstanceName = 'browserA' | 'browserB';

const opensThroughOs = !tauriDeeplinkEmitsInApp();

const root = () => multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
const instance = (name: InstanceName) => root().getInstance(name);
const deeplinksOf = (name: InstanceName) => instance(name).tauri.execute(() => globalThis.receivedDeeplinks);
const helpersOf = (name: InstanceName) =>
  createDeeplinkHelpers(
    () => instance(name).tauri,
    () => instance(name),
  );
const helpers = { browserA: helpersOf('browserA'), browserB: helpersOf('browserB') };

describe('Deeplinks in multiremote (tauri.triggerDeeplink)', () => {
  (opensThroughOs ? describe.skip : describe)('emitted in the app', () => {
    beforeEach(async () => {
      await Promise.all([helpers.browserA.clearDeeplinkState(), helpers.browserB.clearDeeplinkState()]);
    });

    afterEach(async () => {
      await Promise.all([helpers.browserA.waitForDeeplinkStability(), helpers.browserB.waitForDeeplinkStability()]);
    });

    for (const [target, other, url] of [
      ['browserA', 'browserB', 'testapp://mr-a'],
      ['browserB', 'browserA', 'testapp://mr-b'],
    ] as const) {
      it(`should deliver ${target}'s deeplink to ${target} only`, async () => {
        await instance(target).tauri.triggerDeeplink(url);
        await helpers[target].waitForDeeplink(1, `${target} did not receive its deeplink`);
        await helpers[other].waitForDeeplinkStability();

        expect(await deeplinksOf(target)).toEqual([url]);
        expect(await deeplinksOf(other)).toEqual([]);
      });
    }

    it("should deliver the root's deeplink to each instance once", async () => {
      await root().tauri.triggerDeeplink('testapp://mr-root');
      await Promise.all([
        helpers.browserA.waitForDeeplink(1, 'browserA did not receive the deeplink'),
        helpers.browserB.waitForDeeplink(1, 'browserB did not receive the deeplink'),
      ]);
      await Promise.all([helpers.browserA.waitForDeeplinkStability(), helpers.browserB.waitForDeeplinkStability()]);

      expect(await deeplinksOf('browserA')).toEqual(['testapp://mr-root']);
      expect(await deeplinksOf('browserB')).toEqual(['testapp://mr-root']);
    });
  });

  // Both instances run the same app, and the OS can't pick one of them.
  (opensThroughOs ? describe : describe.skip)('opened through the OS', () => {
    const refusal = /can't reach a multiremote instance/;

    it('should reject on an instance', async () => {
      await expect(instance('browserA').tauri.triggerDeeplink('testapp://mr-a')).rejects.toThrow(refusal);
    });

    it('should reject on the root', async () => {
      await expect(root().tauri.triggerDeeplink('testapp://mr-root')).rejects.toThrow(refusal);
    });
  });
});
