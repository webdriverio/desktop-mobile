import { forEachMock } from './forEachMock.js';

export async function restoreAllMocks(apiName?: string) {
  await forEachMock(apiName, 'mockRestore');
}
