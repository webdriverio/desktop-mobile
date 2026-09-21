import { coldImport } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

describe('@wdio/dioxus-service public exports', () => {
  const mod = coldImport(() => import('../src/index.js'));

  it('should expose the worker service as the default export', () => {
    expect(mod().default).toBeTypeOf('function');
    expect(mod().default.name).toBe('DioxusWorkerService');
  });

  it('should expose the launch service as the named "launcher" export', () => {
    expect(mod().launcher).toBeTypeOf('function');
    expect(mod().launcher.name).toBe('DioxusLaunchService');
  });

  it('should re-export the linuxExternalProviderUnsupported helper', () => {
    const err = mod().linuxExternalProviderUnsupported();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("driverProvider: 'external'");
    expect(err.message).toContain('Linux');
    expect(err.message).toContain("'embedded'");
  });

  it('should re-export SevereServiceError', () => {
    expect(mod().SevereServiceError).toBeTypeOf('function');
  });
});
