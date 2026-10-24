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

  it('should match the apiName as a literal prefix', async () => {
    await fn('dialog.show');
    await fn('a.p');
    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalledOnce();
    expect(mockedGetName[mockMethod]).not.toHaveBeenCalled();
  });

  it('should match a browser-mode channel by prefix and name it without its instance suffix', async () => {
    const browserModeMock = { getMockName: () => 'electron.get-user', [mockMethod]: vi.fn() };
    (browserModeMock[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('page closed'));
    (mockStore.getMocks as Mock).mockReturnValue([['electron.get-user\x000', browserModeMock]]);

    await expect(fn('get-')).rejects.toMatchObject({
      message: `${mockMethod} failed: electron.get-user: page closed`,
    });

    expect(browserModeMock[mockMethod]).toHaveBeenCalledOnce();
  });

  it('should attempt every mock and then report the one that failed', async () => {
    (mockedGetName[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('inner mock gone'));

    await expect(fn()).rejects.toMatchObject({
      message: `${mockMethod} failed: electron.app.getName: inner mock gone`,
    });

    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalled();
  });
});
