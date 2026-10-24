import type { ElectronFunctionMock } from '@wdio/native-types';
import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

export async function forEachMock(apiName: string | undefined, op: MockLifecycleOp): Promise<void> {
  // Only function mocks are stored: a class mock stores its constructor and method mocks individually.
  // Browser-mode keys end in `\x00<instanceId>`; drop it so no NUL reaches an error message.
  const mocks = (mockStore.getMocks() as Array<[string, ElectronFunctionMock]>).map(
    ([key, mock]) => [key.split('\x00')[0], mock] as const,
  );
  await runBulkMockOp(mocks, op, {
    matches: (name) => !apiName || name.startsWith(`electron.${apiName}`),
  });
}
