import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ opts: [] as Array<Record<string, unknown>> }));

vi.mock('@wdio/native-cdp-bridge', () => ({
  CdpBridge: class {
    constructor(options: Record<string, unknown>) {
      h.opts.push(options);
    }
  },
}));

import { createHermesBridge, metroOrigin } from '../src/hermesBridge.js';
import { selectHermesTarget } from '../src/hermesTarget.js';

beforeEach(() => {
  h.opts.length = 0;
});

describe('metroOrigin', () => {
  it('builds the http origin the Fusebox CSRF check requires', () => {
    expect(metroOrigin('localhost', 8081)).toBe('http://localhost:8081');
    expect(metroOrigin('10.0.2.2', 9000)).toBe('http://10.0.2.2:9000');
  });
});

describe('createHermesBridge', () => {
  it('defaults host/port to Metro and derives the matching origin', () => {
    createHermesBridge();
    expect(h.opts[0]).toMatchObject({ host: 'localhost', port: 8081, origin: 'http://localhost:8081' });
  });

  it('injects the Hermes target selector', () => {
    createHermesBridge();
    expect(h.opts[0].selectTarget).toBe(selectHermesTarget);
  });

  it('honours a custom host/port and derives the matching origin', () => {
    createHermesBridge({ host: '10.0.2.2', port: 9000 });
    expect(h.opts[0]).toMatchObject({ host: '10.0.2.2', port: 9000, origin: 'http://10.0.2.2:9000' });
  });

  it('does not override an explicit origin', () => {
    createHermesBridge({ origin: 'http://custom:1234' });
    expect(h.opts[0].origin).toBe('http://custom:1234');
  });

  it('passes other CdpBridge options through', () => {
    createHermesBridge({ connectionRetryCount: 7, waitInterval: 250 });
    expect(h.opts[0]).toMatchObject({ connectionRetryCount: 7, waitInterval: 250 });
  });
});
