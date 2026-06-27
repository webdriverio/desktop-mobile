import { afterEach, describe, expect, it, vi } from 'vitest';
import { nonChromeBrowserNameError, probeDevServerReachable } from '../src/browserMode.js';

describe('nonChromeBrowserNameError', () => {
  it('returns undefined when browserName is unset', () => {
    expect(nonChromeBrowserNameError(undefined)).toBeUndefined();
  });

  it('returns undefined for chrome (case-insensitive)', () => {
    expect(nonChromeBrowserNameError('chrome')).toBeUndefined();
    expect(nonChromeBrowserNameError('Chrome')).toBeUndefined();
  });

  it('returns an actionable message for a non-chrome browserName', () => {
    const message = nonChromeBrowserNameError('firefox');
    expect(message).toContain("got 'firefox'");
    expect(message).toContain("'chrome'");
  });

  it('honours a custom allow list', () => {
    expect(nonChromeBrowserNameError('electron', ['chrome', 'electron'])).toBeUndefined();
    const message = nonChromeBrowserNameError('firefox', ['chrome', 'electron']);
    expect(message).toContain("'chrome' or 'electron'");
  });
});

describe('probeDevServerReachable', () => {
  const url = 'http://localhost:1420';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Ok when the dev server responds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD' }));
  });

  it('resolves Ok even on a 404/405 (server is listening)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(true);
  });

  it('resolves Err with an actionable message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.error.message;
    expect(message).toContain(`Dev server not reachable at ${url}`);
    expect(message).toContain('is it running?');
  });
});
