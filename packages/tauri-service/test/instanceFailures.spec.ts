import { describe, expect, it } from 'vitest';
import { instanceFailuresError, settleOnEach } from '../src/instanceFailures.js';

describe('settleOnEach', () => {
  it("should keep each value at its target's index when an earlier target fails", async () => {
    const failure = new Error('boom');
    const targets = [{ name: 'a' }, { name: 'b' }];

    const { values, failures } = await settleOnEach(targets, async ({ name }) => {
      if (name === 'a') {
        throw failure;
      }
      return name;
    });

    expect(values).toEqual([undefined, 'b']);
    expect(failures).toEqual([{ name: 'a', error: failure }]);
  });
});

describe('instanceFailuresError', () => {
  it('should name the one failure and keep it as the cause', () => {
    const failure = new Error('boom');

    expect(instanceFailuresError('execute', [{ name: 'a', error: failure }])).toMatchObject({
      message: 'execute failed on a: boom',
      cause: failure,
    });
  });

  it('should name every failure and keep them in an AggregateError', () => {
    const errors = [new Error('one'), new Error('two')];

    const error = instanceFailuresError('execute', [
      { name: 'a', error: errors[0] },
      { name: 'b', error: errors[1] },
    ]);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({ message: 'execute failed on a: one; b: two', errors });
  });
});
