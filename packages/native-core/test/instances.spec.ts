import { describe, expect, it, vi } from 'vitest';
import { forEachInstance, type InstanceContext, normaliseInstanceCaps, requireInstance } from '../src/instances.js';

type Caps = { browserName?: string; 'app:options'?: { binary: string } };

describe('normaliseInstanceCaps', () => {
  it('should give each capability in an array its own entry, targeting the caps', () => {
    const first: Caps = { browserName: 'a' };
    const second: Caps = { browserName: 'b' };

    const entries = normaliseInstanceCaps([first, second]);

    expect(entries).toHaveLength(2);
    expect(entries[0].caps).toBe(first);
    expect(entries[0].connectionTarget).toBe(first);
    expect(entries[0].name).toBeUndefined();
    expect(entries[1].caps).toBe(second);
    expect(entries[1].connectionTarget).toBe(second);
  });

  it('should treat a lone capabilities object as one instance, targeting the caps', () => {
    const caps: Caps = { browserName: 'a', 'app:options': { binary: '/app' } };

    const entries = normaliseInstanceCaps(caps);

    expect(entries).toEqual([{ caps, connectionTarget: caps }]);
    expect(entries[0].connectionTarget).toBe(caps);
  });

  it('should target the outer entry of each multiremote instance, not its caps', () => {
    const capsA: Caps = { browserName: 'a' };
    const capsB: Caps = { browserName: 'b' };
    const capabilities = { instanceA: { capabilities: capsA }, instanceB: { capabilities: capsB } };

    const entries = normaliseInstanceCaps(capabilities);

    expect(entries.map(({ name }) => name)).toEqual(['instanceA', 'instanceB']);
    expect(entries[0].caps).toBe(capsA);
    expect(entries[0].connectionTarget).toBe(capabilities.instanceA);
    expect(entries[1].caps).toBe(capsB);
    expect(entries[1].connectionTarget).toBe(capabilities.instanceB);
  });

  it('should leave connection params written through the entries where WebdriverIO reads them', () => {
    const single: Caps = { browserName: 'a' };
    const multiremote = { instanceA: { capabilities: { browserName: 'a' } as Caps } };

    for (const { connectionTarget } of [...normaliseInstanceCaps([single]), ...normaliseInstanceCaps(multiremote)]) {
      connectionTarget.hostname = '127.0.0.1';
      connectionTarget.port = 4444;
    }

    expect(single).toEqual({ browserName: 'a', hostname: '127.0.0.1', port: 4444 });
    expect(multiremote.instanceA).toEqual({
      capabilities: { browserName: 'a' },
      hostname: '127.0.0.1',
      port: 4444,
    });
  });

  it('should treat an object as one capabilities object unless every value is a { capabilities } entry', () => {
    const caps = { browserName: 'a', 'vendor:options': { capabilities: {} } };

    expect(normaliseInstanceCaps(caps as Caps)).toEqual([{ caps, connectionTarget: caps }]);
  });

  it('should return no entries for an empty array', () => {
    expect(normaliseInstanceCaps<Caps>([])).toEqual([]);
  });

  it('should treat an empty object as one capabilities object', () => {
    const caps = {};

    expect(normaliseInstanceCaps<Caps>(caps)).toEqual([{ caps, connectionTarget: caps }]);
  });
});

function multiremoteBrowser(instances: Record<string, WebdriverIO.Browser>): WebdriverIO.MultiRemoteBrowser {
  return {
    isMultiRemote: true,
    instances: Object.keys(instances),
    getInstance: (name: string) => instances[name],
  } as unknown as WebdriverIO.MultiRemoteBrowser;
}

describe('forEachInstance', () => {
  it('should run the callback once on a single session, with the given capabilities', async () => {
    const browser = { isMultiRemote: false } as unknown as WebdriverIO.Browser;
    const capabilities = { browserName: 'a' };
    const callback = vi.fn();

    await forEachInstance(browser, callback, capabilities);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(browser, { caps: capabilities });
  });

  it('should pass undefined caps to a single session given no capabilities', async () => {
    const browser = { isMultiremote: false } as unknown as WebdriverIO.Browser;
    const callback = vi.fn();

    await forEachInstance(browser, callback);

    expect(callback).toHaveBeenCalledWith(browser, { caps: undefined });
  });

  it('should run the callback on each multiremote instance, in order, with its name', async () => {
    const instanceA = {} as WebdriverIO.Browser;
    const instanceB = {} as WebdriverIO.Browser;
    const seen: Array<[WebdriverIO.Browser, string | undefined]> = [];

    await forEachInstance(multiremoteBrowser({ instanceA, instanceB }), (instance, { name }) => {
      seen.push([instance, name]);
    });

    expect(seen).toEqual([
      [instanceA, 'instanceA'],
      [instanceB, 'instanceB'],
    ]);
  });

  it('should recognise a WebdriverIO v9 multiremote browser', async () => {
    const instanceA = {} as WebdriverIO.Browser;
    const browser = {
      isMultiremote: true,
      instances: ['instanceA'],
      getInstance: () => instanceA,
    } as unknown as WebdriverIO.MultiRemoteBrowser;
    const callback = vi.fn();

    await forEachInstance(browser, callback);

    expect(callback).toHaveBeenCalledWith(instanceA, { name: 'instanceA', caps: undefined });
  });

  it('should wait for each callback before starting the next', async () => {
    const order: string[] = [];

    await forEachInstance(
      multiremoteBrowser({ instanceA: {} as WebdriverIO.Browser, instanceB: {} as WebdriverIO.Browser }),
      async (_instance, { name }) => {
        order.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(`end ${name}`);
      },
    );

    expect(order).toEqual(['start instanceA', 'end instanceA', 'start instanceB', 'end instanceB']);
  });

  it("should give a multiremote instance its requested caps over the capabilities' entry", async () => {
    const requested = { browserName: 'requested' };
    const instanceA = { requestedCapabilities: requested } as unknown as WebdriverIO.Browser;
    const contexts: InstanceContext[] = [];

    await forEachInstance(
      multiremoteBrowser({ instanceA }),
      (_instance, context) => {
        contexts.push(context);
      },
      { instanceA: { capabilities: { browserName: 'decoy' } } },
    );

    expect(contexts).toEqual([{ name: 'instanceA', caps: requested }]);
  });

  it('should unwrap a W3C alwaysMatch from the requested caps', async () => {
    const alwaysMatch = { browserName: 'a' };
    const instanceA = { requestedCapabilities: { alwaysMatch, firstMatch: [] } } as unknown as WebdriverIO.Browser;
    const callback = vi.fn();

    await forEachInstance(multiremoteBrowser({ instanceA }), callback);

    expect(callback).toHaveBeenCalledWith(instanceA, { name: 'instanceA', caps: alwaysMatch });
  });

  it("should fall back to the instance's capabilities entry without requested caps", async () => {
    const instanceA = {} as WebdriverIO.Browser;
    const instanceB = {} as WebdriverIO.Browser;
    const capsA = { browserName: 'a' };
    const callback = vi.fn();

    await forEachInstance(multiremoteBrowser({ instanceA, instanceB }), callback, {
      instanceA: { capabilities: capsA },
    });

    expect(callback).toHaveBeenNthCalledWith(1, instanceA, { name: 'instanceA', caps: capsA });
    expect(callback).toHaveBeenNthCalledWith(2, instanceB, { name: 'instanceB', caps: undefined });
  });

  it('should stop at the first callback that rejects', async () => {
    const error = new Error('instance failed');
    const callback = vi.fn().mockRejectedValueOnce(error);

    await expect(
      forEachInstance(
        multiremoteBrowser({ instanceA: {} as WebdriverIO.Browser, instanceB: {} as WebdriverIO.Browser }),
        callback,
      ),
    ).rejects.toBe(error);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should reject, naming the instance, when a listed instance does not resolve', async () => {
    const browser = {
      isMultiRemote: true,
      instances: ['instanceA'],
      getInstance: () => undefined,
    } as unknown as WebdriverIO.MultiRemoteBrowser;
    const callback = vi.fn();

    await expect(forEachInstance(browser, callback)).rejects.toThrow(/no instance named "instanceA"/);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('requireInstance', () => {
  it('should return the named instance', () => {
    const instanceA = {} as WebdriverIO.Browser;

    expect(requireInstance(multiremoteBrowser({ instanceA }), 'instanceA')).toBe(instanceA);
  });

  it('should throw, naming the instance, when the browser has none by that name', () => {
    expect(() => requireInstance(multiremoteBrowser({}), 'missing')).toThrow(
      'Multiremote browser has no instance named "missing"',
    );
  });
});
