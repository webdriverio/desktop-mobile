const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type ScriptArgs = Parameters<WebdriverIO.Browser['executeAsyncScript']>[1];

/**
 * WebdriverIO v9's `browser.executeAsync`, which v10 removed. Runs `script` through WebDriver's Execute Async
 * Script with `args` and then a done callback; a function script is called with them.
 */
export async function executeAsync<T = unknown>(
  browser: WebdriverIO.Browser,
  script: string | ((...args: never[]) => void),
  ...args: unknown[]
): Promise<T> {
  const body = typeof script === 'function' ? `return (${script}).apply(null, arguments)` : script;
  return (await browser.executeAsyncScript(body, args.map(toElementReference) as ScriptArgs)) as T;
}

function toElementReference(arg: unknown): unknown {
  if (typeof arg !== 'object' || arg === null || !('selector' in arg) || !('elementId' in arg)) {
    return arg;
  }
  if (!arg.elementId) {
    throw new Error(
      `The element with selector "${String(arg.selector)}" you are trying to pass into the execute method wasn't found`,
    );
  }
  return { [ELEMENT_KEY]: arg.elementId };
}
