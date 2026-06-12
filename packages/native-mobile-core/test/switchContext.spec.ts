import { describe, expect, it, vi } from 'vitest';

import { listContexts, switchContext } from '../src/switchContext.js';

describe('listContexts', () => {
  it('should return plain string contexts as-is', async () => {
    const browser = {
      getContexts: vi.fn().mockResolvedValue(['NATIVE_APP', 'WEBVIEW_x']),
    } as unknown as WebdriverIO.Browser;
    expect(await listContexts(browser)).toEqual(['NATIVE_APP', 'WEBVIEW_x']);
  });

  it('should normalise ContextInfo objects to their id', async () => {
    const browser = {
      getContexts: vi.fn().mockResolvedValue([{ id: 'NATIVE_APP' }, { id: 'FLUTTER' }]),
    } as unknown as WebdriverIO.Browser;
    expect(await listContexts(browser)).toEqual(['NATIVE_APP', 'FLUTTER']);
  });
});

describe('switchContext', () => {
  it('should delegate to browser.switchContext', async () => {
    // Local mock of the WDIO browser command, renamed to avoid shadowing the imported switchContext.
    const browserSwitchContext = vi.fn().mockResolvedValue(undefined);
    await switchContext({ switchContext: browserSwitchContext } as unknown as WebdriverIO.Browser, 'FLUTTER');
    expect(browserSwitchContext).toHaveBeenCalledWith('FLUTTER');
  });
});
