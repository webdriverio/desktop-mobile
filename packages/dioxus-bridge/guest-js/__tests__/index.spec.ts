import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('@wdio/dioxus-bridge guest-js', () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalDioxus: typeof window.__WDIO_DIOXUS__;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalDioxus = window.__WDIO_DIOXUS__;
    // Re-import the module each test so the install side-effect re-runs.
    vi.resetModules();
  });

  afterEach(() => {
    if (originalFetch === undefined) {
      (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    } else {
      globalThis.fetch = originalFetch;
    }
    window.__WDIO_DIOXUS__ = originalDioxus;
    vi.restoreAllMocks();
  });

  it('should install invoke on window.__WDIO_DIOXUS__', async () => {
    await import('../index.js');
    expect(window.__WDIO_DIOXUS__).toBeDefined();
    expect(typeof window.__WDIO_DIOXUS__?.invoke).toBe('function');
  });

  it('should POST to wdio://invoke with the command + args envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, value: 'pong' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { invoke } = await import('../index.js');
    await invoke('__ping', { foo: 'bar' });

    expect(fetchMock).toHaveBeenCalledWith(
      'wdio://invoke',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '__ping', args: { foo: 'bar' } }),
      }),
    );
  });

  it('should default args to null when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, value: null }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { invoke } = await import('../index.js');
    await invoke('__ping');

    const lastCall = fetchMock.mock.calls[0];
    const body = JSON.parse(lastCall?.[1].body as string);
    expect(body.args).toBeNull();
  });

  it('should resolve with the response value on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, value: { greeting: 'hello' } }),
    }) as unknown as typeof fetch;

    const { invoke } = await import('../index.js');
    await expect(invoke('echo', { greeting: 'hello' })).resolves.toEqual({ greeting: 'hello' });
  });

  it('should reject with the response error message on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'unknown wdio:// command: nope' }),
    }) as unknown as typeof fetch;

    const { invoke } = await import('../index.js');
    await expect(invoke('nope')).rejects.toThrow(/unknown wdio:\/\/ command: nope/);
  });

  it('should reject with a fallback message when the error string is absent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false }),
    }) as unknown as typeof fetch;

    const { invoke } = await import('../index.js');
    await expect(invoke('nope')).rejects.toThrow(/wdio:\/\/ invoke failed/);
  });
});
