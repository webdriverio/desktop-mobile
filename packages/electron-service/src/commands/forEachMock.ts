import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

export async function forEachMock(apiName: string | undefined, op: MockLifecycleOp): Promise<void> {
  // Browser-mode keys add `\x00<instanceId>` after the mock name. Strip it so error messages show only the name.
  const mocks = mockStore.getMocks().map(([key, mock]) => [key.split('\x00')[0], mock] as const);
  await runBulkMockOp(mocks, op, {
    matches: (name) => !apiName || name.startsWith(`electron.${apiName}`),
  });
}
