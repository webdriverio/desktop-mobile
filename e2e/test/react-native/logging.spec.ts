import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

import { el } from './helpers.js';

// The service forwards JS console.* (via Runtime.consoleAPICalled) and native
// logcat into the WDIO logger. Forwarding is fire-and-forget, so these specs assert
// the instrumented code paths run without error rather than scraping the log output.
describe('React Native logging', () => {
  it('should run an execute that emits a JS console log', async () => {
    const result = await browser.reactNative.execute(() => {
      console.log('wdio-rn-log-marker');
      console.warn('wdio-rn-warn-marker');
      return 'logged';
    });
    expect(result).toBe('logged');
  });

  it('should emit a DeviceEventEmitter event without throwing', async () => {
    await browser.reactNative.emitEvent('wdio:setCount', 7);
    const counter = await el('counter');
    await browser.waitUntil(async () => (await counter.getText()) === '7', { timeout: 10000 });
    expect(await counter.getText()).toBe('7');
  });
});
