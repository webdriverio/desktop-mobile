import { beforeAll, describe, expect, it } from 'vitest';

describe('@wdio/dioxus-service public exports', () => {
  // Cold-importing the whole module graph can exceed the default 5s on slow CI; do it once here
  // with a longer hook timeout so the export assertions below stay at the default.
  let mod: typeof import('../src/index.js');
  beforeAll(async () => {
    mod = await import('../src/index.js');
  }, 20000);

  it('should expose the worker service as the default export', () => {
    expect(mod.default).toBeTypeOf('function');
    expect(mod.default.name).toBe('DioxusWorkerService');
  });

  it('should expose the launch service as the named "launcher" export', () => {
    expect(mod.launcher).toBeTypeOf('function');
    expect(mod.launcher.name).toBe('DioxusLaunchService');
  });

  it('should re-export the linuxExternalProviderUnsupported helper', () => {
    const err = mod.linuxExternalProviderUnsupported();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("driverProvider: 'external'");
    expect(err.message).toContain('Linux');
    expect(err.message).toContain("'embedded'");
  });

  it('should re-export SevereServiceError', () => {
    expect(mod.SevereServiceError).toBeTypeOf('function');
  });
});
