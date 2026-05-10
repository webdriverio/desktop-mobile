import type { TauriMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { createMock } from '../mock.js';
import mockStore from '../mockStore.js';

const log = createLogger('tauri-service', 'mock');

interface TauriServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a mock should be processed based on the optional command prefix
 * @param mockName - Full mock name (e.g., "tauri.read_clipboard")
 * @param commandPrefix - Optional prefix to filter by (e.g., "read")
 * @returns true if the mock should be processed
 */
function shouldProcessMock(mockName: string, commandPrefix?: string): boolean {
  if (!commandPrefix) {
    return true;
  }
  const escapedPrefix = escapeRegex(commandPrefix);
  return new RegExp(`^tauri\\.${escapedPrefix}`).test(mockName);
}

export async function mock(this: TauriServiceContext, command: string): Promise<TauriMock> {
  // First try returning an existing mock without requiring a browser context
  try {
    // Retrieve an existing mock from the store
    const existingMock = mockStore.getMock(`tauri.${command}`);
    await existingMock.mockReset();
    return existingMock;
  } catch (_e) {
    // No existing mock, determine browser context now
    let browserContext: WebdriverIO.Browser | undefined;
    // Prefer this.browser if it has tauri capabilities
    if (
      this &&
      this.browser &&
      !this.browser.isMultiremote &&
      this.browser.tauri &&
      typeof this.browser.tauri.execute === 'function'
    ) {
      browserContext = this.browser as WebdriverIO.Browser;
    } else if (
      globalThis.browser &&
      (globalThis.browser as WebdriverIO.Browser).tauri &&
      typeof (globalThis.browser as WebdriverIO.Browser).tauri.execute === 'function'
    ) {
      browserContext = globalThis.browser as WebdriverIO.Browser;
    } else if (globalThis.browser && !(globalThis.browser as unknown as WebdriverIO.MultiRemoteBrowser).isMultiremote) {
      browserContext = globalThis.browser as WebdriverIO.Browser;
    } else if (this?.browser && !this.browser.isMultiremote) {
      browserContext = this.browser as WebdriverIO.Browser;
    }

    // Create a new mock and store it
    const newMock = await createMock(command, browserContext);
    mockStore.setMock(newMock);
    return newMock;
  }
}

export async function clearAllMocks(this: TauriServiceContext, commandPrefix?: string): Promise<void> {
  const mocks = mockStore.getMocks();
  let clearedCount = 0;

  for (const [mockName, mock] of mocks) {
    if (shouldProcessMock(mockName, commandPrefix)) {
      await mock.mockClear();
      clearedCount++;
    }
  }

  log.debug(
    `clearAllMocks: cleared ${clearedCount} of ${mocks.length} mocks${commandPrefix ? ` (prefix: ${commandPrefix})` : ''}`,
  );
}

export async function resetAllMocks(this: TauriServiceContext | undefined, commandPrefix?: string): Promise<void> {
  const browserContext = this?.browser || globalThis.browser;

  if (!browserContext || browserContext.isMultiremote) {
    throw new Error('resetAllMocks requires a valid browser context');
  }

  // Reset mocks in the injection script (with prefix filtering if provided)
  await (browserContext as WebdriverIO.Browser).execute<void, [string]>((prefix) => {
    // @ts-expect-error - window.__wdio_mocks__ is defined by injection script
    if (window.__wdio_mocks__) {
      // @ts-expect-error - Reset each mock
      for (const [commandName, mock] of Object.entries(window.__wdio_mocks__)) {
        // Filter by prefix if provided
        if (!prefix || commandName.startsWith(prefix)) {
          // @ts-expect-error - mock has mockReset method
          if (mock && typeof mock.mockReset === 'function') {
            // @ts-expect-error - mock has mockReset method
            mock.mockReset();
          }
        }
      }
    }
  }, commandPrefix ?? '');

  // Reset outer mocks (with prefix filtering)
  const mocks = mockStore.getMocks();
  let resetCount = 0;
  for (const [mockName, mock] of mocks) {
    if (shouldProcessMock(mockName, commandPrefix)) {
      await mock.mockReset();
      resetCount++;
    }
  }

  log.debug(
    `resetAllMocks: reset ${resetCount} of ${mocks.length} mocks${commandPrefix ? ` (prefix: ${commandPrefix})` : ''}`,
  );
}

export async function restoreAllMocks(this: TauriServiceContext | undefined, commandPrefix?: string): Promise<void> {
  const browserContext = this?.browser || globalThis.browser;

  if (!browserContext || browserContext.isMultiremote) {
    throw new Error('restoreAllMocks requires a valid browser context');
  }

  // Restore mocks in the injection script (with prefix filtering if provided)
  await (browserContext as WebdriverIO.Browser).execute<void, [string]>((prefix) => {
    // @ts-expect-error - window.__wdio_mocks__ is defined by injection script
    if (window.__wdio_mocks__) {
      if (!prefix) {
        // No prefix: clear all mocks
        // @ts-expect-error - window.__wdio_mocks__ is defined by injection script
        window.__wdio_mocks__ = {};
      } else {
        // With prefix: selectively delete matching mocks
        // @ts-expect-error - window.__wdio_mocks__ is defined by injection script
        for (const commandName of Object.keys(window.__wdio_mocks__)) {
          if (commandName.startsWith(prefix)) {
            // @ts-expect-error - window.__wdio_mocks__ is defined by injection script
            delete window.__wdio_mocks__[commandName];
          }
        }
      }
    }
  }, commandPrefix ?? '');

  // Restore outer mocks (with prefix filtering)
  const mocks = mockStore.getMocks();
  let restoredCount = 0;
  for (const [mockName, mock] of mocks) {
    if (shouldProcessMock(mockName, commandPrefix)) {
      await mock.mockRestore();
      restoredCount++;
    }
  }

  log.debug(
    `restoreAllMocks: restored ${restoredCount} of ${mocks.length} mocks${commandPrefix ? ` (prefix: ${commandPrefix})` : ''}`,
  );
}

export function isMockFunction(fn: unknown): fn is import('@wdio/native-types').TauriMockInstance {
  return (
    typeof fn === 'function' && '__isTauriMock' in fn && (fn as unknown as { __isTauriMock: boolean }).__isTauriMock
  );
}
