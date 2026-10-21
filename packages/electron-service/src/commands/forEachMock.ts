import type { ElectronMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

const log = createLogger('electron-service', 'mock');

export async function forEachMock(apiName: string | undefined, fn: (mock: ElectronMock) => unknown): Promise<void> {
  for (const [mockName, mock] of mockStore.getMocks()) {
    if (!apiName || mockName.match(new RegExp(`^electron.${apiName}`))) {
      // A mock's app round-trip fails once the app or connection is gone; that must not leave
      // the remaining mocks untouched.
      try {
        await fn(mock);
      } catch (error) {
        log.warn(`bulk mock op failed for '${mockName}', continuing: ${(error as Error).message}`);
      }
    }
  }
}
