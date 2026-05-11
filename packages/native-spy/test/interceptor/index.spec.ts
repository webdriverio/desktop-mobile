import { describe, expect, it } from 'vitest';
import { createIpcInterceptor } from '../../src/interceptor/index.js';

describe('createIpcInterceptor', () => {
  describe('tauri', () => {
    const interceptor = createIpcInterceptor('tauri');

    it('should report tauri framework', () => {
      expect(interceptor.framework).toBe('tauri');
    });

    describe('serializeHandler', () => {
      it('should capture function source', () => {
        const fn = () => 42;
        const { source } = interceptor.serializeHandler(fn);
        expect(source).toContain('42');
      });
    });

    describe('buildRegistrationScript', () => {
      it('should delegate to adapter', () => {
        const script = interceptor.buildRegistrationScript('cmd');
        expect(script).toContain('__wdio_spy__');
      });
    });

    describe('buildSetImplementationScript', () => {
      it('should accept SerializedHandler', () => {
        const s = interceptor.serializeHandler(() => 1);
        const script = interceptor.buildSetImplementationScript('cmd', s);
        expect(script).toContain('mockImplementation');
      });
    });

    describe('buildWithImplementationScript', () => {
      it('should take function objects', () => {
        const script = interceptor.buildWithImplementationScript(
          'cmd',
          () => 1,
          () => 2,
        );
        expect(script).toContain('withImplementation');
      });
    });

    describe('parseCallData', () => {
      it('should return empty data for null', () => {
        const data = interceptor.parseCallData(null);
        expect(data.calls).toEqual([]);
        expect(data.results).toEqual([]);
        expect(data.invocationCallOrder).toEqual([]);
      });

      it('should parse valid call data', () => {
        const raw = { calls: [[1, 2]], results: [{ type: 'return', value: 3 }], invocationCallOrder: [0] };
        const data = interceptor.parseCallData(raw);
        expect(data.calls).toEqual([[1, 2]]);
        expect(data.results[0].type).toBe('return');
      });
    });
  });

  describe('electron', () => {
    const interceptor = createIpcInterceptor('electron');

    it('should report electron framework', () => {
      expect(interceptor.framework).toBe('electron');
    });

    describe('buildRegistrationScript', () => {
      it('should produce a mock registration script', () => {
        const script = interceptor.buildRegistrationScript('my-channel');
        expect(script).toContain('__wdio_spy__');
        expect(script).toContain('my-channel');
      });
    });

    describe('buildBrowserIpcInjectionScript', () => {
      it('should patch ipcRenderer', () => {
        const script = interceptor.buildBrowserIpcInjectionScript();
        expect(script).toContain('ipcRenderer');
        expect(script).toContain('__wdio_mocks__');
      });
    });
  });

  describe('context management', () => {
    it('should start with empty context', () => {
      const interceptor = createIpcInterceptor('tauri');
      expect(interceptor.getContext()).toEqual({});
    });

    it('should initialize with provided context', () => {
      const interceptor = createIpcInterceptor('tauri', { context: { foo: 'bar' } });
      expect(interceptor.getContext()).toEqual({ foo: 'bar' });
    });

    it('should merge into existing context', () => {
      const interceptor = createIpcInterceptor('tauri', { context: { a: 1 } });
      interceptor.setContext({ b: 2 });
      expect(interceptor.getContext()).toEqual({ a: 1, b: 2 });
    });

    it('should generate a script with context', () => {
      const interceptor = createIpcInterceptor('tauri');
      const script = interceptor.buildContextSeedScript({ x: 99 });
      expect(script).toContain('__wdio_ipc_context__');
      expect(script).toContain('99');
    });
  });
});
