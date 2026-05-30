import { describe, expect, it } from 'vitest';

describe('@wdio/electrobun-service public exports', () => {
  it('should expose the worker service as the default export', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default).toBeTypeOf('function');
    expect(mod.default.name).toBe('ElectrobunWorkerService');
  });

  it('should expose the launch service as the named "launcher" export', async () => {
    const { launcher } = await import('../src/index.js');
    expect(launcher).toBeTypeOf('function');
    expect(launcher.name).toBe('ElectrobunLaunchService');
  });

  it('should re-export the cefRendererRequired helper', async () => {
    const { cefRendererRequired } = await import('../src/index.js');
    expect(cefRendererRequired).toBeTypeOf('function');
    const err = cefRendererRequired('darwin');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('CEF renderer');
  });

  it('should re-export the deeplinkUnsupportedOnPlatform helper', async () => {
    const { deeplinkUnsupportedOnPlatform } = await import('../src/index.js');
    expect(deeplinkUnsupportedOnPlatform).toBeTypeOf('function');
  });

  it('should re-export SevereServiceError', async () => {
    const { SevereServiceError } = await import('../src/index.js');
    expect(SevereServiceError).toBeTypeOf('function');
  });

  it('should expose the standalone session helpers', async () => {
    const mod = await import('../src/index.js');
    expect(mod.startWdioSession).toBeTypeOf('function');
    expect(mod.cleanupWdioSession).toBeTypeOf('function');
    expect(mod.createElectrobunCapabilities).toBeTypeOf('function');
  });
});
