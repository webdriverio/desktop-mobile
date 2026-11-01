import { type ElectronServiceContext, forEachMock } from './forEachMock.js';

export async function restoreAllMocks(this: ElectronServiceContext | undefined, apiName?: string) {
  await forEachMock('restoreAllMocks', this, 'mockRestore', apiName);
}
