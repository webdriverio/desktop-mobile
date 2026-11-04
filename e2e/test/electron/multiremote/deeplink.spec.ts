import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';
import { createDeeplinkHelpers } from '../../../lib/deeplink.js';

declare global {
  var receivedDeeplinks: string[];
  var deeplinkCount: number;
}

type InstanceName = 'browserA' | 'browserB';

// Protocol handlers need the packaged app. On macOS the URL goes through `open`, which can't pick an instance.
const canTargetInstances =
  process.env.BINARY !== 'false' &&
  process.platform !== 'darwin' &&
  // Workaround for webdriverio/webdriverio#16242; drop once a release with it is in the catalog
  process.platform !== 'win32';

const root = () => multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
const instance = (name: InstanceName) => root().getInstance(name);
const deeplinksOf = (name: InstanceName) => instance(name).electron.execute(() => globalThis.receivedDeeplinks);
const helpers = {
  browserA: createDeeplinkHelpers(() => instance('browserA').electron),
  browserB: createDeeplinkHelpers(() => instance('browserB').electron),
};

(canTargetInstances ? describe : describe.skip)('Deeplinks in multiremote (electron.triggerDeeplink)', () => {
  beforeEach(async () => {
    await helpers.browserA.clearDeeplinkState();
    await helpers.browserB.clearDeeplinkState();
  });

  afterEach(async () => {
    await helpers.browserA.waitForDeeplinkStability();
    await helpers.browserB.waitForDeeplinkStability();
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
    await helpers.browserA.waitForDeeplink(1, 'browserA did not receive the deeplink');
    await helpers.browserB.waitForDeeplink(1, 'browserB did not receive the deeplink');
    await helpers.browserA.waitForDeeplinkStability();
    await helpers.browserB.waitForDeeplinkStability();

    expect(await deeplinksOf('browserA')).toEqual(['testapp://mr-root']);
    expect(await deeplinksOf('browserB')).toEqual(['testapp://mr-root']);
  });
});
