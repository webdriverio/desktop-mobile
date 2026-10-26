import { describe, expect, it } from 'vitest';
import { fn } from '../src/index.js';

describe('native-spy', () => {
  describe('fn()', () => {
    it('should create a mock function', () => {
      const mock = fn();
      expect(typeof mock).toBe('function');
    });

    it('should track calls', () => {
      const mock = fn();
      mock('arg1', 'arg2');
      mock('arg3');

      expect(mock.calls.length).toBe(2);
      expect(mock.calls[0]).toEqual(['arg1', 'arg2']);
      expect(mock.calls[1]).toEqual(['arg3']);
    });

    it('should track call order', () => {
      const mock = fn();
      mock();
      mock();
      mock();

      expect(mock.invocationCallOrder.length).toBe(3);
    });

    it('should set return value with mockReturnValue', () => {
      const mock = fn();
      mock.mockReturnValue('hello');

      expect(mock()).toBe('hello');
      expect(mock()).toBe('hello');
    });

    it('should set return value for next call only with mockReturnValueOnce', () => {
      const mock = fn();
      mock.mockReturnValueOnce('first');
      mock.mockReturnValue('rest');

      expect(mock()).toBe('first');
      expect(mock()).toBe('rest');
      expect(mock()).toBe('rest');
    });

    it('should set implementation with mockImplementation', () => {
      const mock = fn();
      mock.mockImplementation(() => 'implemented');

      expect(mock()).toBe('implemented');
    });

    it('should get implementation with getMockImplementation', () => {
      const mock = fn();
      const impl = () => 'implemented';
      mock.mockImplementation(impl);

      expect(mock.getMockImplementation()).toBe(impl);
    });

    it('should return undefined when no implementation set', () => {
      const mock = fn();

      expect(mock.getMockImplementation()).toBeUndefined();
    });

    it('should return initial implementation passed to fn()', () => {
      const impl = () => 'initial';
      const mock = fn(impl as (...args: unknown[]) => unknown);

      expect(mock.getMockImplementation()).toBe(impl);
    });

    it('should set implementation for next call with mockImplementationOnce', () => {
      const mock = fn();
      mock.mockImplementationOnce(() => 'once');

      expect(mock()).toBe('once');
      expect(mock()).toBe(undefined);
    });

    it('should clear call history with mockClear', () => {
      const mock = fn();
      mock('test');
      expect(mock.calls.length).toBe(1);

      mock.mockClear();
      expect(mock.calls.length).toBe(0);
    });

    it('should clear everything including return values with mockReset', () => {
      const mock = fn();
      mock.mockReturnValue('value');
      mock('test');

      mock.mockReset();

      expect(mock.calls.length).toBe(0);
      expect(mock()).toBe(undefined);
    });

    it('should set and get mock name with mockName', () => {
      const mock = fn();
      mock.mockName('myMock');

      expect(mock.getMockName()).toBe('myMock');
    });

    it('should handle promises with mockResolvedValue', async () => {
      const mock = fn();
      mock.mockResolvedValue('resolved');

      const result = mock();
      expect(result).toBeInstanceOf(Promise);
      expect(await result).toBe('resolved');
    });

    it('should handle rejections with mockRejectedValue', () => {
      const mock = fn();
      mock.mockRejectedValue(new Error('fail'));

      expect(() => mock()).toThrow('fail');
    });

    it('should track results with mockReturnValue', () => {
      const mock = fn();
      mock.mockReturnValue('result');

      mock();
      mock();

      expect(mock.results.length).toBe(2);
      // Both calls should return 'result'
      expect(mock.results[0].value).toBe('result');
      expect(mock.results[1].value).toBe('result');
    });

    it('should track results with mockReturnValueOnce', () => {
      const mock = fn();
      mock.mockReturnValueOnce('once');
      mock.mockReturnValue('default');

      mock();
      mock();
      mock();

      // First call returns 'once', rest return 'default'
      expect(mock.results.length).toBe(3);
      expect(mock.results[0].value).toBe('once');
      expect(mock.results[1].value).toBe('default');
      expect(mock.results[2].value).toBe('default');
    });

    it('should resolve for next call only with mockResolvedValueOnce', async () => {
      const mock = fn();
      mock.mockResolvedValue('default');
      mock.mockResolvedValueOnce('once');

      expect(await mock()).toBe('once');
      expect(await mock()).toBe('default');
    });

    it('should reject for next call only with mockRejectedValueOnce', async () => {
      const mock = fn();
      mock.mockReturnValue('default');
      mock.mockRejectedValueOnce(new Error('once'));

      await expect(async () => mock()).rejects.toThrow('once');
      expect(mock()).toBe('default');
    });

    it('should call a restored original with the receiver it was invoked on', () => {
      const api = {
        name: 'app',
        getName(this: { name: string }) {
          return this.name;
        },
      };
      const original = api.getName;
      const mock = fn(undefined, { original });
      api.getName = mock;

      mock.mockRestore();

      expect(api.getName()).toBe('app');
    });

    it('should reset all state including implementation with mockRestore', () => {
      const mock = fn(() => 'original');
      mock.mockReturnValue('overridden');
      mock();

      mock.mockRestore();

      expect(mock.calls.length).toBe(0);
      expect(mock()).toBe(undefined);
    });

    it('should allow mockReturnValue after mockRestore', () => {
      const mock = fn(() => 'original');
      mock.mockRestore();
      mock.mockReturnValue('new value');

      expect(mock()).toBe('new value');
    });

    it('should allow mockResolvedValue after mockRestore', async () => {
      const mock = fn(async () => 'original');
      mock.mockRestore();
      mock.mockResolvedValue('new resolved');

      expect(await mock()).toBe('new resolved');
    });

    it('should allow mockRejectedValue after mockRestore', () => {
      const mock = fn(async () => 'original');
      mock.mockRestore();
      mock.mockRejectedValue(new Error('new error'));

      expect(() => mock()).toThrow('new error');
    });

    it('should track results with type throw for implementations that throw', () => {
      const mock = fn();
      mock.mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => mock()).toThrow('boom');
      expect(mock.results[0].type).toBe('throw');
    });

    it('should track results with type throw for queued implementations that throw', () => {
      const mock = fn();
      mock.mockImplementationOnce(() => {
        throw new Error('queued boom');
      });

      expect(() => mock()).toThrow('queued boom');
      expect(mock.results[0].type).toBe('throw');
    });

    it('should track instances', () => {
      const mock = fn();
      mock();
      expect(mock.instances).toBeDefined();
      expect(Array.isArray(mock.instances)).toBe(true);
    });

    it('should track globally unique invocationCallOrder across mocks', () => {
      const mock1 = fn();
      const mock2 = fn();

      mock1();
      mock2();
      mock1();

      expect(mock1.invocationCallOrder[0]).toBeLessThan(mock2.invocationCallOrder[0]);
      expect(mock2.invocationCallOrder[0]).toBeLessThan(mock1.invocationCallOrder[1]);
    });

    it('should queue multiple mockReturnValueOnce in order', () => {
      const mock = fn();
      mock.mockReturnValue('default');
      mock.mockReturnValueOnce('first');
      mock.mockReturnValueOnce('second');
      mock.mockReturnValueOnce('third');

      expect(mock()).toBe('first');
      expect(mock()).toBe('second');
      expect(mock()).toBe('third');
      expect(mock()).toBe('default');
    });

    it('should track context as undefined when called directly', () => {
      const mock = fn();
      mock();
      expect(mock.mock.contexts[0]).toBeUndefined();
    });

    it('should track context when called as method', () => {
      const mock = fn();
      const obj = { method: mock };
      obj.method();
      expect(mock.mock.contexts[0]).toBe(obj);
    });
  });

  describe('withImplementation', () => {
    it('should temporarily change implementation', () => {
      const mock = fn();
      mock.mockReturnValue('original');

      const result = mock.withImplementation(
        () => 'temporary',
        () => mock(),
      );

      expect(result).toBe('temporary');
      expect(mock()).toBe('original');
    });

    it('should restore implementation even when callback throws', () => {
      const mock = fn();
      mock.mockReturnValue('original');

      expect(() => {
        mock.withImplementation(
          () => 'temp',
          () => {
            throw new Error('callback error');
          },
        );
      }).toThrow('callback error');

      expect(mock()).toBe('original');
    });

    it('should restore queued implementations after callback throws', () => {
      const mock = fn();
      mock.mockReturnValueOnce('queued');

      expect(() => {
        mock.withImplementation(
          () => 'temp',
          () => {
            throw new Error('error');
          },
        );
      }).toThrow('error');

      expect(mock()).toBe('queued');
    });
  });

  describe('mockReturnThis', () => {
    it('should return this context when set', () => {
      const mock = fn();
      mock.mockReturnThis();

      const thisObj = { called: false };
      const result = mock.call(thisObj);
      expect(result).toBe(thisObj);
    });

    it('should be overridden by mockReturnValue', () => {
      const mock = fn();
      mock.mockReturnThis();
      mock.mockReturnValue('value');

      const obj = { method: mock };
      expect(obj.method()).toBe('value');
    });
  });

  describe('serialization', () => {
    it('should be serializable with no circular references', () => {
      const mock = fn();
      mock('test');

      // Should be able to serialize the mock object
      expect(() => JSON.stringify(mock)).not.toThrow();

      // Should be able to serialize mock.calls
      expect(() => JSON.stringify(mock.calls)).not.toThrow();

      // Should be able to serialize mock.mock
      expect(() => JSON.stringify(mock.mock)).not.toThrow();
    });

    it('should return plain data object from mock.mock', () => {
      const mock = fn();
      mock('arg1', 'arg2');

      const mockData = mock.mock;
      expect(typeof mockData).toBe('object');
      expect(Array.isArray(mockData.calls)).toBe(true);
      expect(mockData.calls[0]).toEqual(['arg1', 'arg2']);
      expect(typeof mockData.results).toBe('object');
      expect(Array.isArray(mockData.invocationCallOrder)).toBe(true);
    });

    it('should not have circular reference in mock function', () => {
      const mock = fn();

      // mock.mock should not be the mock function itself
      expect(mock.mock).not.toBe(mock);

      // Accessing mock.mock should not cause circular references
      const mockData = mock.mock;
      expect(mockData).toBeDefined();
      expect(typeof mockData).toBe('object');
    });

    it('should handle call arguments without creating circular references in mock structure', () => {
      const mock = fn();

      // Call mock with regular objects (no circular references)
      const obj = { prop: 'value', nested: { count: 42 } };
      mock(obj, 'arg2', 123);

      // Should be able to access calls without issues
      expect(mock.calls.length).toBe(1);
      expect(mock.calls[0][0]).toBe(obj);
      expect(mock.calls[0][1]).toBe('arg2');
      expect(mock.calls[0][2]).toBe(123);

      // Should still be serializable even with complex call arguments
      expect(() => JSON.stringify(mock.mock)).not.toThrow();

      // The serialized data should contain the call information
      const serialized = JSON.stringify(mock.mock);
      expect(serialized).toContain('"prop":"value"');
      expect(serialized).toContain('"count":42');
    });
  });
});
