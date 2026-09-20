// Internal shared test helpers (@repo/test-utils, private — never published).

/**
 * Import a module once in a `beforeAll` with a generous hook timeout, returning an accessor.
 *
 * A first `await import('…')` cold-imports and transforms the whole module graph, which can exceed
 * vitest's default 5s test timeout on slow CI. Doing it once in `beforeAll` scopes the long timeout
 * to setup and keeps the assertions on the default. Uses the ambient `beforeAll` (vitest
 * `globals: true`), so this stays a no-runtime-dep helper.
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
