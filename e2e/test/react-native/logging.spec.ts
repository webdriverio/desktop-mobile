import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

import { getLogDirName, readWdioLogs } from '../../lib/utils.js';
import { el } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const getLogDir = () => join(__dirname, '../../logs', getLogDirName('standard', 'react-native'));

// The service forwards two channels into the WDIO log: the app's JS/Metro console (frontend,
// via Runtime.consoleAPICalled) and native logcat/syslog (backend). The conf enables both;
// this asserts the frontend channel actually reaches the WDIO log output.
describe('React Native logging', () => {
  it('should forward a JS console log into the WDIO output (frontend capture)', async () => {
    const marker = 'wdio-rn-frontend-marker';
    // execute passes the Hermes realm as the first arg, then the user args — so the marker is
    // the SECOND param. (Passing globalThis to console.* makes Hermes serialise it for the
    // consoleAPICalled event and throw on a HostObject's Symbol.toStringTag.)
    const result = await browser.reactNative.execute((_rn, m) => {
      console.info(m);
      return m;
    }, marker);
    expect(result).toBe(marker);
    // Forwarding is async (CDP event → WDIO logger → log file), so poll the output.
    await browser.waitUntil(async () => (await readWdioLogs(getLogDir())).includes(marker), {
      timeout: 15000,
      interval: 500,
      timeoutMsg: `frontend console marker '${marker}' not found in the WDIO log`,
    });
  });

  it('should emit a DeviceEventEmitter event without throwing', async () => {
    await browser.reactNative.emitEvent('wdio:setCount', 7);
    const counter = await el('counter');
    await browser.waitUntil(async () => (await counter.getText()) === '7', { timeout: 10000 });
    expect(await counter.getText()).toBe('7');
  });
});
