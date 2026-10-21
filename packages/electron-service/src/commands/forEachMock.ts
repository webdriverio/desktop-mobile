import type { ElectronFunctionMock } from '@wdio/native-types';
import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

export async function forEachMock(apiName: string | undefined, op: MockLifecycleOp): Promise<void> {
  const base = apiName?.endsWith('.') ? apiName.slice(0, -1) : apiName;
  // Only function mocks are stored: a class mock stores its constructor and method mocks individually.
  // Browser-mode keys end in `\x00<instanceId>`; dropping it ends the name there and keeps NUL out of errors.
  const mocks = (mockStore.getMocks() as Array<[string, ElectronFunctionMock]>).map(
    ([key, mock]) => [key.split('\x00')[0], mock] as const,
  );
  await runBulkMockOp(mocks, op, {
    matches: (name) => !base || name === `electron.${base}` || name.startsWith(`electron.${base}.`),
  });
}
