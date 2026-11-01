import { describe, expect, it } from 'vitest';

import { DioxusAdapter } from '../../src/interceptor/dioxus.js';

describe('DioxusAdapter', () => {
  const adapter = new DioxusAdapter();

  describe('framework', () => {
    it('should identify as dioxus', () => {
      expect(adapter.framework).toBe('dioxus');
    });
  });

  describe('buildRegistrationScript', () => {
    it('should return a function-shaped string with _dx parameter', () => {
      const script = adapter.buildRegistrationScript('my_command');
      expect(script.trim()).toMatch(/^\(_dx\)/);
    });

    it('should use the mock name as the __wdio_mocks__ key', () => {
      const script = adapter.buildRegistrationScript('get_platform');
      expect(script).toContain('"get_platform"');
    });

    it('should set the mock name to dioxus.<command>', () => {
      const script = adapter.buildRegistrationScript('my_cmd');
      expect(script).toContain('dioxus.my_cmd');
    });

    it('should call mockClear after registration', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('mockClear()');
    });

    it('should check for __wdio_spy__', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('__wdio_spy__');
    });

    it('should reference the dioxus bridge install in the not-installed error', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('wdio_dioxus_bridge::install');
    });
  });

  describe('buildCallDataReadScript', () => {
    it('should embed the mock name lookup', () => {
      const script = adapter.buildCallDataReadScript('my_cmd');
      expect(script).toContain('"my_cmd"');
      expect(script).toContain('mockObj.mock');
    });

    it('should fall back to empty arrays when the mock is missing', () => {
      const script = adapter.buildCallDataReadScript('my_cmd');
      expect(script).toContain('calls: []');
    });

    it('should preserve Errors via a custom replacer', () => {
      const script = adapter.buildCallDataReadScript('cmd');
      expect(script).toContain('__wdioError');
    });
  });

  describe('buildSetImplementationScript', () => {
    it('should use mockImplementation by default', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => 42' });
      expect(script).toContain('mockImplementation');
      expect(script).not.toContain('mockImplementationOnce');
    });

    it('should use mockImplementationOnce when once=true', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => 42' }, true);
      expect(script).toContain('mockImplementationOnce');
    });

    it('should embed the handler source', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => "hello"' });
      expect(script).toContain('"hello"');
    });
  });

  describe('buildInnerInvocationScript', () => {
    it('should call the chosen mockClear/mockReset/mockReturnThis method', () => {
      expect(adapter.buildInnerInvocationScript('cmd', 'mockClear')).toContain('mockClear?.()');
      expect(adapter.buildInnerInvocationScript('cmd', 'mockReset')).toContain('mockReset?.()');
      expect(adapter.buildInnerInvocationScript('cmd', 'mockReturnThis')).toContain('mockReturnThis?.()');
    });
  });

  describe('buildUnregistrationScript', () => {
    it('should delete the mock from __wdio_mocks__', () => {
      const script = adapter.buildUnregistrationScript('cmd');
      expect(script).toContain('delete window.__wdio_mocks__');
      expect(script).toContain('"cmd"');
    });
  });

  describe('buildBrowserIpcInjectionScript', () => {
    it('should patch window.__WDIO_DIOXUS__.invoke', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      expect(script).toContain('window.__WDIO_DIOXUS__');
      expect(script).toContain('window.__WDIO_DIOXUS__.invoke');
    });

    it('should preserve the original invoke as __wdio_original_invoke__', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      expect(script).toContain('__wdio_original_invoke__');
    });

    it('should dispatch through __wdio_mocks__ when a mock is registered', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      expect(script).toContain('__wdio_mocks__');
      expect(script).toContain('mock(args)');
    });

    it('should reject with a helpful error when neither a mock nor original invoke is available', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      expect(script).toContain('unmocked Dioxus command');
    });
  });

  describe('buildWithImplementationScript', () => {
    type Webview = { __WDIO_DIOXUS__: unknown; __wdio_mocks__: Record<string, unknown> };

    function makeWebview(): Webview {
      const win = { __WDIO_DIOXUS__: { invoke: async () => 'unmocked' } } as unknown as Webview;
      new Function('window', adapter.buildBrowserIpcInjectionScript())(win);
      new Function('window', `return (${adapter.buildRegistrationScript('cmd')})()`)(win);
      return win;
    }

    function run(script: string, win: Webview): Promise<unknown> {
      return new Function('window', `return (${script})(window.__WDIO_DIOXUS__)`)(win);
    }

    it('should pass dx to the callback and resolve with its result once it settles', async () => {
      const win = makeWebview();
      const script = adapter.buildWithImplementationScript(
        'cmd',
        '() => "temporary"',
        'async (dx) => { await Promise.resolve(); return dx.invoke("cmd"); }',
      );

      await expect(run(script, win)).resolves.toBe('temporary');
    });

    it('should reject without running the callback when the command is not mocked', async () => {
      const win = makeWebview();
      delete win.__wdio_mocks__.cmd;
      const script = adapter.buildWithImplementationScript(
        'cmd',
        '() => "temporary"',
        '() => { throw new Error("callback ran"); }',
      );

      await expect(run(script, win)).rejects.toMatchObject({ message: 'cmd is not mocked in this window' });
    });
  });

  describe('createIpcInterceptor', () => {
    it('should return a DioxusAdapter when framework is dioxus', async () => {
      const { createIpcInterceptor } = await import('../../src/interceptor/index.js');
      const interceptor = createIpcInterceptor('dioxus');
      expect(interceptor.framework).toBe('dioxus');
    });
  });
});
