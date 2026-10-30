import type { Mock } from '@vitest/spy';
import { browser } from '@wdio/electron-service';
import { $, expect } from '@wdio/globals';

// Check if we're running in script mode
const isBinary = process.env.BINARY !== 'false';

// Helper function to get the expected app name from globalThis.packageJson
const getExpectedAppName = (): string => {
  // If running in binary mode, use the package name from globalThis
  if (isBinary && globalThis.packageJson?.name) {
    return globalThis.packageJson.name;
  }
  // In script mode, the app name will always be "Electron"
  return 'Electron';
};

describe('Electron Mocking', () => {
  beforeEach(async () => {
    // Reset app name to original value to ensure test isolation
    const expectedName = getExpectedAppName();
    await browser.electron.execute((electron, appName) => electron.app.setName(appName), expectedName);
  });

  describe('Basic Mocking', () => {
    describe('mock function', () => {
      it('should mock an electron API function', async () => {
        const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
        // Mock return value to prevent real dialog from appearing
        await mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await browser.electron.execute(async (electron) => {
          await electron.dialog.showOpenDialog({
            title: 'my dialog',
            properties: ['openFile', 'openDirectory'],
          });
          return (electron.dialog.showOpenDialog as Mock).mock.calls;
        });

        expect(mockShowOpenDialog).toHaveBeenCalledTimes(1);
        expect(mockShowOpenDialog).toHaveBeenCalledWith({
          title: 'my dialog',
          properties: ['openFile', 'openDirectory'],
        });
      });

      it('should mock a synchronous electron API function', async () => {
        const mockShowOpenDialogSync = await browser.electron.mock('dialog', 'showOpenDialogSync');
        // Mock return value to prevent real dialog from appearing
        await mockShowOpenDialogSync.mockReturnValue([]);

        await browser.electron.execute((electron) =>
          electron.dialog.showOpenDialogSync({
            title: 'my dialog',
            properties: ['openFile', 'openDirectory'],
          }),
        );

        expect(mockShowOpenDialogSync).toHaveBeenCalledTimes(1);
        expect(mockShowOpenDialogSync).toHaveBeenCalledWith({
          title: 'my dialog',
          properties: ['openFile', 'openDirectory'],
        });
      });

      it('should handle multiple calls to the same mock', async () => {
        const mockGetName = await browser.electron.mock('app', 'getName');
        await mockGetName.mockReturnValue('mocked name');

        // Multiple calls
        const results = await browser.electron.execute((electron) => [
          electron.app.getName(),
          electron.app.getName(),
          electron.app.getName(),
        ]);

        expect(results).toStrictEqual(['mocked name', 'mocked name', 'mocked name']);
        expect(mockGetName).toHaveBeenCalledTimes(3);
      });

      it('should reuse existing mock when called multiple times', async () => {
        const mock1 = await browser.electron.mock('app', 'getName');
        const mock2 = await browser.electron.mock('app', 'getName');

        // Should be the same mock instance
        expect(mock1).toBe(mock2);

        await mock1.mockReturnValue('shared mock');
        const result = await browser.electron.execute((electron) => electron.app.getName());
        expect(result).toBe('shared mock');
      });
    });

    describe('mockAll', () => {
      it('should mock all functions on an API', async () => {
        const mockedDialog = await browser.electron.mockAll('dialog');
        // Mock return values to prevent real dialogs from appearing
        await mockedDialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
        await mockedDialog.showOpenDialogSync.mockReturnValue([]);

        await browser.electron.execute(
          async (electron) =>
            await electron.dialog.showOpenDialog({
              title: 'my dialog',
            }),
        );
        await browser.electron.execute((electron) =>
          electron.dialog.showOpenDialogSync({
            title: 'my dialog',
          }),
        );

        expect(mockedDialog.showOpenDialog).toHaveBeenCalledTimes(1);
        expect(mockedDialog.showOpenDialog).toHaveBeenCalledWith({
          title: 'my dialog',
        });
        expect(mockedDialog.showOpenDialogSync).toHaveBeenCalledTimes(1);
        expect(mockedDialog.showOpenDialogSync).toHaveBeenCalledWith({
          title: 'my dialog',
        });
      });
    });

    describe('Mock Management', () => {
      describe('clearAllMocks', () => {
        it('should clear existing mocks', async () => {
          const mockSetName = await browser.electron.mock('app', 'setName');
          const mockWriteText = await browser.electron.mock('clipboard', 'writeText');

          await browser.electron.execute((electron) => electron.app.setName('new app name'));
          await browser.electron.execute((electron) => electron.clipboard.writeText('text to be written'));

          await browser.electron.clearAllMocks();

          expect(mockSetName.mock.calls).toStrictEqual([]);
          expect(mockSetName.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockSetName.mock.lastCall).toBeUndefined();
          expect(mockSetName.mock.results).toStrictEqual([]);

          expect(mockWriteText.mock.calls).toStrictEqual([]);
          expect(mockWriteText.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockWriteText.mock.lastCall).toBeUndefined();
          expect(mockWriteText.mock.results).toStrictEqual([]);
        });

        it('should clear existing mocks on an API', async () => {
          const mockSetName = await browser.electron.mock('app', 'setName');
          const mockWriteText = await browser.electron.mock('clipboard', 'writeText');

          await browser.electron.execute((electron) => electron.app.setName('new app name'));
          await browser.electron.execute((electron) => electron.clipboard.writeText('text to be written'));

          await browser.electron.clearAllMocks('app');

          expect(mockSetName.mock.calls).toStrictEqual([]);
          expect(mockSetName.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockSetName.mock.lastCall).toBeUndefined();
          expect(mockSetName.mock.results).toStrictEqual([]);

          expect(mockWriteText.mock.calls).toStrictEqual([['text to be written']]);
          expect(mockWriteText.mock.invocationCallOrder).toStrictEqual([expect.any(Number)]);
          expect(mockWriteText.mock.lastCall).toStrictEqual(['text to be written']);
          expect(mockWriteText.mock.results).toStrictEqual([{ type: 'return', value: undefined }]);
        });

        it('should not reset existing mocks', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.clearAllMocks();

          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBe('mocked appName');
          expect(clipboardText).toBe('mocked clipboardText');
        });

        it('should not reset existing mocks on an API', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.clearAllMocks('app');

          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBe('mocked appName');
          expect(clipboardText).toBe('mocked clipboardText');
        });
      });

      describe('resetAllMocks', () => {
        it('should clear existing mocks', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.execute((electron) => electron.app.getName());
          await browser.electron.execute((electron) => electron.clipboard.readText());

          await browser.electron.resetAllMocks();

          expect(mockGetName.mock.calls).toStrictEqual([]);
          expect(mockGetName.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockGetName.mock.lastCall).toBeUndefined();
          expect(mockGetName.mock.results).toStrictEqual([]);

          expect(mockReadText.mock.calls).toStrictEqual([]);
          expect(mockReadText.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockReadText.mock.lastCall).toBeUndefined();
          expect(mockReadText.mock.results).toStrictEqual([]);
        });

        it('should clear existing mocks on an API', async () => {
          const mockSetName = await browser.electron.mock('app', 'setName');
          const mockWriteText = await browser.electron.mock('clipboard', 'writeText');

          await browser.electron.execute((electron) => electron.app.setName('new app name'));
          await browser.electron.execute((electron) => electron.clipboard.writeText('text to be written'));

          await browser.electron.resetAllMocks('app');

          expect(mockSetName.mock.calls).toStrictEqual([]);
          expect(mockSetName.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockSetName.mock.lastCall).toBeUndefined();
          expect(mockSetName.mock.results).toStrictEqual([]);

          expect(mockWriteText.mock.calls).toStrictEqual([['text to be written']]);
          expect(mockWriteText.mock.invocationCallOrder).toStrictEqual([expect.any(Number)]);
          expect(mockWriteText.mock.lastCall).toStrictEqual(['text to be written']);
          expect(mockWriteText.mock.results).toStrictEqual([{ type: 'return', value: undefined }]);
        });

        it('should reset existing mocks', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.resetAllMocks();

          // After reset, mocks return undefined (Vitest v4 behavior)
          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBeUndefined();
          expect(clipboardText).toBeUndefined();
        });

        it('should reset existing mocks on an API', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.resetAllMocks('app');

          // App mock reset to undefined, clipboard mock unchanged (Vitest v4 behavior)
          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBeUndefined();
          expect(clipboardText).toBe('mocked clipboardText');
        });
      });

      describe('restoreAllMocks', () => {
        beforeEach(async () => {
          await browser.electron.execute((electron) => {
            electron.clipboard.clear();
            electron.clipboard.writeText('some real clipboard text');
          });
        });

        it('should restore existing mocks', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.restoreAllMocks();

          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBe(getExpectedAppName());
          expect(clipboardText).toBe('some real clipboard text');
        });

        it('should restore existing mocks on an API', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockReadText = await browser.electron.mock('clipboard', 'readText');
          await mockGetName.mockReturnValue('mocked appName');
          await mockReadText.mockReturnValue('mocked clipboardText');

          await browser.electron.restoreAllMocks('app');

          const appName = await browser.electron.execute((electron) => electron.app.getName());
          const clipboardText = await browser.electron.execute((electron) => electron.clipboard.readText());
          expect(appName).toBe(getExpectedAppName());
          expect(clipboardText).toBe('mocked clipboardText');
        });
      });

      describe('isMockFunction', () => {
        it('should return true when provided with an electron mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');

          expect(browser.electron.isMockFunction(mockGetName)).toBe(true);
        });

        it('should return false when provided with a function', async () => {
          expect(
            browser.electron.isMockFunction(() => {
              // no-op
            }),
          ).toBe(false);
        });

        it('should return false when provided with a vitest mock', async () => {
          // We have to dynamic import `@vitest/spy` due to it being an ESM only module
          const spy = await import('@vitest/spy');
          expect(browser.electron.isMockFunction(spy.fn())).toBe(false);
        });
      });
    });

    describe('Mock Object Methods', () => {
      describe('mockImplementation', () => {
        it('should use the specified implementation for an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          let callsCount = 0;
          await mockGetName.mockImplementation(() => {
            // callsCount is not accessible in the electron context so we need to guard it
            if (typeof callsCount !== 'undefined') {
              callsCount++;
            }

            return 'mocked value';
          });
          const result = await browser.electron.execute(async (electron) => await electron.app.getName());

          expect(callsCount).toBe(1);
          expect(result).toBe('mocked value');
        });
      });

      describe('mockImplementationOnce', () => {
        it('should use the specified implementation for an existing mock once', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');

          await mockGetName.mockImplementation(() => 'default mocked name');
          await mockGetName.mockImplementationOnce(() => 'first mocked name');
          await mockGetName.mockImplementationOnce(() => 'second mocked name');
          await mockGetName.mockImplementationOnce(() => 'third mocked name');

          let name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('first mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('second mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('third mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('default mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('default mocked name');
        });
      });

      describe('mockReturnValue', () => {
        it('should return the specified value from an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockReturnValue('This is a mock');

          const electronName = await browser.electron.execute((electron) => electron.app.getName());

          expect(electronName).toBe('This is a mock');
        });
      });

      describe('mockReturnValueOnce', () => {
        it('should return the specified value from an existing mock once', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');

          await mockGetName.mockReturnValue('default mocked name');
          await mockGetName.mockReturnValueOnce('first mocked name');
          await mockGetName.mockReturnValueOnce('second mocked name');
          await mockGetName.mockReturnValueOnce('third mocked name');

          let name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('first mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('second mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('third mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('default mocked name');
          name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('default mocked name');
        });
      });

      describe('mockResolvedValue', () => {
        it('should resolve with the specified value from an existing mock', async () => {
          const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');
          await mockGetFileIcon.mockResolvedValue('This is a mock');

          const fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );

          expect(fileIcon).toBe('This is a mock');
        });
      });

      describe('mockResolvedValueOnce', () => {
        it('should resolve with the specified value from an existing mock once', async () => {
          const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');

          await mockGetFileIcon.mockResolvedValue('default mocked icon');
          await mockGetFileIcon.mockResolvedValueOnce('first mocked icon');
          await mockGetFileIcon.mockResolvedValueOnce('second mocked icon');
          await mockGetFileIcon.mockResolvedValueOnce('third mocked icon');

          let fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );
          expect(fileIcon).toBe('first mocked icon');
          fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );
          expect(fileIcon).toBe('second mocked icon');
          fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );
          expect(fileIcon).toBe('third mocked icon');
          fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );
          expect(fileIcon).toBe('default mocked icon');
          fileIcon = await browser.electron.execute(
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );
          expect(fileIcon).toBe('default mocked icon');
        });
      });

      describe('mockRejectedValue', () => {
        it('should reject with the specified value from an existing mock', async () => {
          const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');
          await mockGetFileIcon.mockRejectedValue('This is a mock error');

          const fileIconError = await browser.electron.execute(async (electron) => {
            try {
              return await electron.app.getFileIcon('/path/to/icon');
            } catch (e) {
              return e;
            }
          });

          expect(fileIconError).toBe('This is a mock error');
        });
      });

      describe('mockRejectedValueOnce', () => {
        it('should reject with the specified value from an existing mock once', async () => {
          const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');

          await mockGetFileIcon.mockRejectedValue('default mocked icon error');
          await mockGetFileIcon.mockRejectedValueOnce('first mocked icon error');
          await mockGetFileIcon.mockRejectedValueOnce('second mocked icon error');
          await mockGetFileIcon.mockRejectedValueOnce('third mocked icon error');

          const getFileIcon = async () =>
            await browser.electron.execute(async (electron) => {
              try {
                return await electron.app.getFileIcon('/path/to/icon');
              } catch (e) {
                return e;
              }
            });

          let fileIcon = await getFileIcon();
          expect(fileIcon).toBe('first mocked icon error');
          fileIcon = await getFileIcon();
          expect(fileIcon).toBe('second mocked icon error');
          fileIcon = await getFileIcon();
          expect(fileIcon).toBe('third mocked icon error');
          fileIcon = await getFileIcon();
          expect(fileIcon).toBe('default mocked icon error');
          fileIcon = await getFileIcon();
          expect(fileIcon).toBe('default mocked icon error');
        });
      });

      describe('mockClear', () => {
        it('should clear an existing mock', async () => {
          const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
          await mockShowOpenDialog.mockReturnValue('mocked name');

          await browser.electron.execute((electron) => electron.dialog.showOpenDialog({}));
          await browser.electron.execute((electron) =>
            electron.dialog.showOpenDialog({
              title: 'my dialog',
            }),
          );
          await browser.electron.execute((electron) =>
            electron.dialog.showOpenDialog({
              title: 'another dialog',
            }),
          );

          await mockShowOpenDialog.mockClear();

          expect(mockShowOpenDialog.mock.calls).toStrictEqual([]);
          expect(mockShowOpenDialog.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockShowOpenDialog.mock.lastCall).toBeUndefined();
          expect(mockShowOpenDialog.mock.results).toStrictEqual([]);
        });
      });

      describe('mockReset', () => {
        it('should reset the implementation of an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockReturnValue('mocked name');

          await mockGetName.mockReset();

          // After reset, mock returns undefined (Vitest v4 behavior)
          const name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBeUndefined();
        });

        it('should reset mockReturnValueOnce implementations of an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockReturnValueOnce('first mocked name');
          await mockGetName.mockReturnValueOnce('second mocked name');
          await mockGetName.mockReturnValueOnce('third mocked name');

          await mockGetName.mockReset();

          // After reset, mock returns undefined (Vitest v4 behavior)
          const name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBeUndefined();
        });

        it('should reset mockImplementationOnce implementations of an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockImplementationOnce(() => 'first mocked name');
          await mockGetName.mockImplementationOnce(() => 'second mocked name');
          await mockGetName.mockImplementationOnce(() => 'third mocked name');

          await mockGetName.mockReset();

          // After reset, mock returns undefined (Vitest v4 behavior)
          const name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBeUndefined();
        });

        it('should clear the history of an existing mock', async () => {
          const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
          await mockShowOpenDialog.mockReturnValue('mocked name');

          await browser.electron.execute((electron) => electron.dialog.showOpenDialog({}));
          await browser.electron.execute((electron) =>
            electron.dialog.showOpenDialog({
              title: 'my dialog',
            }),
          );
          await browser.electron.execute((electron) =>
            electron.dialog.showOpenDialog({
              title: 'another dialog',
            }),
          );

          await mockShowOpenDialog.mockReset();

          expect(mockShowOpenDialog.mock.calls).toStrictEqual([]);
          expect(mockShowOpenDialog.mock.invocationCallOrder).toStrictEqual([]);
          expect(mockShowOpenDialog.mock.lastCall).toBeUndefined();
          expect(mockShowOpenDialog.mock.results).toStrictEqual([]);
        });
      });

      describe('mockRestore', () => {
        it('should restore an existing mock', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockReturnValue('mocked appName');

          await mockGetName.mockRestore();

          const appName = await browser.electron.execute((electron) => electron.app.getName());
          expect(appName).toBe(getExpectedAppName());
        });
      });

      describe('getMockName', () => {
        it('should retrieve the mock name', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');

          expect(mockGetName.getMockName()).toBe('electron.app.getName');
        });
      });

      describe('mockName', () => {
        it('should set the mock name', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          mockGetName.mockName('my first mock');

          expect(mockGetName.getMockName()).toBe('my first mock');
        });
      });

      describe('getMockImplementation', () => {
        it('should retrieve the mock implementation', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockImplementation(() => 'mocked name');
          const mockImpl = mockGetName.getMockImplementation() as () => string;

          expect(mockImpl()).toBe('mocked name');
        });

        it('should retrieve an empty mock implementation', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockImpl = mockGetName.getMockImplementation() as () => undefined;

          expect(mockImpl).toBeUndefined();
        });
      });

      describe('mockReturnThis', () => {
        it('should allow chaining', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          const mockGetVersion = await browser.electron.mock('app', 'getVersion');
          await mockGetName.mockReturnThis();
          await browser.electron.execute((electron) =>
            (electron.app.getName() as unknown as { getVersion: () => string }).getVersion(),
          );

          expect(mockGetVersion).toHaveBeenCalled();
        });
      });

      describe('withImplementation', () => {
        it('should temporarily override mock implementation', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockImplementation(() => 'default mock name');
          await mockGetName.mockImplementationOnce(() => 'first mock name');
          await mockGetName.mockImplementationOnce(() => 'second mock name');
          const withImplementationResult = await mockGetName.withImplementation(
            () => 'temporary mock name',
            (electron) => electron.app.getName(),
          );

          expect(withImplementationResult).toBe('temporary mock name');
          const firstName = await browser.electron.execute((electron) => electron.app.getName());
          expect(firstName).toBe('first mock name');
          const secondName = await browser.electron.execute((electron) => electron.app.getName());
          expect(secondName).toBe('second mock name');
          const thirdName = await browser.electron.execute((electron) => electron.app.getName());
          expect(thirdName).toBe('default mock name');
        });

        it('should handle complex mock chaining and overrides', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');

          // Set up multiple layers of mocking
          await mockGetName.mockReturnValueOnce('first');
          await mockGetName.mockReturnValueOnce('second');
          await mockGetName.mockImplementation(() => 'fallback');

          // Override with withImplementation temporarily
          const tempResult = await mockGetName.withImplementation(
            () => 'temporary',
            (electron) => electron.app.getName(),
          );

          expect(tempResult).toBe('temporary');

          // Should continue with the once implementations
          const result1 = await browser.electron.execute((electron) => electron.app.getName());
          const result2 = await browser.electron.execute((electron) => electron.app.getName());
          const result3 = await browser.electron.execute((electron) => electron.app.getName());

          expect(result1).toBe('first');
          expect(result2).toBe('second');
          expect(result3).toBe('fallback');
        });

        it('should handle promises', async () => {
          const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');
          await mockGetFileIcon.mockResolvedValue('default mock icon');
          await mockGetFileIcon.mockResolvedValueOnce('first mock icon');
          await mockGetFileIcon.mockResolvedValueOnce('second mock icon');
          const withImplementationResult = await mockGetFileIcon.withImplementation(
            () => Promise.resolve('temporary mock icon'),
            async (electron) => await electron.app.getFileIcon('/path/to/icon'),
          );

          expect(withImplementationResult).toBe('temporary mock icon');
          const firstIcon = await browser.electron.execute((electron) => electron.app.getFileIcon('/path/to/icon'));
          expect(firstIcon).toBe('first mock icon');
          const secondIcon = await browser.electron.execute((electron) => electron.app.getFileIcon('/path/to/icon'));
          expect(secondIcon).toBe('second mock icon');
          const thirdIcon = await browser.electron.execute((electron) => electron.app.getFileIcon('/path/to/icon'));
          expect(thirdIcon).toBe('default mock icon');
        });

        it('should use the temporary implementation until an async callback settles', async () => {
          const mockGetName = await browser.electron.mock('app', 'getName');
          await mockGetName.mockReturnValue('default mock name');
          const withImplementationResult = await mockGetName.withImplementation(
            () => 'temporary mock name',
            async (electron) => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return electron.app.getName();
            },
          );

          expect(withImplementationResult).toBe('temporary mock name');
          const name = await browser.electron.execute((electron) => electron.app.getName());
          expect(name).toBe('default mock name');
        });
      });

      describe('Mock Object Properties', () => {
        describe('mock.calls', () => {
          it('should return the calls of the mock execution', async () => {
            const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');

            await browser.electron.execute((electron) => electron.app.getFileIcon('/path/to/icon'));
            await browser.electron.execute((electron) =>
              electron.app.getFileIcon('/path/to/another/icon', { size: 'small' }),
            );

            expect(mockGetFileIcon.mock.calls).toStrictEqual([
              ['/path/to/icon'], // first call
              ['/path/to/another/icon', { size: 'small' }], // second call
            ]);
          });

          it('should return an empty array when the mock was never invoked', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');

            expect(mockGetName.mock.calls).toStrictEqual([]);
          });
        });

        describe('mock.lastCall', () => {
          it('should return the last call of the mock execution', async () => {
            const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');
            // Mock the implementation to avoid calling real getFileIcon which crashes with non-existent paths
            await mockGetFileIcon.mockResolvedValue({ toDataURL: () => 'mocked-icon' } as any);

            await browser.electron.execute((electron) => electron.app.getFileIcon('/path/to/icon'));
            expect(mockGetFileIcon.mock.lastCall).toStrictEqual(['/path/to/icon']);
            await browser.electron.execute((electron) =>
              electron.app.getFileIcon('/path/to/another/icon', { size: 'small' }),
            );
            expect(mockGetFileIcon.mock.lastCall).toStrictEqual(['/path/to/another/icon', { size: 'small' }]);
            await browser.electron.execute((electron) =>
              electron.app.getFileIcon('/path/to/a/massive/icon', {
                size: 'large',
              }),
            );
            expect(mockGetFileIcon.mock.lastCall).toStrictEqual(['/path/to/a/massive/icon', { size: 'large' }]);
          });

          it('should return undefined when the mock was never invoked', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');

            expect(mockGetName.mock.lastCall).toBeUndefined();
          });
        });

        describe('mock.results', () => {
          it('should return the results of the mock execution', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');

            // Note: Using mockImplementation instead of mockReturnValueOnce as the latter does not work here
            await mockGetName.mockImplementation(() => 'result');

            await expect(browser.electron.execute((electron) => electron.app.getName())).resolves.toBe('result');

            expect(mockGetName.mock.results).toStrictEqual([
              {
                type: 'return',
                value: 'result',
              },
            ]);
          });

          it('should return an empty array when the mock was never invoked', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');

            expect(mockGetName.mock.results).toStrictEqual([]);
          });
        });

        describe('mock.invocationCallOrder', () => {
          it('should return the order of execution', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');
            const mockGetVersion = await browser.electron.mock('app', 'getVersion');

            await browser.electron.execute((electron) => electron.app.getName());
            await browser.electron.execute((electron) => electron.app.getVersion());
            await browser.electron.execute((electron) => electron.app.getName());

            const firstInvocationIndex = mockGetName.mock.invocationCallOrder[0];

            expect(mockGetName.mock.invocationCallOrder).toStrictEqual([
              firstInvocationIndex,
              firstInvocationIndex + 2,
            ]);
            expect(mockGetVersion.mock.invocationCallOrder).toStrictEqual([firstInvocationIndex + 1]);
          });

          it('should return an empty array when the mock was never invoked', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');

            expect(mockGetName.mock.invocationCallOrder).toStrictEqual([]);
          });
        });
      });

      describe('Integration Tests', () => {
        describe('Command Overrides', () => {
          it('should trigger mock updates when DOM interactions occur', async () => {
            const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
            await mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

            // Find and click the dialog button to trigger DOM interaction
            const showDialogButton = await $('.show-dialog');
            await showDialogButton.click();

            // Wait for mock to be called (command override should trigger update)
            await browser.waitUntil(async () => mockShowOpenDialog.mock.calls.length > 0, {
              timeout: 5000,
              timeoutMsg: 'Mock was not triggered by DOM interaction',
            });

            expect(mockShowOpenDialog).toHaveBeenCalledTimes(1);
          });
        });

        describe('showOpenDialog with complex object', () => {
          // Tests for the following issue
          // https://github.com/webdriverio-community/wdio-electron-service/issues/895
          it('should be mocked', async () => {
            const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
            // Mock return value to prevent real dialog from appearing
            await mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

            // Check if button exists before clicking (potential fix)
            const showDialogButton = await $('.show-dialog');
            const buttonExists = await showDialogButton.isExisting();

            if (!buttonExists) {
              throw new Error('Show dialog button not found in DOM');
            }

            await showDialogButton.click();

            await browser.waitUntil(
              async () => {
                return mockShowOpenDialog.mock.calls.length > 0;
              },
              { timeout: 5000, timeoutMsg: 'Mock was not called within timeout' },
            );

            expect(mockShowOpenDialog).toHaveBeenCalledTimes(1);
          });
        });

        describe('Complex Mock Scenarios', () => {
          it('should handle multiple API mocks simultaneously', async () => {
            const mockApp = await browser.electron.mock('app', 'getName');
            const mockDialog = await browser.electron.mock('dialog', 'showOpenDialog');
            const mockClipboard = await browser.electron.mock('clipboard', 'readText');

            await mockApp.mockReturnValue('My App');
            await mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected/file'] });
            await mockClipboard.mockReturnValue('clipboard content');

            const results = await browser.electron.execute(async (electron) => ({
              appName: electron.app.getName(),
              dialog: await electron.dialog.showOpenDialog({}),
              clipboard: electron.clipboard.readText(),
            }));

            expect(results.appName).toBe('My App');
            expect(results.dialog.filePaths).toStrictEqual(['/selected/file']);
            expect(results.clipboard).toBe('clipboard content');

            expect(mockApp).toHaveBeenCalledTimes(1);
            expect(mockDialog).toHaveBeenCalledTimes(1);
            expect(mockClipboard).toHaveBeenCalledTimes(1);
          });

          it('should maintain mock state across multiple operations', async () => {
            const mockSetName = await browser.electron.mock('app', 'setName');
            const mockGetName = await browser.electron.mock('app', 'getName');

            // Mock setName to store values and getName to return them
            let storedName = '';
            await mockSetName.mockImplementation((name: unknown) => {
              storedName = name as string;
            });
            await mockGetName.mockImplementation(() => storedName);

            await browser.electron.execute((electron) => {
              electron.app.setName('First Name');
              electron.app.setName('Second Name');
            });

            const names = await browser.electron.execute((electron) => [
              electron.app.getName(),
              electron.app.getName(),
            ]);

            expect(names).toStrictEqual(['Second Name', 'Second Name']);
            expect(mockSetName).toHaveBeenCalledWith('First Name');
            expect(mockSetName).toHaveBeenCalledWith('Second Name');
            expect(mockGetName).toHaveBeenCalledTimes(2);
          });

          it('should handle mock cleanup between operations', async () => {
            const mockGetName = await browser.electron.mock('app', 'getName');
            await mockGetName.mockReturnValue('first mock');

            const result1 = await browser.electron.execute((electron) => electron.app.getName());
            expect(result1).toBe('first mock');

            await mockGetName.mockClear();
            expect(mockGetName.mock.calls).toStrictEqual([]);

            await mockGetName.mockReturnValue('second mock');
            const result2 = await browser.electron.execute((electron) => electron.app.getName());
            expect(result2).toBe('second mock');
          });
        });
      });
    });

    describe('Error Conditions', () => {
      describe('Non-existent APIs and Functions', () => {
        it('should handle mocking non-existent API gracefully', async () => {
          // This should not throw, but the mock won't actually intercept anything
          const mockNonExistent = await browser.electron.mock('NonExistentAPI', 'someMethod');
          expect(mockNonExistent).toBeDefined();
          expect(typeof mockNonExistent.mockReturnValue).toBe('function');

          // Calling the mock should work, but it won't actually intercept real calls
          await mockNonExistent.mockReturnValue('test result');
          expect(mockNonExistent).toHaveBeenCalledTimes(0); // No calls intercepted
        });

        it('should handle mocking non-existent function on existing API', async () => {
          const mockNonExistentFunc = await browser.electron.mock('app', 'nonExistentMethod');
          expect(mockNonExistentFunc).toBeDefined();

          // The mock is installed on the API, so calls are intercepted
          await browser.electron.execute((electron) => {
            (electron.app as any).nonExistentMethod?.();
          });

          expect(mockNonExistentFunc).toHaveBeenCalledTimes(1);
        });

        it('should handle mocking non-existent class', async () => {
          // This should not throw, but the mock won't actually intercept anything
          const mockNonExistentClass = await browser.electron.mock('NonExistentClass');
          expect(mockNonExistentClass).toBeDefined();
          expect(mockNonExistentClass.__constructor).toBeDefined();

          // Constructor should exist but not intercept real instantiation
          const instance = await browser.electron.execute((electron) => {
            return (electron as any).NonExistentClass ? new (electron as any).NonExistentClass() : null;
          });
          expect(instance).toBeNull();

          expect(mockNonExistentClass.__constructor).toHaveBeenCalledTimes(0);
        });
      });

      describe('Invalid Mock Operations', () => {
        it('should handle calling mock methods on undefined results', async () => {
          const mockApp = await browser.electron.mock('app', 'getName');

          // Mock to return undefined
          await mockApp.mockReturnValue(undefined);

          const result = await browser.electron.execute((electron) => electron.app.getName());
          expect(result).toBeUndefined();

          // Accessing properties on undefined should not crash
          expect(mockApp.mock.calls).toStrictEqual([[]]);
        });

        it('should handle mock rejection with proper error propagation', async () => {
          const mockDialog = await browser.electron.mock('dialog', 'showOpenDialog');
          await mockDialog.mockRejectedValue(new Error('Mocked rejection'));

          await expect(
            browser.electron.execute(async (electron) => {
              return await electron.dialog.showOpenDialog({});
            }),
          ).rejects.toThrow('Mocked rejection');

          expect(mockDialog).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe('Class Mocking', () => {
      describe('mock (class)', () => {
        it('should create a class mock with constructor tracking', async () => {
          const mockTray = await browser.electron.mock('Tray');

          // Track constructor calls
          await browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png'));

          expect(mockTray.__constructor).toHaveBeenCalledTimes(1);
          expect(mockTray.__constructor).toHaveBeenCalledWith('/path/to/icon.png');
        });

        it('should mock instance methods on classes', async () => {
          const mockTray = await browser.electron.mock('Tray');

          // Mock instance methods
          await mockTray.setTitle.mockReturnValue(undefined);
          await mockTray.setToolTip.mockReturnValue(undefined);

          // Test instance method calls
          await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            tray.setTitle('My App');
            tray.setToolTip('Click for menu');
          });

          expect(mockTray.setTitle).toHaveBeenCalledWith('My App');
          expect(mockTray.setToolTip).toHaveBeenCalledWith('Click for menu');
        });

        it('should track multiple constructor calls', async () => {
          const mockTray = await browser.electron.mock('Tray');

          await browser.electron.execute((electron) => {
            new electron.Tray('/path/to/icon1.png');
            // @ts-expect-error — Tray constructor accepts extra args at runtime but types are narrow
            new electron.Tray('/path/to/icon2.png', { title: 'Test' });
          });

          expect(mockTray.__constructor).toHaveBeenCalledTimes(2);
          expect(mockTray.__constructor.mock.calls).toStrictEqual([
            ['/path/to/icon1.png'],
            ['/path/to/icon2.png', { title: 'Test' }],
          ]);
        });

        it('should allow chaining instance method mocks', async () => {
          const mockTray = await browser.electron.mock('Tray');
          await mockTray.setTitle.mockReturnThis();

          await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            // @ts-expect-error — mockReturnThis makes setTitle return `this`; types don't reflect it
            tray.setTitle('App').setToolTip('Menu');
          });

          expect(mockTray.setToolTip).toHaveBeenCalledWith('Menu');
        });
      });

      describe('Class Mock Methods', () => {
        describe('mockRestore', () => {
          it('should restore the original class implementation', async () => {
            // Get original Tray constructor name for comparison (functions serialize to {} via CDP)
            const originalTrayName = await browser.electron.execute((electron) => electron.Tray.name);

            const mockTray = await browser.electron.mock('Tray');

            // Mock some behavior
            await mockTray.setTitle.mockReturnValue('mocked');

            // Verify mock is active
            const mockResult = await browser.electron.execute((electron) => {
              const tray = new electron.Tray('/path/to/icon.png');
              return tray.setTitle('test');
            });
            expect(mockResult).toBe('mocked');

            // Restore original class
            await mockTray.mockRestore();

            // Verify original class is restored (compare by name since functions can't be serialized via CDP)
            const restoredTrayName = await browser.electron.execute((electron) => electron.Tray.name);
            expect(restoredTrayName).toBe(originalTrayName);

            // Constructor tracking should be gone after restore
            // Note: real Tray constructor throws with invalid path, so we ignore the error
            await browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png')).catch(() => {});
            expect(mockTray.__constructor.mock.calls).toStrictEqual([]);
          });
        });
      });

      describe('Class Mock Integration', () => {
        it('should work with clearAllMocks', async () => {
          const mockTray = await browser.electron.mock('Tray');

          // Create instance and call methods
          await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            tray.setTitle('My App');
          });

          expect(mockTray.__constructor).toHaveBeenCalledTimes(1);
          expect(mockTray.setTitle).toHaveBeenCalledTimes(1);

          // Clear all mocks
          await browser.electron.clearAllMocks();

          expect(mockTray.__constructor.mock.calls).toStrictEqual([]);
          expect(mockTray.setTitle.mock.calls).toStrictEqual([]);
        });

        it('should work with resetAllMocks', async () => {
          const mockTray = await browser.electron.mock('Tray');

          // Set up mock implementations
          await mockTray.setTitle.mockReturnValue('mocked title');

          // Create instance and call methods
          await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            tray.setTitle('My App');
          });

          expect(mockTray.__constructor).toHaveBeenCalledTimes(1);
          expect(mockTray.setTitle).toHaveBeenCalledTimes(1);

          // Reset all mocks
          await browser.electron.resetAllMocks();

          // Implementations should be reset but history should be cleared
          expect(mockTray.__constructor.mock.calls).toStrictEqual([]);
          expect(mockTray.setTitle.mock.calls).toStrictEqual([]);

          // After reset, methods should return undefined
          const result = await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            return tray.setTitle('test');
          });
          expect(result).toBeUndefined();
        });

        it('should work with restoreAllMocks', async () => {
          const originalTrayName = await browser.electron.execute((electron) => electron.Tray.name);

          const mockTray = await browser.electron.mock('Tray');
          await mockTray.setTitle.mockReturnValue('mocked');

          // Verify mock is active
          const mockResult = await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            return tray.setTitle('test');
          });
          expect(mockResult).toBe('mocked');

          // Restore all mocks
          await browser.electron.restoreAllMocks();

          // Verify original class is restored (compare by name since functions can't be serialized via CDP)
          const restoredTrayName = await browser.electron.execute((electron) => electron.Tray.name);
          expect(restoredTrayName).toBe(originalTrayName);
        });
      });

      describe('Class Mock Object Properties', () => {
        describe('__constructor properties', () => {
          it('should track constructor calls in mock.calls', async () => {
            const mockTray = await browser.electron.mock('Tray');

            await browser.electron.execute((electron) => {
              new electron.Tray('/path/to/icon1.png');
              // @ts-expect-error — Tray constructor accepts extra args at runtime but types are narrow
              new electron.Tray('/path/to/icon2.png', { title: 'Test' });
            });

            expect(mockTray.__constructor.mock.calls).toStrictEqual([
              ['/path/to/icon1.png'],
              ['/path/to/icon2.png', { title: 'Test' }],
            ]);
          });

          it('should track constructor lastCall', async () => {
            const mockTray = await browser.electron.mock('Tray');

            await browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png'));
            expect(mockTray.__constructor.mock.lastCall).toStrictEqual(['/path/to/icon.png']);

            await browser.electron.execute((electron) => new electron.Tray('/path/to/other.png'));
            expect(mockTray.__constructor.mock.lastCall).toStrictEqual(['/path/to/other.png']);
          });

          it('should track constructor invocation order', async () => {
            const mockTray = await browser.electron.mock('Tray');
            const mockDialog = await browser.electron.mock('dialog', 'showOpenDialog');

            await browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png'));
            await browser.electron.execute((electron) => electron.dialog.showOpenDialog({}));
            await browser.electron.execute((electron) => new electron.Tray('/path/to/other.png'));

            const constructorOrder = mockTray.__constructor.mock.invocationCallOrder;
            const dialogOrder = mockDialog.mock.invocationCallOrder;

            expect(constructorOrder.length).toBe(2);
            expect(dialogOrder.length).toBe(1);
            expect(constructorOrder[0]).toBeLessThan(dialogOrder[0]);
            expect(constructorOrder[1]).toBeGreaterThan(dialogOrder[0]);
          });
        });

        describe('instance method properties', () => {
          it('should track instance method calls', async () => {
            const mockTray = await browser.electron.mock('Tray');

            await browser.electron.execute((electron) => {
              const tray1 = new electron.Tray('/path/to/icon1.png');
              const tray2 = new electron.Tray('/path/to/icon2.png');

              tray1.setTitle('App 1');
              tray2.setTitle('App 2');
              tray1.setToolTip('Menu 1');
            });

            expect(mockTray.setTitle.mock.calls).toStrictEqual([['App 1'], ['App 2']]);
            expect(mockTray.setToolTip.mock.calls).toStrictEqual([['Menu 1']]);
          });

          it('should track instance method lastCall', async () => {
            const mockTray = await browser.electron.mock('Tray');

            await browser.electron.execute((electron) => {
              const tray = new electron.Tray('/path/to/icon.png');
              tray.setTitle('First');
              tray.setTitle('Last');
            });

            expect(mockTray.setTitle.mock.lastCall).toStrictEqual(['Last']);
          });

          it('should track instance method results', async () => {
            const mockTray = await browser.electron.mock('Tray');
            await mockTray.setTitle.mockReturnValue('success');

            await browser.electron.execute((electron) => {
              const tray = new electron.Tray('/path/to/icon.png');
              tray.setTitle('Test');
            });

            expect(mockTray.setTitle.mock.results).toStrictEqual([{ type: 'return', value: 'success' }]);
          });
        });

        describe('getMockName', () => {
          it('should retrieve the class mock name', async () => {
            const mockTray = await browser.electron.mock('Tray');

            expect(mockTray.getMockName()).toBe('electron.Tray');
          });

          it('should allow setting a custom constructor mock name', async () => {
            const mockTray = await browser.electron.mock('Tray');

            // The constructor mock should be renameable
            mockTray.__constructor.mockName('custom tray constructor');
            expect(mockTray.__constructor.getMockName()).toBe('custom tray constructor');
          });

          it('should provide mock names for instance methods', async () => {
            const mockTray = await browser.electron.mock('Tray');

            // Instance methods should have proper mock names
            expect(mockTray.setTitle.getMockName()).toBe('electron.Tray.setTitle');
            expect(mockTray.setToolTip.getMockName()).toBe('electron.Tray.setToolTip');
          });
        });
      });

      describe('Class Mock Advanced Features', () => {
        it('should support mockImplementation for instance methods', async () => {
          const mockTray = await browser.electron.mock('Tray');

          await mockTray.setTitle.mockImplementation((title: unknown) => `Mocked: ${String(title)}`);

          const result = await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            return tray.setTitle('My App');
          });

          expect(result).toBe('Mocked: My App');
          expect(mockTray.setTitle).toHaveBeenCalledWith('My App');
        });

        it('should support mockImplementationOnce for constructors', async () => {
          const mockTray = await browser.electron.mock('Tray');

          // Mock constructor to throw on first call
          await mockTray.__constructor.mockImplementationOnce(() => {
            throw new Error('Constructor failed');
          });

          // First instantiation should fail
          await expect(browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png'))).rejects.toThrow(
            'Constructor failed',
          );

          // Second instantiation should succeed (falls back to default)
          await expect(
            browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png')),
          ).resolves.not.toThrow();

          expect(mockTray.__constructor).toHaveBeenCalledTimes(2);
        });

        it('should support withImplementation for temporary overrides', async () => {
          const mockTray = await browser.electron.mock('Tray');

          await mockTray.setTitle.mockReturnValue('default');

          const result = await mockTray.setTitle.withImplementation(
            () => 'temporary',
            (electron) => {
              const tray = new electron.Tray('/path/to/icon.png');
              return tray.setTitle('test');
            },
          );

          expect(result).toBe('temporary');

          // After withImplementation, should return to default
          const normalResult = await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            return tray.setTitle('test');
          });
          expect(normalResult).toBe('default');
        });

        it('should support async instance methods', async () => {
          const mockTray = await browser.electron.mock('Tray');

          await mockTray.getBounds.mockResolvedValue({ x: 100, y: 200, width: 300, height: 400 });

          const bounds = await browser.electron.execute(async (electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            return await tray.getBounds();
          });

          expect(bounds).toStrictEqual({ x: 100, y: 200, width: 300, height: 400 });
          expect(mockTray.getBounds).toHaveBeenCalledTimes(1);
        });
      });

      describe('Multiple Class Types', () => {
        it('should support different Electron classes', async () => {
          const mockTray = await browser.electron.mock('Tray');
          const mockWindow = await browser.electron.mock('BrowserWindow');

          await browser.electron.execute((electron) => {
            new electron.Tray('/path/to/icon.png');
            new electron.BrowserWindow({ width: 800, height: 600 });
          });

          expect(mockTray.__constructor).toHaveBeenCalledTimes(1);
          expect(mockWindow.__constructor).toHaveBeenCalledTimes(1);
          expect(mockTray.__constructor).toHaveBeenCalledWith('/path/to/icon.png');
          expect(mockWindow.__constructor).toHaveBeenCalledWith({ width: 800, height: 600 });
        });

        it('should isolate mocks between different classes', async () => {
          const mockTray = await browser.electron.mock('Tray');
          const mockWindow = await browser.electron.mock('BrowserWindow');

          await mockTray.setTitle.mockReturnValue('tray title');
          await mockWindow.setTitle.mockReturnValue('window title');

          const results = await browser.electron.execute((electron) => {
            const tray = new electron.Tray('/path/to/icon.png');
            const win = new electron.BrowserWindow({ width: 800, height: 600 });
            return [tray.setTitle('tray'), win.setTitle('window')];
          });

          expect(results).toStrictEqual(['tray title', 'window title']);
        });
      });
    });
  });
});
