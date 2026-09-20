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

/** Override `process.platform` for a test; returns a restore function to the original value. */
export function mockPlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => Object.defineProperty(process, 'platform', { value: original, configurable: true });
}
