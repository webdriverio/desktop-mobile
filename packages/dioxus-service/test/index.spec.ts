import { describe, expect, it } from 'vitest';

describe('@wdio/dioxus-service public exports', () => {
  it('should expose the worker service as the default export', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default).toBeTypeOf('function');
    expect(mod.default.name).toBe('DioxusWorkerService');
  });

  it('should expose the launch service as the named "launcher" export', async () => {
    const { launcher } = await import('../src/index.js');
    expect(launcher).toBeTypeOf('function');
    expect(launcher.name).toBe('DioxusLaunchService');
  });

  it('should re-export the linuxExternalProviderUnsupported helper', async () => {
    const { linuxExternalProviderUnsupported } = await import('../src/index.js');
    const err = linuxExternalProviderUnsupported();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("driverProvider: 'external'");
    expect(err.message).toContain('Linux');
    expect(err.message).toContain("'embedded'");
  });

  it('should re-export SevereServiceError', async () => {
    const { SevereServiceError } = await import('../src/index.js');
    expect(SevereServiceError).toBeTypeOf('function');
  });
});
