import { coldImport } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

describe('@wdio/electrobun-service public exports', () => {
  const mod = coldImport(() => import('../src/index.js'));

  it('should expose the worker service as the default export', () => {
    expect(mod().default).toBeTypeOf('function');
    expect(mod().default.name).toBe('ElectrobunWorkerService');
  });

  it('should expose the launch service as the named "launcher" export', () => {
    expect(mod().launcher).toBeTypeOf('function');
    expect(mod().launcher.name).toBe('ElectrobunLaunchService');
  });

  it('should re-export the cefRendererRequired helper', () => {
    expect(mod().cefRendererRequired).toBeTypeOf('function');
    const err = mod().cefRendererRequired('darwin');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('CEF renderer');
  });

  it('should re-export the deeplinkUnsupportedOnPlatform helper', () => {
    expect(mod().deeplinkUnsupportedOnPlatform).toBeTypeOf('function');
  });

  it('should re-export SevereServiceError', () => {
    expect(mod().SevereServiceError).toBeTypeOf('function');
  });

  it('should expose the standalone session helpers', () => {
    expect(mod().startWdioSession).toBeTypeOf('function');
    expect(mod().cleanupWdioSession).toBeTypeOf('function');
    expect(mod().createElectrobunCapabilities).toBeTypeOf('function');
  });
});
