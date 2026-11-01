import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAll } from '../../src/commands/mockAll.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

// Bind to a minimal context to satisfy the `this: ElectronServiceContext` parameter
const callMockAll = mockAll.bind({});

describe('mockAll Command', () => {
  beforeEach(async () => {
    globalThis.browser = {
      electron: {
        execute: vi
          .fn()
          .mockReturnValue(
            'showOpenDialogSync,showOpenDialog,showSaveDialogSync,showSaveDialog,showMessageBoxSync,showMessageBox,showErrorBox,showCertificateTrustDialog',
          ),
      },
    } as unknown as WebdriverIO.Browser;
  });

  afterEach(() => {
    mockStore.clear();
    vi.resetAllMocks();
  });

  it('should throw when no browser context is available', async () => {
    delete (globalThis as { browser?: unknown }).browser;

    await expect(callMockAll('dialog')).rejects.toMatchObject({ message: 'mockAll requires a valid browser context' });
  });

  it("should mock every function in the calling multiremote instance's app only", async () => {
    const { root, browserA, browserB } = createFakeMultiremote();
    globalThis.browser = root as unknown as WebdriverIO.Browser;
    vi.mocked(browserA.electron.execute).mockResolvedValue('showOpenDialog,showMessageBox');

    const mocked = await mockAll.call({ browser: browserA }, 'dialog');

    expect(Object.keys(mocked)).toEqual(['showOpenDialog', 'showMessageBox']);
    expect(mockStore.getMocks(browserA).map(([name]) => name)).toEqual([
      'electron.dialog.showOpenDialog',
      'electron.dialog.showMessageBox',
    ]);
    expect(mockStore.getMocks(browserB)).toEqual([]);
    expect(browserB.electron.execute).not.toHaveBeenCalled();
    expect(root.electron.execute).not.toHaveBeenCalled();
  });

  it('should return mock functions for all API methods', async () => {
    const mockedDialog = await callMockAll('dialog');
    expect(mockedDialog).toStrictEqual({
      showOpenDialogSync: expect.anyMockFunction(),
      showOpenDialog: expect.anyMockFunction(),
      showSaveDialogSync: expect.anyMockFunction(),
      showSaveDialog: expect.anyMockFunction(),
      showMessageBoxSync: expect.anyMockFunction(),
      showMessageBox: expect.anyMockFunction(),
      showErrorBox: expect.anyMockFunction(),
      showCertificateTrustDialog: expect.anyMockFunction(),
    });
    // Verify they have mock properties
    expect(mockedDialog.showOpenDialog).toHaveProperty('mock');
    expect(mockedDialog.showOpenDialog).toHaveProperty('mockImplementation');
  });

  it('should call execute with the api name and internal flag', async () => {
    await callMockAll('dialog');
    expect(globalThis.browser.electron.execute).toHaveBeenCalledWith(expect.any(Function), 'dialog', {
      internal: true,
    });
  });

  it('should call the execute callback to extract keys from electron api', async () => {
    await callMockAll('dialog');
    const executeCallback = vi.mocked(globalThis.browser.electron.execute).mock.calls[0][0] as unknown as (
      electron: Record<string, Record<string, unknown>>,
      apiName: string,
    ) => string;
    const fakeElectron = { dialog: { foo: 1, bar: 2 } };
    expect(executeCallback(fakeElectron, 'dialog')).toBe('foo,bar');
  });
});
