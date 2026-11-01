import { createLogger } from './log.js';
import { isMultiremote } from './multiremote.js';

const log = createLogger('native-utils', 'mock');

// Warn at most once per process if WDIO's element-override internals aren't where
// we expect — see installMockSyncOverride.
let warnedMissingInternals = false;

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
 * stack — the last element `overwriteCommand(name, fn)` wins. A service's
 * `before()` runs after the user's, so naively registering here discards the
 * user's own `overwriteCommand('click', ...)`.
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
 * access is optional-chained: if WDIO's shape ever changes it degrades to the
 * previous behaviour (service override only) and logs a one-time warning instead
 * of failing silently.
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
  const elementOverrides = (
    browser as unknown as {
      __propertiesObject__?: {
        __elementOverrides__?: { value?: Record<string, ElementOverrideFn | undefined> };
      };
    }
  ).__propertiesObject__?.__elementOverrides__?.value;

  // WebdriverIO always initializes this map (to `{}` even with no overrides), so
  // its absence on a single session means the internal shape changed — which
  // would silently send us back to clobbering user overrides. Surface it once
  // rather than degrade in silence. Multiremote roots don't carry the map,
  // so don't false-alarm on them.
  if (!elementOverrides && !isMultiremote(browser) && !warnedMissingInternals) {
    warnedMissingInternals = true;
    log.warn(
      `Could not read WebdriverIO's element-override map while installing the '${commandName}' override; ` +
        'a user override of this command may be clobbered. The WebdriverIO internals this relies on may have changed.',
    );
  }

  const existing = elementOverrides?.[commandName];

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

  // The third argument is `true` in v9 and `{ attachToElement: true }` in v10, which throws on a boolean.
  // v9 only checks that it's truthy, so the object works on both; the cast gets it past v9's boolean type.
  const overwriteCommand = browser.overwriteCommand as unknown as (
    name: string,
    fn: typeof override,
    options: { attachToElement: true },
  ) => void;
  overwriteCommand.call(browser, commandName, override, { attachToElement: true });
}
