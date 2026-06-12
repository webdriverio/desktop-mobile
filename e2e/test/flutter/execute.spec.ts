import { browser, expect } from '@wdio/globals';

// execute is cooperative on Flutter (Dart is AOT-compiled — no runtime source eval under a bare
// Appium launch): the fixture registers handlers via wdioHandlers, the test invokes them by name.
describe('browser.flutter.execute', () => {
  it('should invoke a handler that reads app state', async () => {
    expect(await browser.flutter.execute('marker')).toBe('wdio-flutter-fixture');
  });

  it('should invoke a handler with positional args', async () => {
    expect(await browser.flutter.execute('add', 2, 3)).toBe(5);
  });

  it('should invoke a handler returning a boolean', async () => {
    expect(await browser.flutter.execute('bindingReady')).toBe(true);
  });

  it('should await an async handler', async () => {
    expect(await browser.flutter.execute('greetAsync', 'WDIO')).toBe('hi WDIO');
  });

  it('should throw a listing error for an unregistered handler name', async () => {
    // execute is handler-only: an unknown name reports as a missing handler and lists the
    // registered ones (no arbitrary-expression eval unless a compiler is attached — see #389).
    await expect(browser.flutter.execute('fixtureMarker')).rejects.toThrow(/no handler 'fixtureMarker' is registered/);
  });
});
