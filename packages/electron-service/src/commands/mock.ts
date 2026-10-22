import type { ElectronMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { createClassMock } from '../classMock.js';
import { createMock } from '../mock.js';
import mockStore from '../mockStore.js';

const log = createLogger('electron-service', 'mock');

interface ElectronServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
}

/**
 * Mock an Electron API method or class.
 *
 * When both apiName and funcName are provided, mocks a specific method.
 * When only apiName is provided (and it's a class like 'Tray'), returns a stub instance
 * with all methods mocked.
 *
 * @example
 * // Mock a method
 * const mockGetName = await browser.electron.mock('app', 'getName');
 *
 * // Mock a class
 * const mockTray = await browser.electron.mock('Tray');
 * expect(mockTray.setImage).toHaveBeenCalled();
 */
export async function mock(this: ElectronServiceContext, apiName: string, funcName?: string): Promise<ElectronMock> {
  const mockTarget = funcName ? `${apiName}.${funcName}` : apiName;
  log.debug(`[${mockTarget}] mock command called`);

  // Determine browser context
  let browserContext: WebdriverIO.Browser | undefined;
  if (
    this &&
    this.browser &&
    !('isMultiremote' in this.browser && this.browser.isMultiremote) &&
    this.browser.electron &&
    typeof this.browser.electron.execute === 'function'
  ) {
    browserContext = this.browser as WebdriverIO.Browser;
  } else if (
    globalThis.browser &&
    (globalThis.browser as WebdriverIO.Browser).electron &&
    typeof (globalThis.browser as WebdriverIO.Browser).electron.execute === 'function'
  ) {
    browserContext = globalThis.browser as WebdriverIO.Browser;
  } else if (globalThis.browser && !('isMultiremote' in globalThis.browser && globalThis.browser.isMultiremote)) {
    browserContext = globalThis.browser as WebdriverIO.Browser;
  } else if (this?.browser && !('isMultiremote' in this.browser && this.browser.isMultiremote)) {
    browserContext = this.browser as WebdriverIO.Browser;
  }

  // If no funcName, treat as class mock
  if (!funcName) {
    log.debug(`[${apiName}] Creating class mock`);
    // For class mocks, we don't cache in mockStore (each call creates fresh mocks)
    // This is because class mocks are more complex objects with multiple method mocks
    return createClassMock(apiName, browserContext);
  }

  // Method mocking (existing behavior)
  try {
    // retrieve an existing mock from the store
    const existingMock = mockStore.getMock(`electron.${apiName}.${funcName}`);
    log.debug(`[${apiName}.${funcName}] Found existing mock, resetting`);
    await existingMock.mockReset();
    return existingMock;
  } catch (_e) {
    // No existing mock, create a new one
    log.debug(`[${apiName}.${funcName}] No existing mock found, creating new mock`);
    const newMock = await createMock(apiName, funcName, browserContext);
    mockStore.setMock(newMock);
    return newMock;
  }
}
