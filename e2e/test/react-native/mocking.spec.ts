import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

type Greeter = { greet(name: string): string };

const callGreet = (name: string) =>
  browser.reactNative.execute((_rn, n: string) => (globalThis as unknown as Greeter).greet(n), name);

describe('React Native mocking', () => {
  afterEach(async () => {
    await browser.reactNative.restoreAllMocks();
  });

  it('should mock globalThis.greet and override its return value', async () => {
    const mock = await browser.reactNative.mock('greet');
    await mock.mockReturnValue('mocked!');
    expect(await callGreet('x')).toBe('mocked!');
  });

  it('should record call history through update()', async () => {
    const mock = await browser.reactNative.mock('greet');
    await callGreet('alice');
    await callGreet('bob');
    await mock.update();
    expect(mock.mock.calls.length).toBe(2);
    expect(mock.mock.calls[0]).toEqual(['alice']);
  });

  it('should report isMockFunction true for a created mock', async () => {
    const mock = await browser.reactNative.mock('greet');
    expect(browser.reactNative.isMockFunction(mock)).toBe(true);
    expect(browser.reactNative.isMockFunction('greet')).toBe(true);
  });

  it('should restore the original after restoreAllMocks', async () => {
    await browser.reactNative.mock('greet');
    await browser.reactNative.restoreAllMocks();
    expect(browser.reactNative.isMockFunction('greet')).toBe(false);
    expect(await callGreet('real')).toBe('Hello, real!');
  });
});
