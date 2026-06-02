import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Electrobun application', () => {
  it('should launch and render the fixture app title', async () => {
    const title = await browser.$('#app-title');
    await expect(title).toExist();
    await expect(title).toHaveText(expect.stringContaining('Electrobun'));
  });

  it('should have a running webview with a URL', async () => {
    const url = await browser.getUrl();
    expect(typeof url).toBe('string');
  });

  it('should start with the counter at zero', async () => {
    const counter = await browser.$('#counter');
    await expect(counter).toHaveText('0');
  });

  it('should increment the counter when the increment button is clicked', async () => {
    await browser.$('#reset-button').click();
    await browser.$('#increment-button').click();
    await expect(browser.$('#counter')).toHaveText('1');
    await expect(browser.$('#status')).toHaveText(expect.stringContaining('Incremented'));
  });

  it('should decrement the counter when the decrement button is clicked', async () => {
    await browser.$('#reset-button').click();
    await browser.$('#decrement-button').click();
    await expect(browser.$('#counter')).toHaveText('-1');
    await expect(browser.$('#status')).toHaveText(expect.stringContaining('Decremented'));
  });

  it('should reset the counter when the reset button is clicked', async () => {
    await browser.$('#increment-button').click();
    await browser.$('#increment-button').click();
    await browser.$('#reset-button').click();
    await expect(browser.$('#counter')).toHaveText('0');
    await expect(browser.$('#status')).toHaveText(expect.stringContaining('reset'));
  });
});
