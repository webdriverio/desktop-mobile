import { describe, expect, it, vi } from 'vitest';

import { coerceInstance, executeScript } from '../src/commands/execute.js';
import type { VmServiceClient } from '../src/vmService.js';

describe('coerceInstance', () => {
  it('should coerce Null to null', () => {
    expect(coerceInstance({ kind: 'Null', valueAsString: 'null' })).toBeNull();
  });
  it('should coerce Bool to a boolean', () => {
    expect(coerceInstance({ kind: 'Bool', valueAsString: 'true' })).toBe(true);
    expect(coerceInstance({ kind: 'Bool', valueAsString: 'false' })).toBe(false);
  });
  it('should coerce Int/Double to a number', () => {
    expect(coerceInstance({ kind: 'Int', valueAsString: '42' })).toBe(42);
    expect(coerceInstance({ kind: 'Double', valueAsString: '3.5' })).toBe(3.5);
  });
  it('should pass a String through', () => {
    expect(coerceInstance({ kind: 'String', valueAsString: 'hi' })).toBe('hi');
  });
  it('should return the Dart toString() for other kinds', () => {
    expect(coerceInstance({ kind: 'PlainInstance', valueAsString: 'Instance of X' })).toBe('Instance of X');
  });
  it('should return undefined for a missing ref', () => {
    expect(coerceInstance(undefined)).toBeUndefined();
  });
});

const makeClient = (overrides: Partial<Record<keyof VmServiceClient, unknown>> = {}): VmServiceClient =>
  ({
    getMainIsolateId: vi.fn().mockResolvedValue('i'),
    callServiceExtension: vi.fn().mockResolvedValue({ found: false }),
    resolveRootLibrary: vi.fn().mockResolvedValue({ isolateId: 'i', rootLibraryId: 'r' }),
    evaluate: vi.fn().mockResolvedValue({ kind: 'Null' }),
    ...overrides,
  }) as unknown as VmServiceClient;

describe('executeScript', () => {
  it('should invoke a registered handler with JSON args and return its value', async () => {
    const client = makeClient({ callServiceExtension: vi.fn().mockResolvedValue({ found: true, value: 5 }) });
    expect(await executeScript(client, 'add', [2, 3])).toBe(5);
    expect(client.callServiceExtension).toHaveBeenCalledWith('ext.wdio.invoke', {
      isolateId: 'i',
      name: 'add',
      args: JSON.stringify([2, 3]),
    });
    expect(client.evaluate).not.toHaveBeenCalled();
  });

  it('should throw when a registered handler itself throws', async () => {
    const client = makeClient({ callServiceExtension: vi.fn().mockResolvedValue({ found: true, error: 'boom' }) });
    await expect(executeScript(client, 'bad')).rejects.toThrow(/boom/);
  });

  it('should fall back to evaluating the name as a Dart expression when no handler matches', async () => {
    const client = makeClient({
      callServiceExtension: vi.fn().mockResolvedValue({ found: false }),
      evaluate: vi.fn().mockResolvedValue({ kind: 'Bool', valueAsString: 'true' }),
    });
    expect(await executeScript(client, 'WidgetsBinding.instance != null')).toBe(true);
    expect(client.evaluate).toHaveBeenCalledWith('i', 'r', 'WidgetsBinding.instance != null');
  });

  it('should throw clear guidance when no handler matches and no compiler is attached', async () => {
    const client = makeClient({
      callServiceExtension: vi.fn().mockResolvedValue({ found: false }),
      evaluate: vi.fn().mockRejectedValue(new Error('Expression compilation error: No compilation service available')),
    });
    await expect(executeScript(client, '1 + 1')).rejects.toThrow(/no handler '1 \+ 1' is registered/);
  });

  it('should surface a Dart runtime error from the eval fallback', async () => {
    const client = makeClient({
      callServiceExtension: vi.fn().mockResolvedValue({ found: false }),
      evaluate: vi.fn().mockResolvedValue({ type: '@Error', valueAsString: 'Bad state' }),
    });
    await expect(executeScript(client, 'throw StateError("x")')).rejects.toThrow(/raised a Dart error.*Bad state/);
  });
});
