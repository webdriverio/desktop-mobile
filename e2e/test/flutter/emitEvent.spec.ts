import { browser, expect } from '@wdio/globals';

describe('browser.flutter.emitEvent', () => {
  it('should emit an event the app reflects into the UI', async () => {
    await browser.flutter.emitEvent('greeting', 'hi');
    // The fixture renders `${name}:${jsonEncode(payload)}` — a string payload is JSON-quoted.
    expect(await browser.flutter.byValueKey('lastEvent').getText()).toBe('greeting:"hi"');
  });
});
