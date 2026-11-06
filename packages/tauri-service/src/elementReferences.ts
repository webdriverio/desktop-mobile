// W3C WebDriver's element and shadow root identifiers: https://www.w3.org/TR/webdriver2/#elements
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

// Sends WebdriverIO elements as W3C element references, as `browser.execute` does for its arguments
export function toElementReferences(args: unknown[]): Parameters<WebdriverIO.Browser['executeAsyncScript']>[1] {
  return args.map((arg) => {
    if (typeof arg !== 'object' || arg === null || !('selector' in arg) || !('elementId' in arg)) {
      return arg;
    }
    if (!arg.elementId) {
      throw new Error(
        `The element with selector "${String(arg.selector)}" you are trying to pass into the execute method wasn't found`,
      );
    }
    return { [ELEMENT_KEY]: arg.elementId };
  }) as Parameters<WebdriverIO.Browser['executeAsyncScript']>[1];
}

export function hasReference(json: string): boolean {
  return json.includes(`"${ELEMENT_KEY}"`) || json.includes(`"${SHADOW_KEY}"`);
}
