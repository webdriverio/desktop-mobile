import { describe, expect, it } from 'vitest';

import { BaseLauncher } from '../src/baseLauncher.js';

// Concrete subclass for testing — BaseLauncher itself is abstract by intent
// but TypeScript's `abstract` keyword on the class without any abstract
// members makes it a marker; we still need a subclass to instantiate.
class TestLauncher extends BaseLauncher {
  exposePortManager() {
    return this.portManager;
  }

  exposeDriverPool() {
    return this.driverPool;
  }

  async stopAll() {
    return this.stopAllDrivers();
  }
}

describe('BaseLauncher', () => {
  it('initialises a PortManager with default base ports', () => {
    const launcher = new TestLauncher();
    const pm = launcher.exposePortManager();
    expect(pm.getUsedPorts()).toEqual([]);
  });

  it('honours custom basePort / baseNativePort', async () => {
    const launcher = new TestLauncher({ basePort: 9000, baseNativePort: 9001 });
    const port = await launcher.exposePortManager().allocatePort();
    expect(port).toBe(9000);
  });

  it('initialises an empty DriverPool', () => {
    const launcher = new TestLauncher();
    expect(launcher.exposeDriverPool().getStatus()).toEqual({
      running: false,
      count: 0,
      identifiers: [],
    });
  });

  it('stopAllDrivers resolves on an empty pool', async () => {
    const launcher = new TestLauncher();
    await expect(launcher.stopAll()).resolves.not.toThrow();
  });
});
