import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../../src/commands/execute.js';
import { restoreAllMocks } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/commands/execute.js', () => ({
  execute: vi.fn(async () => undefined),
}));

function unregistrationTargets() {
  return vi
    .mocked(execute)
    .mock.calls.filter(([, script]) => String(script).includes('delete window.__wdio_mocks__'))
    .map(([target]) => target);
}

describe('restoreAllMocks in-app calls', () => {
  const browserExecute = vi.fn(async () => undefined);
  const browser = { execute: browserExecute } as unknown as WebdriverIO.Browser;

  beforeEach(() => {
    globalThis.browser = browser;
    vi.mocked(execute).mockClear();
    browserExecute.mockReset();
    browserExecute.mockResolvedValue(undefined);
    mockStore.clear();
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
});
