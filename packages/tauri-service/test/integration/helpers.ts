import type { TauriMock } from '@wdio/native-types';
import { vi } from 'vitest';

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export function defer<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type OverrideFn = (
  this: unknown,
  originalCommand: (...args: readonly unknown[]) => Promise<unknown>,
  ...args: readonly unknown[]
) => Promise<unknown>;

export interface FakeBrowser {
  url: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  overwriteCommand: ReturnType<typeof vi.fn>;
  tauri: Record<string, unknown>;
  overrides: Map<string, OverrideFn>;
  /**
   * Invoke a registered command override. The optional `ownerBrowser` is set as
   * `this.browser` inside the override — kept for parity with the Electron
   * harness, though Tauri's mock-sync override closes over the install-time
   * browser and ignores `this.browser`.
   */
  triggerCommand: (name: string, ownerBrowser?: WebdriverIO.Browser) => Promise<unknown>;
}

export function createFakeBrowser(): FakeBrowser {
  const overrides = new Map<string, OverrideFn>();
  const browser = {
    url: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    overwriteCommand: vi.fn((name: string, fn: OverrideFn, _isElement?: boolean) => {
      overrides.set(name, fn);
      // Mirror webdriverio: overwriting a browser command (e.g. url — read-only in wdio >=9.27,
      // hence overwriteCommand) replaces it, calling through to the original. Element commands
      // like click are exercised via triggerCommand instead, so only url needs live wiring here.
      if (name === 'url') {
        const original = browser.url as unknown as (...args: readonly unknown[]) => Promise<unknown>;
        browser.url = vi.fn((...args: readonly unknown[]) => fn.call(browser, original, ...args));
      }
    }),
    tauri: {} as Record<string, unknown>,
    overrides,
    triggerCommand: (name: string, ownerBrowser?: WebdriverIO.Browser) => {
      const fn = overrides.get(name);
      if (!fn) {
        throw new Error(`No override registered for command "${name}"`);
      }
      const originalCommand = vi.fn().mockResolvedValue(undefined);
      const ctx = ownerBrowser ? { browser: ownerBrowser } : {};
      return fn.call(ctx, originalCommand);
    },
  };
  return browser;
}

export interface FakeMock {
  mock: TauriMock;
  update: ReturnType<typeof vi.fn>;
}

/**
 * Create a fake mock whose `update()` resolves immediately by default. Tests
 * that need controllable timing can override via `.mockImplementationOnce`,
 * `.mockResolvedValueOnce`, or `.mockRejectedValueOnce`. The shape is the
 * minimum the scheduler touches: `getMockName()` (the store key) + `update()`.
 */
export function createFakeMock(name: string): FakeMock {
  const update = vi.fn(async () => undefined);
  const mock = {
    getMockName: () => name,
    update,
  } as unknown as TauriMock;
  return { mock, update };
}

/**
 * Flush the microtask queue. Two `setImmediate` flushes cover .then().then() chains.
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
