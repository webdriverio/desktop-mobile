import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

import { el } from './helpers.js';

// Native UI interaction over the Appium session — exercises the counter fixture by testID
// (see el(): Android resource-id / iOS accessibilityIdentifier). We avoid accessibilityLabel
// because on iOS it shadows the counter's value, breaking getText().
describe('React Native application', () => {
  it('should display the counter starting at 0', async () => {
    const counter = await el('counter');
    await counter.waitForDisplayed({ timeout: 30000 });
    expect(await counter.getText()).toBe('0');
  });

  it('should increment the counter on tap', async () => {
    // Assert the delta, not an absolute value: mochaOpts.retries re-runs in the same Appium
    // session without resetting app state, so a retry after a successful click would see the
    // counter already advanced. Reading the start value keeps the retry self-consistent.
    const counter = await el('counter');
    const start = Number(await counter.getText());
    await (await el('increment-button')).click();
    await browser.waitUntil(async () => Number(await counter.getText()) === start + 1, { timeout: 10000 });
    expect(Number(await counter.getText())).toBe(start + 1);
  });

  it('should reset the counter', async () => {
    await (await el('increment-button')).click();
    await (await el('reset-button')).click();
    // Poll like the increment test: Appium reads the accessibility tree asynchronously, so
    // the click resolves before UiAutomator2 sees the re-rendered counter.
    const counter = await el('counter');
    await browser.waitUntil(async () => (await counter.getText()) === '0', { timeout: 10000 });
    expect(await counter.getText()).toBe('0');
  });
});
