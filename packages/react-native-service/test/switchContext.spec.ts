import { describe, expect, it, vi } from 'vitest';

import { listWindows, switchWindow } from '../src/commands/switchContext.js';

describe('listWindows', () => {
  it('should return the Appium contexts array of strings', async () => {
    const contexts = ['NATIVE_APP', 'WEBVIEW_com.example'];
    const browser = { getContexts: vi.fn(async () => contexts) } as unknown as WebdriverIO.Browser;
    await expect(listWindows(browser)).resolves.toEqual(contexts);
  });

  it('should normalise ContextInfo objects to their id strings', async () => {
    const contexts = [{ id: 'NATIVE_APP' }, { id: 'WEBVIEW_com.example', title: 'X' }];
    const browser = { getContexts: vi.fn(async () => contexts) } as unknown as WebdriverIO.Browser;
    await expect(listWindows(browser)).resolves.toEqual(['NATIVE_APP', 'WEBVIEW_com.example']);
  });
});

describe('switchWindow', () => {
  it('should delegate to browser.switchContext with the target context', async () => {
    const switchContext = vi.fn(async () => undefined);
    const browser = { switchContext } as unknown as WebdriverIO.Browser;
    await switchWindow(browser, 'WEBVIEW_com.example');
    expect(switchContext).toHaveBeenCalledWith('WEBVIEW_com.example');
  });
});
