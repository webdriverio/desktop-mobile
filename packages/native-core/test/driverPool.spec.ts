import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stopCalls: [] as string[],
  failingStops: new Set<string>(),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

vi.mock('../src/driverProcess.js', () => ({
  DriverProcess: class {
    #identifier = '';
    async start(options: { identifier: string }) {
      this.#identifier = options.identifier;
    }
    async stop() {
      h.stopCalls.push(this.#identifier);
      if (h.failingStops.has(this.#identifier)) {
        throw new Error(`kill failed for ${this.#identifier}`);
      }
    }
    isRunning() {
      return true;
    }
  },
}));

import { DriverPool } from '../src/driverPool.js';

async function startDrivers(pool: DriverPool, identifiers: string[]) {
  for (const [i, identifier] of identifiers.entries()) {
    await pool.startDriver({
      mode: 'multiremote',
      identifier,
      port: 4444 + i * 2,
      nativePort: 4445 + i * 2,
      driverPath: '/usr/bin/fake-driver',
    });
  }
}

afterEach(() => {
  h.stopCalls.length = 0;
  h.failingStops.clear();
});

describe('DriverPool.stopAll', () => {
  it('should stop every driver and empty the pool', async () => {
    const pool = new DriverPool();
    await startDrivers(pool, ['a', 'b']);

    await pool.stopAll();

    expect(h.stopCalls).toEqual(['a', 'b']);
    expect(pool.getStatus().identifiers).toEqual([]);
  });

  it('should still stop the other drivers and empty the pool when one stop rejects', async () => {
    const pool = new DriverPool();
    await startDrivers(pool, ['a', 'b', 'c']);
    h.failingStops.add('a');

    await expect(pool.stopAll()).resolves.toBeUndefined();

    expect(h.stopCalls).toEqual(['a', 'b', 'c']);
    expect(pool.getStatus().identifiers).toEqual([]);
    expect(pool.getDriver('a')).toBeUndefined();
  });
});
