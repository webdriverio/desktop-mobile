// Internal shared test helpers

/**
 * Import a module once in a `beforeAll` with a generous hook timeout, returning an accessor.
 *
 * A cold `await import()` can exceed vitest's default 5s test timeout on slow CI; running it in
 * `beforeAll` puts the long timeout on setup rather than every test.
 */
export function coldImport<T>(importer: () => Promise<T>, timeoutMs = 20000): () => T {
  let mod: T;
  beforeAll(async () => {
    mod = await importer();
  }, timeoutMs);
  return () => mod;
}

// Captured once at import, before any test can override it, so restorePlatform always returns the
// real platform even when a test sets it in both a beforeEach and the test body.
const REAL_PLATFORM = process.platform;

/** Override `process.platform` for a test. Pair every use with `restorePlatform()` in `afterEach`. */
export function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Restore `process.platform` to the real value captured at import. */
export function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
}
