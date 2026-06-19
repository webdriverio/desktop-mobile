/**
 * Shape of an element-scoped command override as WebdriverIO invokes it: the
 * first argument is the original command, followed by the command's own args.
 */
type ElementOverrideFn = (
  this: WebdriverIO.Element,
  originalCommand: (...args: readonly unknown[]) => Promise<unknown>,
  ...args: readonly unknown[]
) => Promise<unknown>;

/**
 * Install an element-scoped command override that re-syncs mocks after the
 * command runs, WITHOUT clobbering a user-registered override of the same
 * command.
 *
 * WebdriverIO keys element-scoped overrides by command name and they do not
 * stack — the last `overwriteCommand(name, fn, true)` wins. A service's
 * `before()` runs after the user's, so naively registering here discards the
 * user's `overwriteCommand('click', ...)` (webdriverio/desktop-mobile#422).
 *
 * Instead we capture any override the user already registered and chain it: the
 * user stays the OUTER wrapper, and the `originalCommand` we hand them runs the
 * real command and then the mock sync. So a user override that does
 * `await origClick()` transparently gets the service's mock-syncing version,
 * which is what the bug report expects.
 *
 * Caveat: the captured override is the WDIO-wrapped form, so invoking it re-runs
 * the command-hook machinery once (an extra `beforeCommand`/`afterCommand`).
 * That's benign for the services here (an extra window-focus check) and only
 * observable if the user also defines config-level command hooks. The internals
 * access is optional-chained: if WDIO's shape ever changes, `existing` is
 * undefined and this degrades to the previous behaviour (service override only).
 *
 * @param browser - the browser (or multiremote instance) to register on
 * @param commandName - the element command to override (e.g. `'click'`)
 * @param syncMocks - re-syncs mocks; receives the element the command ran on
 */
export function installMockSyncOverride(
  browser: WebdriverIO.Browser,
  commandName: string,
  syncMocks: (element: WebdriverIO.Element) => Promise<void>,
): void {
  const existing = (
    browser as unknown as {
      __propertiesObject__?: {
        __elementOverrides__?: { value?: Record<string, ElementOverrideFn | undefined> };
      };
    }
  ).__propertiesObject__?.__elementOverrides__?.value?.[commandName];

  const override = async function (
    this: WebdriverIO.Element,
    originalCommand: (...args: readonly unknown[]) => Promise<unknown>,
    ...args: readonly unknown[]
  ): Promise<unknown> {
    const serviceCommand = async (...innerArgs: readonly unknown[]): Promise<unknown> => {
      const result = await Reflect.apply(originalCommand, this, innerArgs);
      await syncMocks(this);
      return result;
    };

    return existing ? existing.apply(this, [serviceCommand, ...args]) : serviceCommand(...args);
  } as Parameters<typeof browser.overwriteCommand>[1];

  browser.overwriteCommand(commandName as Parameters<typeof browser.overwriteCommand>[0], override, true);
}
