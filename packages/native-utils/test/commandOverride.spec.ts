import { describe, expect, it, vi } from 'vitest';
import { installMockSyncOverride } from '../src/commandOverride.js';

type BrowserArg = Parameters<typeof installMockSyncOverride>[0];
type OverrideFn = (
  this: unknown,
  originalCommand: (...args: unknown[]) => Promise<unknown>,
  ...args: unknown[]
) => Promise<unknown>;

function createBrowser(elementOverrides?: Record<string, unknown>) {
  const overwriteCommand = vi.fn();
  const browser = {
    overwriteCommand,
    ...(elementOverrides ? { __propertiesObject__: { __elementOverrides__: { value: elementOverrides } } } : {}),
  } as unknown as BrowserArg;
  return { browser, overwriteCommand };
}

function captureClickOverride(overwriteCommand: ReturnType<typeof vi.fn>): OverrideFn {
  const call = overwriteCommand.mock.calls.find((c) => c[0] === 'click');
  expect(call).toBeDefined();
  expect(call?.[2]).toBe(true); // attachToElement
  return call?.[1] as OverrideFn;
}

describe('installMockSyncOverride', () => {
  it('should register an element-scoped override for the command', () => {
    const { browser, overwriteCommand } = createBrowser();
    installMockSyncOverride(browser, 'click', async () => {});
    expect(overwriteCommand).toHaveBeenCalledWith('click', expect.any(Function), true);
  });

  it('should run the original command then sync mocks when there is no user override', async () => {
    const { browser, overwriteCommand } = createBrowser();
    const order: string[] = [];
    const syncMocks = vi.fn(async () => {
      order.push('sync');
    });
    installMockSyncOverride(browser, 'click', syncMocks);

    const override = captureClickOverride(overwriteCommand);
    const original = vi.fn(async () => {
      order.push('original');
      return 'ok';
    });
    const result = await override.call({}, original);

    expect(original).toHaveBeenCalledOnce();
    expect(syncMocks).toHaveBeenCalledOnce();
    expect(order).toEqual(['original', 'sync']);
    expect(result).toBe('ok');
  });

  it('should pass the element the command ran on to syncMocks', async () => {
    const { browser, overwriteCommand } = createBrowser();
    const syncMocks = vi.fn(async () => {});
    installMockSyncOverride(browser, 'click', syncMocks);

    const override = captureClickOverride(overwriteCommand);
    const element = { id: 'el' };
    await override.call(
      element,
      vi.fn(async () => undefined),
    );

    expect(syncMocks).toHaveBeenCalledWith(element);
  });

  it('should chain a user override so their origCommand runs the original then syncs', async () => {
    const order: string[] = [];
    // The user's override as WDIO stores it: it receives the original command and
    // calls it. Here we record ordering to prove the service mock-sync is wired
    // into the user's `origClick`.
    const userOverride = vi.fn(async function (
      this: unknown,
      origCommand: (...a: unknown[]) => Promise<unknown>,
      ...args: unknown[]
    ) {
      order.push('user:before');
      const r = await origCommand(...args);
      order.push('user:after');
      return r;
    });
    const { browser, overwriteCommand } = createBrowser({ click: userOverride });

    const syncMocks = vi.fn(async () => {
      order.push('sync');
    });
    installMockSyncOverride(browser, 'click', syncMocks);

    const override = captureClickOverride(overwriteCommand);
    const original = vi.fn(async () => {
      order.push('original');
      return 'ok';
    });
    const result = await override.call({}, original, 'arg1');

    expect(userOverride).toHaveBeenCalledOnce();
    expect(original).toHaveBeenCalledOnce();
    expect(syncMocks).toHaveBeenCalledOnce();
    // User stays the outer wrapper; its origCommand ran the real command + sync.
    expect(order).toEqual(['user:before', 'original', 'sync', 'user:after']);
    expect(result).toBe('ok');
  });

  it('should fall back to service-only sync when the WDIO internals are absent', async () => {
    const { browser, overwriteCommand } = createBrowser(); // no __propertiesObject__
    const syncMocks = vi.fn(async () => {});
    installMockSyncOverride(browser, 'click', syncMocks);

    const override = captureClickOverride(overwriteCommand);
    await override.call(
      {},
      vi.fn(async () => undefined),
    );

    expect(syncMocks).toHaveBeenCalledOnce();
  });
});
