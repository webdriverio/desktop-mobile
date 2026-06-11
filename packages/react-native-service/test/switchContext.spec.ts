import { describe, expect, it, vi } from 'vitest';

import { listContexts, switchContext } from '../src/commands/switchContext.js';

describe('listContexts', () => {
  it('should return the Appium contexts array of strings', async () => {
    const contexts = ['NATIVE_APP', 'WEBVIEW_com.example'];
    const browser = { getContexts: vi.fn(async () => contexts) } as unknown as WebdriverIO.Browser;
    await expect(listContexts(browser)).resolves.toEqual(contexts);
  });

  it('should normalise ContextInfo objects to their id strings', async () => {
    const contexts = [{ id: 'NATIVE_APP' }, { id: 'WEBVIEW_com.example', title: 'X' }];
    const browser = { getContexts: vi.fn(async () => contexts) } as unknown as WebdriverIO.Browser;
    await expect(listContexts(browser)).resolves.toEqual(['NATIVE_APP', 'WEBVIEW_com.example']);
  });
});

describe('switchContext', () => {
  it('should delegate to browser.switchContext with the target context', async () => {
    const browserSwitchContext = vi.fn(async () => undefined);
    const browser = { switchContext: browserSwitchContext } as unknown as WebdriverIO.Browser;
    await switchContext(browser, 'WEBVIEW_com.example');
    expect(browserSwitchContext).toHaveBeenCalledWith('WEBVIEW_com.example');
  });
});
