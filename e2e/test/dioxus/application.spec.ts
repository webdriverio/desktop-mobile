import { browser, expect } from '@wdio/globals';

describe('Dioxus application', () => {
  it('should launch and have a window title', async () => {
    const title = await browser.getTitle();
    expect(typeof title).toBe('string');
  });

  it('should have a running webview', async () => {
    const url = await browser.getUrl();
    expect(typeof url).toBe('string');
  });

  it('should pass command-line args to the app', async () => {
    const args = (await browser.dioxus.execute(({ invoke }) => invoke('get_command_line_args'))) as string[];
    // The WDIO config passes args — they should come back as an array
    expect(Array.isArray(args)).toBe(true);
  });

  it('should render the fixture app UI', async () => {
    const title = await browser.$('#app-title');
    await expect(title).toExist();
  });
});
