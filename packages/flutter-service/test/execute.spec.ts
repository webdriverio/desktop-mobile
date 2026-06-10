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

const makeClient = (evalResult: unknown): VmServiceClient =>
  ({
    resolveRootLibrary: vi.fn().mockResolvedValue({ isolateId: 'i', rootLibraryId: 'r' }),
    evaluate: vi.fn().mockResolvedValue(evalResult),
  }) as unknown as VmServiceClient;

describe('executeScript', () => {
  it('should evaluate against the root library and coerce the result', async () => {
    const client = makeClient({ kind: 'Bool', valueAsString: 'true' });
    expect(await executeScript(client, 'WidgetsBinding.instance != null')).toBe(true);
    expect(client.evaluate).toHaveBeenCalledWith('i', 'r', 'WidgetsBinding.instance != null');
  });

  it('should throw on a Dart error result', async () => {
    const client = makeClient({ type: '@Error', valueAsString: 'Bad state' });
    await expect(executeScript(client, 'throw StateError("x")')).rejects.toThrow(/Bad state/);
  });
});
