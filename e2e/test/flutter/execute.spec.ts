import { browser, expect } from '@wdio/globals';

describe('browser.flutter.execute', () => {
  it('should evaluate a Dart arithmetic expression', async () => {
    expect(await browser.flutter.execute('1 + 1')).toBe(2);
  });

  it('should evaluate a Dart boolean expression', async () => {
    expect(await browser.flutter.execute('WidgetsBinding.instance != null')).toBe(true);
  });

  it("should read the fixture's top-level marker constant", async () => {
    expect(await browser.flutter.execute('fixtureMarker')).toBe('wdio-flutter-fixture');
  });
});
