import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';
import { createDeeplinkHelpers } from '../../../lib/deeplink.js';

declare global {
  var receivedDeeplinks: string[];
  var deeplinkCount: number;
}

type InstanceName = 'browserA' | 'browserB';

const isMacOS = process.platform === 'darwin';
// Protocol handlers need the packaged app.
const canTargetInstances = process.env.BINARY !== 'false' && !isMacOS;

const root = () => multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
const instance = (name: InstanceName) => root().getInstance(name);
const deeplinksOf = (name: InstanceName) => instance(name).electron.execute(() => globalThis.receivedDeeplinks);
const helpersOf = (name: InstanceName) =>
  createDeeplinkHelpers(
    () => instance(name).electron,
    () => instance(name),
  );
const helpers = { browserA: helpersOf('browserA'), browserB: helpersOf('browserB') };

(canTargetInstances ? describe : describe.skip)('Deeplinks in multiremote (electron.triggerDeeplink)', () => {
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
      await instance(target).electron.triggerDeeplink(url);
      await helpers[target].waitForDeeplink(1, `${target} did not receive its deeplink`);
      await helpers[other].waitForDeeplinkStability();

      expect(await deeplinksOf(target)).toEqual([url]);
      expect(await deeplinksOf(other)).toEqual([]);
    });
  }

  it("should deliver the root's deeplink to each instance once", async () => {
    await root().electron.triggerDeeplink('testapp://mr-root');
    await Promise.all([
      helpers.browserA.waitForDeeplink(1, 'browserA did not receive the deeplink'),
      helpers.browserB.waitForDeeplink(1, 'browserB did not receive the deeplink'),
    ]);
    await Promise.all([helpers.browserA.waitForDeeplinkStability(), helpers.browserB.waitForDeeplinkStability()]);

    expect(await deeplinksOf('browserA')).toEqual(['testapp://mr-root']);
    expect(await deeplinksOf('browserB')).toEqual(['testapp://mr-root']);
  });
});

// Both instances run the same app, and `open` can't pick one of them.
(isMacOS ? describe : describe.skip)('Deeplinks in multiremote on macOS (electron.triggerDeeplink)', () => {
  const refusal = /can't reach a multiremote instance on macOS/;

  it('should reject on an instance', async () => {
    await expect(instance('browserA').electron.triggerDeeplink('testapp://mr-a')).rejects.toThrow(refusal);
  });

  it('should reject on the root', async () => {
    await expect(root().electron.triggerDeeplink('testapp://mr-root')).rejects.toThrow(refusal);
  });
});
