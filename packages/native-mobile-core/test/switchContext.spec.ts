import { describe, expect, it, vi } from 'vitest';

import { listWindows, switchWindow } from '../src/switchContext.js';

describe('listWindows', () => {
  it('should return plain string contexts as-is', async () => {
    const browser = {
      getContexts: vi.fn().mockResolvedValue(['NATIVE_APP', 'WEBVIEW_x']),
    } as unknown as WebdriverIO.Browser;
    expect(await listWindows(browser)).toEqual(['NATIVE_APP', 'WEBVIEW_x']);
  });

  it('should normalise ContextInfo objects to their id', async () => {
    const browser = {
      getContexts: vi.fn().mockResolvedValue([{ id: 'NATIVE_APP' }, { id: 'FLUTTER' }]),
    } as unknown as WebdriverIO.Browser;
    expect(await listWindows(browser)).toEqual(['NATIVE_APP', 'FLUTTER']);
  });
});

describe('switchWindow', () => {
  it('should delegate to browser.switchContext', async () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    await switchWindow({ switchContext } as unknown as WebdriverIO.Browser, 'FLUTTER');
    expect(switchContext).toHaveBeenCalledWith('FLUTTER');
  });
});
