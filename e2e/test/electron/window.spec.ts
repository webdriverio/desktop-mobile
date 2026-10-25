import { browser } from '@wdio/electron-service';
import { expect } from '@wdio/globals';
import { isMultiremote } from '@wdio/native-utils';

describe('application window tests', () => {
  it('should launch the application splash screen window', async () => {
    // Check if splash screen is enabled by checking for the switch button
    const switchButton = await browser.$('.switch-main-window');
    const hasSwitchButton = switchButton !== null;

    if (!hasSwitchButton) {
      // Splash is not enabled, verify we're on the main window
      await expect(browser).toHaveTitle(/Electron.*E2E Test App/);
      return;
    }

    // Splash is enabled, verify we're on splash screen
    if (isMultiremote(browser)) {
      const multi = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      const browserA = multi.getInstance('browserA');
      const browserB = multi.getInstance('browserB');
      await expect(browserA).toHaveTitle('Splash Screen');
      await expect(browserB).toHaveTitle('Splash Screen');
    } else {
      await expect(browser).toHaveTitle('Splash Screen');
    }
  });

  it('should switch to the application main window', async () => {
    // Check if splash screen is enabled (has switch button)
    const switchButton = await browser.$('.switch-main-window');
    const hasSwitchButton = switchButton !== null;

    if (!hasSwitchButton) {
      // Splash is not enabled, verify we're already on the main window
      const title = await browser.getTitle();
      expect(title).toMatch(/Electron.*E2E Test App/);
      return;
    }

    // Splash is enabled, click the switch button
    if (isMultiremote(browser)) {
      const multi = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      const browserA = multi.getInstance('browserA');
      const browserB = multi.getInstance('browserB');
      await (await browserA.$('.switch-main-window')).click();
      await (await browserB.$('.switch-main-window')).click();
      // Verify the app switched to main window with an Electron E2E test app title
      const titleA = await browserA.getTitle();
      const titleB = await browserB.getTitle();
      expect(titleA).toMatch(/Electron.*E2E Test App/);
      expect(titleB).toMatch(/Electron.*E2E Test App/);
    } else {
      const elem = await browser.$('.switch-main-window');
      await elem.click();
      await expect(browser).toHaveTitle(/Electron.*E2E Test App/);
    }
  });
});
