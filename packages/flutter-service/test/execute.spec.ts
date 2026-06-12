import { describe, expect, it, vi } from 'vitest';

import { executeScript } from '../src/commands/execute.js';
import type { VmServiceClient } from '../src/vmService.js';

const makeClient = (invokeResult: unknown): VmServiceClient =>
  ({
    getMainIsolateId: vi.fn().mockResolvedValue('i'),
    callServiceExtension: vi.fn().mockResolvedValue(invokeResult),
  }) as unknown as VmServiceClient;

describe('executeScript', () => {
  it('should invoke a registered handler with JSON args and return its value', async () => {
    const client = makeClient({ found: true, value: 5 });
    expect(await executeScript(client, 'add', [2, 3])).toBe(5);
    expect(client.callServiceExtension).toHaveBeenCalledWith('ext.wdio.invoke', {
      isolateId: 'i',
      name: 'add',
      args: JSON.stringify([2, 3]),
    });
  });

  it('should default args to an empty list', async () => {
    const client = makeClient({ found: true, value: 'wdio-flutter-fixture' });
    expect(await executeScript(client, 'marker')).toBe('wdio-flutter-fixture');
    expect(client.callServiceExtension).toHaveBeenCalledWith('ext.wdio.invoke', {
      isolateId: 'i',
      name: 'marker',
      args: '[]',
    });
  });

  it('should throw when a registered handler itself throws', async () => {
    const client = makeClient({ found: true, error: 'boom' });
    await expect(executeScript(client, 'bad')).rejects.toThrow(/threw: boom/);
  });

  it('should throw a listing error when no handler is registered', async () => {
    const client = makeClient({ found: false, registered: ['marker', 'add'] });
    await expect(executeScript(client, 'nope')).rejects.toThrow(
      /no handler 'nope' is registered\. Registered handlers: marker, add/,
    );
  });

  it('should say "(none registered)" when there are no handlers', async () => {
    const client = makeClient({ found: false, registered: [] });
    await expect(executeScript(client, 'nope')).rejects.toThrow(/Registered handlers: \(none registered\)/);
  });
});
