import { type ElectronServiceContext, forEachMock } from './forEachMock.js';

export async function clearAllMocks(this: ElectronServiceContext | undefined, apiName?: string) {
  await forEachMock('clearAllMocks', this, 'mockClear', apiName);
}
