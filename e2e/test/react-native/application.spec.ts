import { $, browser, expect } from '@wdio/globals';
import '@wdio/native-types';

// Native UI interaction over the Appium session — exercises the counter fixture via
// accessibility ids (the `~` selector maps to accessibilityLabel / content-desc).
describe('React Native application', () => {
  it('should display the counter starting at 0', async () => {
    const counter = await $('~counter');
    await counter.waitForDisplayed({ timeout: 30000 });
    expect(await counter.getText()).toBe('0');
  });

  it('should increment the counter on tap', async () => {
    // Assert the delta, not an absolute value: mochaOpts.retries re-runs in the same Appium
    // session without resetting app state, so a retry after a successful click would see the
    // counter already advanced. Reading the start value keeps the retry self-consistent.
    const counter = await $('~counter');
    const start = Number(await counter.getText());
    await (await $('~increment-button')).click();
    await browser.waitUntil(async () => Number(await counter.getText()) === start + 1, { timeout: 10000 });
    expect(Number(await counter.getText())).toBe(start + 1);
  });

  it('should reset the counter', async () => {
    await (await $('~increment-button')).click();
    await (await $('~reset-button')).click();
    // Poll like the increment test: Appium reads the accessibility tree asynchronously, so
    // the click resolves before UiAutomator2 sees the re-rendered counter.
    const counter = await $('~counter');
    await browser.waitUntil(async () => (await counter.getText()) === '0', { timeout: 10000 });
    expect(await counter.getText()).toBe('0');
  });
});
