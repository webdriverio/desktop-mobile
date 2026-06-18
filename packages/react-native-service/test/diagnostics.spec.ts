import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn());
vi.mock('../src/metroProcess.js', () => ({ probeMetroStatus: probe }));

import { checkMetroReachable, reactNativeDoctorChecks } from '../src/diagnostics.js';

afterEach(() => vi.clearAllMocks());

describe('checkMetroReachable', () => {
  it('should report ok when Metro answers /status', async () => {
    probe.mockResolvedValueOnce(true);
    expect(await checkMetroReachable(8081)()).toMatchObject({ status: 'ok', category: 'Metro' });
  });

  it('should warn with an actionable hint when Metro is down', async () => {
    probe.mockResolvedValueOnce(false);
    const r = await checkMetroReachable(8081)();
    expect(r.status).toBe('warn');
    expect(r.details).toMatch(/manageMetro/);
  });
});

describe('reactNativeDoctorChecks', () => {
  it('should bundle the Metro check for the configured port', () => {
    expect(reactNativeDoctorChecks(8088)).toHaveLength(1);
  });
});
