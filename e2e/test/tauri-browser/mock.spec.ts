import { $ } from '@wdio/globals';
import { browser } from '@wdio/tauri-service';

describe('Tauri browser-mode E2E', () => {
  it('should intercept a value-returning invoke via browser.tauri.mock', async () => {
    const mock = await browser.tauri.mock('get_app_version');
    await mock.mockResolvedValue('99.0.0-browser');

    await $('[data-testid="fetch-version"]').click();

    await browser.waitUntil(async () => (await $('[data-testid="version-output"]').getText()) === '99.0.0-browser', {
      timeout: 5000,
      timeoutMsg: 'expected mocked version to render',
    });

    await mock.update();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('should intercept an invoke with arguments via browser.tauri.mock', async () => {
    const mock = await browser.tauri.mock('greet');
    await mock.mockResolvedValue('Hello, WDIO');

    await $('[data-testid="send-greeting"]').click();

    await browser.waitUntil(
      async () => (await $('[data-testid="greeting-output"]').getText()).includes('Hello, WDIO'),
      { timeout: 5000, timeoutMsg: 'expected mocked greeting to render' },
    );

    await mock.update();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toEqual({ name: 'WDIO' });
  });
});
