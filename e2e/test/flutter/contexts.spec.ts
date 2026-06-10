import { browser, expect } from '@wdio/globals';

describe('browser.flutter contexts', () => {
  it('should list the available contexts including FLUTTER', async () => {
    const contexts = await browser.flutter.listWindows();
    expect(contexts).toContain('FLUTTER');
    expect(contexts).toContain('NATIVE_APP');
  });

  it('should switch between NATIVE_APP and FLUTTER', async () => {
    await browser.flutter.switchWindow('NATIVE_APP');
    await browser.flutter.switchWindow('FLUTTER');
    // Back in FLUTTER, a widget find actually works — the counter is a numeric string, so
    // assert the digits (not just toBeDefined, which a getText string always satisfies).
    expect(await browser.flutter.byValueKey('counter').getText()).toMatch(/^\d+$/);
  });
});
