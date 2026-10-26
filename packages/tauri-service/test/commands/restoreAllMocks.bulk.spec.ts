import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../../src/commands/execute.js';
import { restoreAllMocks } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/commands/execute.js', () => ({
  execute: vi.fn(async () => undefined),
}));

describe('restoreAllMocks in-app round-trips', () => {
  const executeInApp = vi.fn(async () => undefined);
  const browser = { execute: executeInApp } as unknown as WebdriverIO.Browser;

  beforeEach(() => {
    globalThis.browser = browser;
    vi.mocked(execute).mockClear();
    executeInApp.mockReset();
    executeInApp.mockResolvedValue(undefined);
    mockStore.clear();
  });

  afterEach(() => {
    mockStore.clear();
    delete (globalThis as { browser?: WebdriverIO.Browser }).browser;
  });

  it('should make one in-app execute for N mocks when the bulk clear succeeds', async () => {
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', browser));
    const registrations = vi.mocked(execute).mock.calls.length;

    await restoreAllMocks();

    expect(executeInApp).toHaveBeenCalledOnce();
    expect(vi.mocked(execute).mock.calls.length).toBe(registrations);
    expect(mockStore.getMocks()).toEqual([]);
  });

  it('should unregister each mock when the bulk clear fails', async () => {
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', browser));
    const registrations = vi.mocked(execute).mock.calls.length;
    executeInApp.mockRejectedValueOnce(new Error('script error'));

    await expect(restoreAllMocks()).rejects.toMatchObject({
      message: expect.stringContaining('all mocks (in-app): script error'),
    });

    expect(vi.mocked(execute).mock.calls.length).toBe(registrations + 2);
  });
});
