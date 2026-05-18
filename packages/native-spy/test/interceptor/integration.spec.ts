import { describe, expect, it } from 'vitest';
import { createIpcInterceptor } from '../../src/interceptor/index.js';
import { fn } from '../../src/mock.js';

type SyntheticWindow = {
  __wdio_spy__: { fn: typeof fn };
  __wdio_mocks__: Record<string, ReturnType<typeof fn>>;
  __wdio_ipc_context__?: Record<string, unknown>;
};

function makeSyntheticWindow(): SyntheticWindow {
  return {
    __wdio_spy__: { fn },
    __wdio_mocks__: {},
  };
}

function evalScript(script: string, win: SyntheticWindow): unknown {
  const fn = new Function('window', `return (${script})(undefined)`);
  return fn(win);
}

describe('TauriAdapter integration (synthetic window)', () => {
  const interceptor = createIpcInterceptor('tauri');

  describe('buildRegistrationScript', () => {
    it('should create a mock in __wdio_mocks__', () => {
      const win = makeSyntheticWindow();
      const script = interceptor.buildRegistrationScript('my_cmd');
      evalScript(script, win);
      expect(typeof win.__wdio_mocks__['my_cmd']).toBe('function');
    });

    it('should call mockClear so calls start empty', () => {
      const win = makeSyntheticWindow();
      const script = interceptor.buildRegistrationScript('my_cmd');
      evalScript(script, win);
      const mock = win.__wdio_mocks__['my_cmd'];
      mock('some_arg');
      evalScript(script, win);
      expect(win.__wdio_mocks__['my_cmd'].mock.calls).toHaveLength(0);
    });
  });

  describe('buildCallDataReadScript', () => {
    it('should return call data', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      win.__wdio_mocks__['my_cmd']('arg1');
      win.__wdio_mocks__['my_cmd']('arg2');

      const readScript = interceptor.buildCallDataReadScript('my_cmd');
      const raw = evalScript(readScript, win);
      const data = interceptor.parseCallData(raw);
      expect(data.calls).toHaveLength(2);
    });

    it('should round-trip Error results without losing detail', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      const mock = win.__wdio_mocks__['my_cmd'];
      mock.mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() => mock()).toThrow('boom');

      const raw = evalScript(interceptor.buildCallDataReadScript('my_cmd'), win);
      const data = interceptor.parseCallData(raw);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].type).toBe('throw');
      expect(data.results[0].value).toBeInstanceOf(Error);
      expect((data.results[0].value as Error).message).toBe('boom');
    });

    it('should round-trip Error arguments in calls', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      const mock = win.__wdio_mocks__['my_cmd'];
      mock(new Error('arg-error'));

      const raw = evalScript(interceptor.buildCallDataReadScript('my_cmd'), win);
      const data = interceptor.parseCallData(raw);
      expect(data.calls[0][0]).toBeInstanceOf(Error);
      expect((data.calls[0][0] as Error).message).toBe('arg-error');
    });
  });

  describe('buildSetImplementationScript', () => {
    it('should set implementation', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);

      const s = interceptor.serializeHandler(() => 'hello');
      evalScript(interceptor.buildSetImplementationScript('my_cmd', s), win);

      const result = win.__wdio_mocks__['my_cmd']();
      expect(result).toBe('hello');
    });

    it('should use mockImplementationOnce when once=true', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);

      const s = interceptor.serializeHandler(() => 'once');
      evalScript(interceptor.buildSetImplementationScript('my_cmd', s, true), win);

      expect(win.__wdio_mocks__['my_cmd']()).toBe('once');
      expect(win.__wdio_mocks__['my_cmd']()).toBeUndefined();
    });
  });

  describe('buildInnerSetterScript', () => {
    it('should set return value for mockReturnValue', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      evalScript(interceptor.buildInnerSetterScript('my_cmd', 'mockReturnValue', 42), win);
      expect(win.__wdio_mocks__['my_cmd']()).toBe(42);
    });

    it('should reconstruct Error for mockRejectedValue', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      evalScript(interceptor.buildInnerSetterScript('my_cmd', 'mockRejectedValue', new Error('fail msg')), win);

      expect(() => win.__wdio_mocks__['my_cmd']()).toThrow('fail msg');
    });
  });

  describe('buildInnerInvocationScript', () => {
    it('should empty call history for mockClear', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      win.__wdio_mocks__['my_cmd']('test');
      expect(win.__wdio_mocks__['my_cmd'].mock.calls).toHaveLength(1);

      evalScript(interceptor.buildInnerInvocationScript('my_cmd', 'mockClear'), win);
      expect(win.__wdio_mocks__['my_cmd'].mock.calls).toHaveLength(0);
    });
  });

  describe('buildUnregistrationScript', () => {
    it('should remove mock from __wdio_mocks__', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      expect(win.__wdio_mocks__['my_cmd']).toBeDefined();

      evalScript(interceptor.buildUnregistrationScript('my_cmd'), win);
      expect(win.__wdio_mocks__['my_cmd']).toBeUndefined();
    });
  });

  describe('buildContextSeedScript', () => {
    it('should seed __wdio_ipc_context__', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildContextSeedScript({ userId: 'abc' }), win);
      expect(win.__wdio_ipc_context__?.userId).toBe('abc');
    });

    it('should be idempotent (Object.assign merges)', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildContextSeedScript({ a: 1 }), win);
      evalScript(interceptor.buildContextSeedScript({ b: 2 }), win);
      expect(win.__wdio_ipc_context__?.a).toBe(1);
      expect(win.__wdio_ipc_context__?.b).toBe(2);
    });
  });
});
