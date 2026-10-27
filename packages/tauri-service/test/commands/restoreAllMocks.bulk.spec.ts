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

  it('should make one in-app execute for N browser-mode mocks when the bulk clear succeeds', async () => {
    const browserMode = { execute: executeInApp, __wdioBrowserMode__: true } as unknown as WebdriverIO.Browser;
    globalThis.browser = browserMode;
    mockStore.setMock(await createMock('read_clipboard', browserMode));
    mockStore.setMock(await createMock('write_clipboard', browserMode));
    executeInApp.mockClear();

    await restoreAllMocks();

    expect(executeInApp).toHaveBeenCalledOnce();
    expect(mockStore.getMocks()).toEqual([]);
  });

  it("should still unregister another multiremote instance's mock in that instance's app", async () => {
    const otherInstance = { execute: vi.fn(async () => undefined) } as unknown as WebdriverIO.Browser;
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', otherInstance));
    vi.mocked(execute).mockClear();

    await restoreAllMocks();

    expect(executeInApp).toHaveBeenCalledOnce();
    expect(vi.mocked(execute).mock.calls.map(([target]) => target)).toEqual([otherInstance]);
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
