import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { clearAllMocks } from '../../src/commands/clearAllMocks.js';
import { resetAllMocks } from '../../src/commands/resetAllMocks.js';
import { restoreAllMocks } from '../../src/commands/restoreAllMocks.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/mockStore.js', () => ({
  default: {
    getMocks: vi.fn(),
  },
}));

type MockApiMethod = { getMockName: () => string; [key: string]: ReturnType<typeof vi.fn> | (() => string) };

describe.each([
  { name: 'clearAllMocks', fn: clearAllMocks, mockMethod: 'mockClear' },
  { name: 'resetAllMocks', fn: resetAllMocks, mockMethod: 'mockReset' },
  { name: 'restoreAllMocks', fn: restoreAllMocks, mockMethod: 'mockRestore' },
] as const)('$name Command', ({ fn, mockMethod }) => {
  let mockedGetName: MockApiMethod;
  let mockedShowOpenDialog: MockApiMethod;

  beforeEach(() => {
    mockedGetName = {
      getMockName: () => 'electron.app.getName',
      [mockMethod]: vi.fn(),
    };
    mockedShowOpenDialog = {
      getMockName: () => 'electron.dialog.showOpenDialog',
      [mockMethod]: vi.fn(),
    };
    (mockStore.getMocks as Mock).mockReturnValue([
      ['electron.app.getName', mockedGetName],
      ['electron.dialog.showOpenDialog', mockedShowOpenDialog],
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should operate on all mock functions when no apiName is specified', async () => {
    await fn();
    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalled();
  });

  it('should operate only on mock functions for a specific API', async () => {
    await fn('app');
    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
    expect(mockedShowOpenDialog[mockMethod]).not.toHaveBeenCalled();
  });

  it('should keep going through the remaining mocks when one fails', async () => {
    (mockedGetName[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('app is gone'));

    await expect(fn()).resolves.toBeUndefined();

    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalled();
  });
});
