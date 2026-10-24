import type { ElectronFunctionMock } from '@wdio/native-types';
import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

export async function forEachMock(apiName: string | undefined, op: MockLifecycleOp): Promise<void> {
  // Only function mocks are stored: a class mock stores its constructor and method mocks individually.
  // Browser-mode keys add `\x00<instanceId>` after the mock name. Strip it so error messages show only the name.
  const mocks = (mockStore.getMocks() as Array<[string, ElectronFunctionMock]>).map(
    ([key, mock]) => [key.split('\x00')[0], mock] as const,
  );
  await runBulkMockOp(mocks, op, {
    matches: (name) => !apiName || name.startsWith(`electron.${apiName}`),
  });
}
