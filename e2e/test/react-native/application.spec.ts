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
    await (await $('~increment-button')).click();
    const counter = await $('~counter');
    await browser.waitUntil(async () => (await counter.getText()) === '1', { timeout: 10000 });
    expect(await counter.getText()).toBe('1');
  });

  it('should reset the counter', async () => {
    await (await $('~increment-button')).click();
    await (await $('~reset-button')).click();
    expect(await (await $('~counter')).getText()).toBe('0');
  });
});
