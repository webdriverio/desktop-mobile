import { requireInstance } from '@wdio/native-core';
import type { TauriMock } from '@wdio/native-types';
import { createLogger, errorMessage, isMultiremote, type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';
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

function getMockBrowser(context: TauriServiceContext | undefined): WebdriverIO.Browser | undefined {
  if (
    context?.browser &&
    !isMultiremote(context.browser) &&
    context.browser.tauri &&
    typeof context.browser.tauri.execute === 'function'
  ) {
    return context.browser as WebdriverIO.Browser;
  }
  if (
    globalThis.browser &&
    (globalThis.browser as WebdriverIO.Browser).tauri &&
    typeof (globalThis.browser as WebdriverIO.Browser).tauri.execute === 'function'
  ) {
    return globalThis.browser as WebdriverIO.Browser;
  }
  if (globalThis.browser && !isMultiremote(globalThis.browser)) {
    return globalThis.browser as WebdriverIO.Browser;
  }
  if (context?.browser && !isMultiremote(context.browser)) {
    return context.browser as WebdriverIO.Browser;
  }
  return globalThis.browser as WebdriverIO.Browser | undefined;
}

export async function mock(this: TauriServiceContext | undefined, command: string): Promise<TauriMock> {
  const browserContext = getMockBrowser(this);
  if (!browserContext) {
    throw new Error('mock requires a valid browser context');
  }

  try {
    const existingMock = mockStore.getMock(browserContext, `tauri.${command}`);
    await existingMock.mockReset();
    return existingMock;
  } catch (_e) {
    const newMock = await createMock(command, browserContext);
    mockStore.setMock(browserContext, newMock);
    return newMock;
  }
}

type BulkCommand = 'clearAllMocks' | 'resetAllMocks' | 'restoreAllMocks';
type BulkAppCall = (browser: WebdriverIO.Browser, prefix: string) => Promise<unknown>;

export interface MockTarget {
  name?: string;
  caps?: WebdriverIO.Capabilities;
  // Resolved when the op runs, so an instance that can't be found fails on its own
  resolve: () => { owner: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser; app?: WebdriverIO.Browser };
}

// A multiremote root covers every instance's mocks, then the mocks created on the root itself.
// The root has no app of its own, so its mocks skip the in-app bulk call.
export function getMockTargets(
  browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  capabilities?: unknown,
): MockTarget[] {
  if (!isMultiremote(browser)) {
    return [{ resolve: () => ({ owner: browser, app: browser }) }];
  }
  const entries = capabilities as Record<string, { capabilities?: WebdriverIO.Capabilities } | undefined> | undefined;
  return [
    ...browser.instances.map((name) => ({
      name,
      caps: entries?.[name]?.capabilities,
      resolve: () => {
        const instance = requireInstance(browser, name);
        return { owner: instance, app: instance };
      },
    })),
    { name: 'the multiremote root', resolve: () => ({ owner: browser }) },
  ];
}

export async function runOnMockTargets(
  commandName: BulkCommand,
  targets: Array<MockTarget & { prefix?: string }>,
): Promise<void> {
  const { op, bulkAppCall } = BULK_COMMANDS[commandName];
  const runOn = async ({ resolve, prefix }: MockTarget & { prefix?: string }) => {
    const { owner, app } = resolve();
    const mocks = mockStore.getMocks(owner);
    const count = await runBulkMockOp(mocks, op, {
      matches: (name) => shouldProcessMock(name, prefix),
      bulkAppCall: app && bulkAppCall ? () => bulkAppCall(app, prefix ?? '') : undefined,
    });
    log.debug(`${commandName}: ${op} ran on ${count} of ${mocks.length} mocks${prefix ? ` (prefix: ${prefix})` : ''}`);
  };

  const results = await Promise.allSettled(targets.map(runOn));
  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [{ name: targets[i].name, error: result.reason as unknown }] : [],
  );
  if (failures.length === 0) {
    return;
  }
  // A single session has no instance name to add
  if (failures.length === 1 && failures[0].name === undefined) {
    throw failures[0].error;
  }
  const message = `${commandName} failed on ${failures
    .map(({ name, error }) => `${name}: ${errorMessage(error)}`)
    .join('; ')}`;
  throw failures.length === 1
    ? new Error(message, { cause: failures[0].error })
    : new AggregateError(
        failures.map(({ error }) => error),
        message,
      );
}

async function runOnMocks(
  commandName: BulkCommand,
  context: TauriServiceContext | undefined,
  commandPrefix: string | undefined,
): Promise<void> {
  const browserContext = context?.browser || globalThis.browser;
  if (!browserContext) {
    throw new Error(`${commandName} requires a valid browser context`);
  }
  const targets = getMockTargets(browserContext);
  await runOnMockTargets(
    commandName,
    targets.map((target) => ({ ...target, prefix: commandPrefix })),
  );
}

export async function clearAllMocks(this: TauriServiceContext | undefined, commandPrefix?: string): Promise<void> {
  await runOnMocks('clearAllMocks', this, commandPrefix);
}

export async function resetAllMocks(this: TauriServiceContext | undefined, commandPrefix?: string): Promise<void> {
  await runOnMocks('resetAllMocks', this, commandPrefix);
}

export async function restoreAllMocks(this: TauriServiceContext | undefined, commandPrefix?: string): Promise<void> {
  await runOnMocks('restoreAllMocks', this, commandPrefix);
}

function resetMocksInApp(browser: WebdriverIO.Browser, commandPrefix: string): Promise<unknown> {
  return browser.execute<void, [string]>((prefix) => {
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
  }, commandPrefix);
}

function restoreMocksInApp(browser: WebdriverIO.Browser, commandPrefix: string): Promise<unknown> {
  return browser.execute<void, [string]>((prefix) => {
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
  }, commandPrefix);
}

const BULK_COMMANDS: Record<BulkCommand, { op: MockLifecycleOp; bulkAppCall?: BulkAppCall }> = {
  clearAllMocks: { op: 'mockClear' },
  resetAllMocks: { op: 'mockReset', bulkAppCall: resetMocksInApp },
  restoreAllMocks: { op: 'mockRestore', bulkAppCall: restoreMocksInApp },
};

export function isMockFunction(fn: unknown): fn is import('@wdio/native-types').TauriMockInstance {
  return (
    typeof fn === 'function' && '__isTauriMock' in fn && (fn as unknown as { __isTauriMock: boolean }).__isTauriMock
  );
}
