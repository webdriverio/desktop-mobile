import { forEachMock } from './forEachMock.js';

export async function resetAllMocks(apiName?: string) {
  await forEachMock(apiName, (mock) => mock.mockReset());
}
