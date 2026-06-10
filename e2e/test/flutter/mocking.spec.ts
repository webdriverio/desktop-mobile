import { browser, expect } from '@wdio/globals';

describe('browser.flutter.mock', () => {
  afterEach(async () => {
    await browser.flutter.restoreAllMocks();
  });

  it('should mock a Dart seam and record the call', async () => {
    const greet = await browser.flutter.mock('GreetingService.greet');
    await greet.mockReturnValue('Mocked greeting!');

    // Tapping increment calls GreetingService.greet('WDIO') and shows the result.
    await browser.flutter.byValueKey('increment').tap();
    expect(await browser.flutter.byValueKey('greeting').getText()).toBe('Mocked greeting!');

    await greet.update();
    expect(greet.mock.calls.length).toBeGreaterThan(0);
    expect(greet.mock.calls[0]).toEqual(['WDIO']);
    // isMockFunction is synchronous; the await is a harmless no-op that also future-proofs the
    // assertion (and quiets the lint heuristic) if the API ever returns a Promise.
    expect(await browser.flutter.isMockFunction('GreetingService.greet')).toBe(true);
  });

  it('should fall through to the real implementation after restore', async () => {
    await browser.flutter.byValueKey('increment').tap();
    expect(await browser.flutter.byValueKey('greeting').getText()).toBe('Hello, WDIO!');
  });
});
