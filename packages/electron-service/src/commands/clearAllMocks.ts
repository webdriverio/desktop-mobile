import { forEachMock } from './forEachMock.js';

export async function clearAllMocks(apiName?: string) {
  await forEachMock(apiName, 'mockClear');
}
