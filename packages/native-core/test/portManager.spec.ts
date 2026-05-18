import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortManager } from '../src/portManager.js';

vi.mock('get-port', () => ({
  default: vi.fn(async ({ port, exclude = [] }: { port: number; exclude: number[] }) => {
    let candidate = port;
    while (exclude.includes(candidate) || usedPorts.has(candidate)) {
      candidate++;
    }
    return candidate;
  }),
}));

const usedPorts = new Set<number>();

describe('PortManager', () => {
  let manager: PortManager;

  beforeEach(() => {
    manager = new PortManager(4444, 4445);
    usedPorts.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('allocatePort', () => {
    it('should allocate a single port', async () => {
      const port = await manager.allocatePort();
      expect(port).toBe(4444);
      expect(manager.getUsedPorts()).toContain(4444);
    });

    it('should allocate a port with preferred port', async () => {
      const port = await manager.allocatePort(5000);
      expect(port).toBe(5000);
      expect(manager.getUsedPorts()).toContain(5000);
    });

    it('should track allocated ports', async () => {
      await manager.allocatePort(4444);
      await manager.allocatePort(4445);
      await manager.allocatePort(4446);

      expect(manager.getUsedPorts()).toEqual([4444, 4445, 4446]);
    });
  });

  describe('allocatePortPair', () => {
    it('should allocate a pair of ports', async () => {
      const pair = await manager.allocatePortPair();
      expect(pair.port).toBe(4444);
      expect(pair.nativePort).toBe(4445);
    });

    it('should allocate a pair with preferred ports', async () => {
      const pair = await manager.allocatePortPair(5000, 5001);
      expect(pair.port).toBe(5000);
      expect(pair.nativePort).toBe(5001);
    });

    it('should track both ports in pair', async () => {
      await manager.allocatePortPair();
      expect(manager.getUsedPorts()).toContain(4444);
      expect(manager.getUsedPorts()).toContain(4445);
    });

    it('should release first port if second allocation fails', async () => {
      const getPort = await import('get-port');
      const mockGetPort = vi.mocked(getPort.default);
      let callCount = 0;
      mockGetPort.mockImplementation(async ({ port }: { port: number }) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('no ports available');
        }
        return port;
      });

      await expect(manager.allocatePortPair(5000, 5001)).rejects.toThrow('no ports available');
      expect(manager.getUsedPorts()).not.toContain(5000);
      expect(manager.getUsedPorts()).toHaveLength(0);

      // Restore default mock implementation
      mockGetPort.mockImplementation(async ({ port, exclude = [] }: { port: number; exclude: number[] }) => {
        let candidate = port;
        while (exclude.includes(candidate) || usedPorts.has(candidate)) {
          candidate++;
        }
        return candidate;
      });
    });
  });

  describe('allocatePorts', () => {
    it('should allocate multiple port pairs', async () => {
      const pairs = await manager.allocatePorts(3);

      expect(pairs).toHaveLength(3);
      expect(pairs[0].port).toBeTypeOf('number');
      expect(pairs[0].nativePort).toBeTypeOf('number');
      expect(pairs[1].port).toBeTypeOf('number');
      expect(pairs[1].nativePort).toBeTypeOf('number');
    });

    it('should track all allocated ports', async () => {
      await manager.allocatePorts(2);
      expect(manager.getUsedPorts().length).toBe(4);
    });
  });

  describe('releasePort', () => {
    it('should release a port', async () => {
      await manager.allocatePort(4444);
      manager.releasePort(4444);
      expect(manager.getUsedPorts()).not.toContain(4444);
    });
  });

  describe('releasePorts', () => {
    it('should release multiple ports', async () => {
      await manager.allocatePorts(2);
      manager.releasePorts([4444, 4445]);
      expect(manager.getUsedPorts()).not.toContain(4444);
      expect(manager.getUsedPorts()).not.toContain(4445);
    });
  });

  describe('clear', () => {
    it('should clear all ports', async () => {
      await manager.allocatePorts(3);
      manager.clear();
      expect(manager.getUsedPorts()).toEqual([]);
    });
  });
});
