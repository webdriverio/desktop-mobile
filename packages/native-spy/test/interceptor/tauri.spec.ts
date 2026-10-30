import { describe, expect, it } from 'vitest';
import { TauriAdapter } from '../../src/interceptor/tauri.js';

describe('TauriAdapter', () => {
  const adapter = new TauriAdapter();

  describe('framework', () => {
    it('is tauri', () => {
      expect(adapter.framework).toBe('tauri');
    });
  });

  describe('buildRegistrationScript', () => {
    it('should return a function-like string', () => {
      const script = adapter.buildRegistrationScript('my_command');
      expect(script.trim()).toMatch(/^\(_tauri\)/);
    });

    it('uses the mock name for __wdio_mocks__ key', () => {
      const script = adapter.buildRegistrationScript('get_platform');
      expect(script).toContain('"get_platform"');
    });

    it('should set mock name as tauri.<command>', () => {
      const script = adapter.buildRegistrationScript('my_cmd');
      expect(script).toContain('tauri.my_cmd');
    });

    it('should call mockClear after registration', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('mockClear()');
    });

    it('checks for __wdio_spy__', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('__wdio_spy__');
    });

    it('returns the current window label', () => {
      const script = adapter.buildRegistrationScript('cmd');
      expect(script).toContain('currentWindow?.label');
    });
  });

  describe('buildCallDataReadScript', () => {
    it('should return function string with mockObj lookup', () => {
      const script = adapter.buildCallDataReadScript('my_cmd');
      expect(script).toContain('"my_cmd"');
      expect(script).toContain('mockObj.mock');
    });

    it('falls back to empty arrays when mockObj absent', () => {
      const script = adapter.buildCallDataReadScript('my_cmd');
      expect(script).toContain('calls: []');
    });
  });

  describe('buildSetImplementationScript', () => {
    it('uses mockImplementation by default', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => 42' });
      expect(script).toContain('mockImplementation');
      expect(script).not.toContain('mockImplementationOnce');
    });

    it('uses mockImplementationOnce when once=true', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => 42' }, true);
      expect(script).toContain('mockImplementationOnce');
    });

    it('embeds the handler source', () => {
      const script = adapter.buildSetImplementationScript('cmd', { source: '() => "hello"' });
      expect(script).toContain('"hello"');
    });
  });

  describe('buildInnerInvocationScript', () => {
    it('should call mockClear', () => {
      const script = adapter.buildInnerInvocationScript('cmd', 'mockClear');
      expect(script).toContain('mockClear?.()');
    });

    it('should call mockReset', () => {
      const script = adapter.buildInnerInvocationScript('cmd', 'mockReset');
      expect(script).toContain('mockReset?.()');
    });

    it('should call mockReturnThis', () => {
      const script = adapter.buildInnerInvocationScript('cmd', 'mockReturnThis');
      expect(script).toContain('mockReturnThis?.()');
    });
  });

  describe('buildInnerSetterScript', () => {
    it('should call mockReturnValue with the value', () => {
      const script = adapter.buildInnerSetterScript('cmd', 'mockReturnValue', 42);
      expect(script).toContain('mockReturnValue');
      expect(script).toContain('42');
    });

    it('serializes Error as wdioError sentinel and reconstructs', () => {
      const script = adapter.buildInnerSetterScript('cmd', 'mockRejectedValue', new Error('boom'));
      expect(script).toContain('__wdioError');
      expect(script).toContain('boom');
      expect(script).toContain('new Error');
    });

    it('passes plain values without Error reconstruction', () => {
      const script = adapter.buildInnerSetterScript('cmd', 'mockReturnValue', 'hello');
      expect(script).toContain('"hello"');
    });

    it('should handle null value', () => {
      const script = adapter.buildInnerSetterScript('cmd', 'mockReturnValue', null);
      expect(script).toContain('null');
    });
  });

  describe('buildUnregistrationScript', () => {
    it('deletes the mock from __wdio_mocks__', () => {
      const script = adapter.buildUnregistrationScript('my_cmd');
      expect(script).toContain('delete window.__wdio_mocks__');
      expect(script).toContain('"my_cmd"');
    });
  });

  describe('buildWithImplementationScript', () => {
    it('embeds impl and callback sources', () => {
      const script = adapter.buildWithImplementationScript('cmd', '() => 99', '() => {}');
      expect(script).toContain('99');
      expect(script).toContain('withImplementation');
    });

    it('is async and awaits the callback', () => {
      const script = adapter.buildWithImplementationScript('cmd', '() => {}', '() => {}');
      expect(script.trim()).toMatch(/^async/);
      expect(script).toContain('await mockObj?.withImplementation');
      expect(script).toContain('async () =>');
      expect(script).toContain('callback');
    });

    it('passes _tauri to callback only when defined (browser mode compat)', () => {
      const script = adapter.buildWithImplementationScript('cmd', '() => {}', '() => {}');
      expect(script).toContain('_tauri !== undefined ? callback(_tauri) : callback()');
    });
  });
});
