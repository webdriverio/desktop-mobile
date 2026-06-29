import { vi } from 'vitest';

export type OverrideFn = (
  this: unknown,
  originalCommand: (...args: readonly unknown[]) => Promise<unknown>,
  ...args: readonly unknown[]
) => Promise<unknown>;

export interface FakeBrowser {
  url: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  overwriteCommand: ReturnType<typeof vi.fn>;
  isMultiremote: boolean;
  dioxus: Record<string, unknown>;
  overrides: Map<string, OverrideFn>;
  /**
   * Invoke a registered command override (e.g. the patched `url`). The optional
   * `ownerBrowser` is set as `this.browser` inside the override.
   */
  triggerCommand: (name: string, ...args: readonly unknown[]) => Promise<unknown>;
}

export function createFakeBrowser(): FakeBrowser {
  const overrides = new Map<string, OverrideFn>();
  const browser = {
    url: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    overwriteCommand: vi.fn((name: string, fn: OverrideFn, _isElement?: boolean) => {
      overrides.set(name, fn);
      // Mirror webdriverio: overwriting a browser command (e.g. url — read-only in wdio >=9.27,
      // hence overwriteCommand) replaces it, calling through to the original.
      if (name === 'url') {
        const original = browser.url as unknown as (...args: readonly unknown[]) => Promise<unknown>;
        browser.url = vi.fn((...args: readonly unknown[]) => fn.call(browser, original, ...args));
      }
    }),
    isMultiremote: false,
    dioxus: {} as Record<string, unknown>,
    overrides,
    triggerCommand: (name: string, ...args: readonly unknown[]) => {
      const fn = overrides.get(name);
      if (!fn) {
        throw new Error(`No override registered for command "${name}"`);
      }
      const originalCommand = vi.fn().mockResolvedValue(undefined);
      return fn.call(browser, originalCommand, ...args);
    },
  };
  return browser;
}
