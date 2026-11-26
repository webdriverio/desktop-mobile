import { describe, expect, it } from 'vitest';

import { instanceFailuresError, settleOnEach } from '../src/instanceFailures.js';

describe('settleOnEach', () => {
  it('should resolve with every value in target order when all succeed', async () => {
    const result = await settleOnEach([{ name: 'a' }, { name: 'b' }], async ({ name }) => name.toUpperCase());

    expect(result).toEqual({ values: ['A', 'B'], failures: [] });
  });

  it('should wait for every target and name each one that failed', async () => {
    const slow = Promise.withResolvers<string>();
    const errorA = new Error('a broke');
    const settled = settleOnEach([{ name: 'a' }, { name: 'b' }, { name: 'c' }], async ({ name }) => {
      if (name === 'a') {
        throw errorA;
      }
      return name === 'b' ? slow.promise : 'c';
    });
    let done = false;
    void settled.then(() => {
      done = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);
    slow.resolve('b');

    await expect(settled).resolves.toEqual({ values: ['b', 'c'], failures: [{ name: 'a', error: errorA }] });
  });

  it('should record a synchronous throw as that target failing', async () => {
    const error = new Error('sync');
    const result = await settleOnEach([{ name: 'a' }], () => {
      throw error;
    });

    expect(result.failures).toEqual([{ name: 'a', error }]);
  });
});

describe('instanceFailuresError', () => {
  it('should name the instance in the message and keep its error as the cause when one failed', () => {
    const cause = new Error('no window labelled "x"');
    const error = instanceFailuresError('switchWindow', [{ name: 'browserB', error: cause }]);

    expect(error).not.toBeInstanceOf(AggregateError);
    expect(error.message).toBe('switchWindow failed on browserB: no window labelled "x"');
    expect(error.cause).toBe(cause);
  });

  it('should name every instance and collect their errors when more than one failed', () => {
    const errors = [new Error('a broke'), new Error('b broke')];
    const error = instanceFailuresError('execute', [
      { name: 'browserA', error: errors[0] },
      { name: 'browserB', error: errors[1] },
    ]);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe('execute failed on browserA: a broke; browserB: b broke');
    expect((error as AggregateError).errors).toEqual(errors);
  });
});
