import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn());
vi.mock('../src/metroProcess.js', () => ({ probeMetroStatus: probe }));

import { checkMetroReachable, reactNativeDoctorChecks } from '../src/diagnostics.js';

afterEach(() => vi.clearAllMocks());

describe('checkMetroReachable', () => {
  it('should report ok when Metro answers /status', async () => {
    probe.mockResolvedValueOnce(true);
    expect(await checkMetroReachable('127.0.0.1', 8081)()).toMatchObject({ status: 'ok', category: 'Metro' });
  });

  it('should warn with an actionable hint when Metro is down', async () => {
    probe.mockResolvedValueOnce(false);
    const r = await checkMetroReachable('127.0.0.1', 8081)();
    expect(r.status).toBe('warn');
    expect(r.details).toMatch(/manageMetro/);
  });

  it('should probe the configured host, not a hardcoded localhost', async () => {
    probe.mockResolvedValueOnce(true);
    await checkMetroReachable('my-metro-box.lan', 8081)();
    expect(probe).toHaveBeenCalledWith(8081, 'my-metro-box.lan');
  });
});

describe('reactNativeDoctorChecks', () => {
  it('should bundle the Metro check for the configured host/port', () => {
    expect(reactNativeDoctorChecks('127.0.0.1', 8088)).toHaveLength(1);
  });
});
