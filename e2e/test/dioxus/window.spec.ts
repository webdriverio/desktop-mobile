import { browser, expect } from '@wdio/globals';

describe('Dioxus window management', () => {
  it('should list windows', async () => {
    const windows = await browser.dioxus.listWindows();
    expect(Array.isArray(windows)).toBe(true);
    expect(windows.length).toBeGreaterThan(0);
  });

  it('should have a main window', async () => {
    const windows = await browser.dioxus.listWindows();
    expect(windows).toContain('main');
  });

  it('should switch to main window', async () => {
    await expect(browser.dioxus.switchWindow('main')).resolves.not.toThrow();
  });
});
