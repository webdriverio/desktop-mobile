import type { TauriMock } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../../src/commands/execute.js';
import { restoreAllMocks } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/commands/execute.js', () => ({
  execute: vi.fn(async () => undefined),
}));

function addFakeMock(command: string) {
  const mockRestore = vi.fn(async () => undefined);
  mockStore.setMock({ getMockName: () => `tauri.${command}`, mockRestore } as unknown as TauriMock);
  return mockRestore;
}

function unregistrationTargets() {
  return vi
    .mocked(execute)
    .mock.calls.filter(([, script]) => String(script).includes('delete window.__wdio_mocks__'))
    .map(([target]) => target);
}

describe('restoreAllMocks Command', () => {
  const browserExecute = vi.fn(async () => undefined);
  const browser = { execute: browserExecute } as unknown as WebdriverIO.Browser;

  beforeEach(() => {
    globalThis.browser = browser;
    mockStore.clear();
    vi.mocked(execute).mockClear();
    browserExecute.mockClear();
  });

  afterEach(() => {
    mockStore.clear();
    delete (globalThis as { browser?: WebdriverIO.Browser }).browser;
  });

  it('should unregister each mock through the route it was registered by, with no bulk call', async () => {
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', browser));

    await restoreAllMocks();

    expect(unregistrationTargets()).toEqual([browser, browser]);
    expect(browserExecute).not.toHaveBeenCalled();
    expect(mockStore.getMocks()).toEqual([]);
  });

  it("should unregister another multiremote instance's mock in that instance's app", async () => {
    const otherInstance = { execute: vi.fn(async () => undefined) } as unknown as WebdriverIO.Browser;
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', otherInstance));

    await restoreAllMocks();

    expect(unregistrationTargets()).toEqual([browser, otherInstance]);
    expect(mockStore.getMocks()).toEqual([]);
  });

  it('should unregister and drop only the mocks matching the prefix', async () => {
    mockStore.setMock(await createMock('read_clipboard', browser));
    mockStore.setMock(await createMock('write_clipboard', browser));
    vi.mocked(execute).mockClear();

    await restoreAllMocks('read');

    expect(unregistrationTargets()).toEqual([browser]);
    expect(vi.mocked(execute).mock.calls[0][1]).toContain('"read_clipboard"');
    expect(mockStore.getMocks().map(([name]) => name)).toEqual(['tauri.write_clipboard']);
  });

  it('should unregister each browser-mode mock in the page', async () => {
    const browserMode = { execute: browserExecute, __wdioBrowserMode__: true } as unknown as WebdriverIO.Browser;
    globalThis.browser = browserMode;
    mockStore.setMock(await createMock('read_clipboard', browserMode));
    mockStore.setMock(await createMock('write_clipboard', browserMode));
    browserExecute.mockClear();

    await restoreAllMocks();

    expect(browserExecute).toHaveBeenCalledTimes(2);
    expect(mockStore.getMocks()).toEqual([]);
  });

  it('should handle a prefix that matches no mocks', async () => {
    const restoreRead = addFakeMock('read_clipboard');

    await restoreAllMocks('nonexistent');

    expect(restoreRead).not.toHaveBeenCalled();
  });

  it('should attempt every mock and then report the one whose mockRestore failed', async () => {
    const restorePlatform = addFakeMock('get_platform_info');
    const restoreRead = addFakeMock('read_clipboard');
    restorePlatform.mockRejectedValue(new Error('inner mock gone'));

    await expect(restoreAllMocks()).rejects.toMatchObject({
      message: 'mockRestore failed: tauri.get_platform_info: inner mock gone',
    });

    expect(restoreRead).toHaveBeenCalled();
  });

  it('should restore every mock without a browser context', async () => {
    const restoreRead = addFakeMock('read_clipboard');
    delete (globalThis as { browser?: WebdriverIO.Browser }).browser;

    await restoreAllMocks.call({});

    expect(restoreRead).toHaveBeenCalled();
  });

  it('should restore every mock when called on the multiremote browser', async () => {
    const restoreRead = addFakeMock('read_clipboard');
    const multiremoteBrowser = { isMultiremote: true, execute: vi.fn() } as unknown as WebdriverIO.MultiRemoteBrowser;

    await restoreAllMocks.call({ browser: multiremoteBrowser });

    expect(restoreRead).toHaveBeenCalled();
  });
});
