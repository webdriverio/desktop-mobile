import { type ElectronServiceContext, forEachMock } from './forEachMock.js';

export async function resetAllMocks(this: ElectronServiceContext | undefined, apiName?: string) {
  await forEachMock('resetAllMocks', this, 'mockReset', apiName);
}
