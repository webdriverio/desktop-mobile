import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapScriptForDirectEval, wrapScriptForWebDriver } from '../src/wrapForDirectEval.js';

describe('wrapScriptForDirectEval', () => {
  describe('function-like scripts', () => {
    it('should wrap an arrow function', () => {
      const result = wrapScriptForDirectEval('(tauri, x) => x * 2', '[21]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain(': [21];');
      expect(result).toContain('__wdio_tauri = { core: { invoke: __wdio_invoke } }');
      expect(result).toContain('await ((tauri, x) => x * 2)(__wdio_tauri, ...__wdio_args)');
      expect(result).toContain('__cb({ ok: true,');
      expect(result).toContain('__cb({ ok: false,');
    });

    it('should wrap a named function expression', () => {
      const result = wrapScriptForDirectEval('function myFn(tauri) { return 1; }', '[]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain('await (function myFn(tauri) { return 1; })(__wdio_tauri, ...__wdio_args)');
    });

    it('should wrap an async function', () => {
      const result = wrapScriptForDirectEval('async function fn(tauri) { return await fetch(); }', '[]');
      expect(result).toContain('await (async function fn(tauri) { return await fetch(); })(__wdio_tauri');
    });

    it('should wrap an async arrow function', () => {
      const result = wrapScriptForDirectEval('async (tauri) => 42', '[]');
      expect(result).toContain('await (async (tauri) => 42)(__wdio_tauri');
    });

    it('should wrap a bare identifier arrow function', () => {
      const result = wrapScriptForDirectEval('x => x + 1', '[5]');
      expect(result).toContain('await (x => x + 1)(__wdio_tauri');
    });

    it('should wrap a bare identifier arrow function containing $', () => {
      const result = wrapScriptForDirectEval('t$ => t$.core', '[]');
      expect(result).toContain('await (t$ => t$.core)(__wdio_tauri');
    });

    it('should include mock-routing invoke block', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('window.__wdio_mocks__');
      expect(result).toContain('mocks[cmd]');
      expect(result).toContain('__wdio_invoke_real');
    });

    it('should include __wdio_original_core__ wait loop', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('window.__wdio_original_core__');
      expect(result).toContain('5s timeout');
    });

    it('should embed args JSON correctly', () => {
      const result = wrapScriptForDirectEval('(tauri, a, b) => a + b', '[1,"hello"]');
      expect(result).toContain(': [1,"hello"];');
    });

    it('should pass undef=true for undefined results', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('undef: __result === undefined');
      expect(result).toContain('value: __result === undefined ? null : __result');
    });
  });

  describe('string expression scripts', () => {
    it('should wrap a simple expression', () => {
      const result = wrapScriptForDirectEval('1 + 2', '[]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain('(async function() { return 1 + 2; }).apply(null, __wdio_args)');
      expect(result).toContain('__cb({ ok: true,');
    });

    it('should wrap a property access expression', () => {
      const result = wrapScriptForDirectEval('document.title', '[]');
      expect(result).toContain('(async function() { return document.title; }).apply(null, __wdio_args)');
    });

    it('should embed args JSON', () => {
      const result = wrapScriptForDirectEval('arguments[0] * 2', '[21]');
      expect(result).toContain(': [21];');
    });
  });

  describe('string statement scripts', () => {
    it('should wrap a const declaration', () => {
      const result = wrapScriptForDirectEval('const x = 1; return x;', '[]');
      expect(result).toContain('(async function() { const x = 1; return x; }).apply(null, __wdio_args)');
    });

    it('should wrap a let declaration', () => {
      const result = wrapScriptForDirectEval('let x = 2; return x;', '[]');
      expect(result).toContain('(async function() { let x = 2; return x; }).apply(null, __wdio_args)');
    });

    it('should wrap an if statement', () => {
      const result = wrapScriptForDirectEval('if (true) { return 1; }', '[]');
      expect(result).toContain('(async function() { if (true) { return 1; } }).apply(null, __wdio_args)');
    });

    it('should wrap a script with semicolons as statement', () => {
      const result = wrapScriptForDirectEval('var x = 1; var y = 2; return x + y;', '[]');
      expect(result).toContain('(async function() { var x = 1; var y = 2; return x + y; }).apply(null, __wdio_args)');
    });

    it('should wrap a return statement', () => {
      const result = wrapScriptForDirectEval('return document.title', '[]');
      expect(result).toContain('(async function() { return document.title }).apply(null, __wdio_args)');
    });

    it('should NOT wrap return statement as expression', () => {
      const result = wrapScriptForDirectEval('return 42', '[]');
      expect(result).not.toContain('return return 42');
      expect(result).toContain('(async function() { return 42 }).apply(null');
    });
  });

  describe('arguments', () => {
    // Runs a wrapped script as the plugin does: its arguments, then the done callback
    function run(wrapped: string, ...args: unknown[]): Promise<unknown> {
      return new Promise((resolve) => {
        new Function(wrapped).apply(null, [...args, resolve]);
      });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should use the arguments the plugin passes, such as an element it resolved from a reference', async () => {
      vi.stubGlobal('window', { __wdio_original_core__: { invoke: vi.fn() } });
      const element = { tagName: 'BUTTON' };

      const result = await run(
        wrapScriptForDirectEval('(tauri, el) => el', '[{"element-6066-11e4-a52e-4f735466cecf":"p-0"}]'),
        element,
      );

      expect(result).toEqual({ ok: true, value: element, undef: false });
      expect((result as { value: unknown }).value).toBe(element);
    });

    it('should use the inlined arguments when the plugin passes only the callback', async () => {
      vi.stubGlobal('window', { __wdio_original_core__: { invoke: vi.fn() } });

      await expect(run(wrapScriptForDirectEval('(tauri, a, b) => a + b', '[1,2]'))).resolves.toEqual({
        ok: true,
        value: 3,
        undef: false,
      });
    });

    it('should do the same for string scripts', async () => {
      const wrapped = wrapScriptForDirectEval('arguments[0] * 2', '[21]');

      await expect(run(wrapped)).resolves.toMatchObject({ value: 42 });
      await expect(run(wrapped, 5)).resolves.toMatchObject({ value: 10 });
    });
  });

  describe('callback contract', () => {
    it('should always set up the __cb callback', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      }
    });

    it('should always call __cb on success', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('__cb({ ok: true,');
      }
    });

    it('should always call __cb on error', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('__cb({ ok: false,');
      }
    });
  });
});

describe('wrapScriptForWebDriver', () => {
  type Outcome = { ok: boolean; value?: unknown; undef?: boolean; error?: string };

  // Runs the script as Execute Async Script does: a function body whose last argument is the callback.
  function runInPage(
    { script, args }: { script: string; args: string[] },
    window: Record<string, unknown>,
    globals: Record<string, unknown> = {},
  ): Promise<Outcome> {
    return new Promise((resolve) => {
      vm.runInNewContext(`(function () { ${script} }).apply(null, __args.concat([__done]))`, {
        window,
        __args: args,
        __done: resolve,
        setTimeout,
        ...globals,
      });
    });
  }

  function tauriWindow(label: string | undefined, ipcResult: () => Promise<unknown>) {
    return {
      __TAURI_INTERNALS__: label === undefined ? {} : { metadata: { currentWindow: { label } } },
      __wdio_original_core__: { invoke: vi.fn(async (cmd: string) => `real:${cmd}`) },
      __wdio_mocks__: { mocked_cmd: vi.fn(async () => 'mocked') },
      wdioTauri: { execute: vi.fn(ipcResult) },
    };
  }

  it('should drop undefined-valued keys from plain objects, as JSON does, and leave other objects alone', async () => {
    const window = tauriWindow(undefined, async () => undefined);
    const element = { nodeType: 1 };

    const outcome = await runInPage(
      wrapScriptForWebDriver(
        '() => ({ a: undefined, b: 1, nested: { c: undefined }, list: [1], el: window.el })',
        '[]',
      ),
      { ...window, el: element },
    );

    const value = outcome.value as { nested: object; el: unknown };
    expect(Object.keys(value)).toEqual(['b', 'nested', 'list', 'el']);
    expect(Object.keys(value.nested)).toEqual([]);
    expect(value.el).toBe(element);
  });

  it('should run the script in the page when no window is chosen', async () => {
    const wrapped = wrapScriptForWebDriver('(tauri, a) => a * 2', '[21]');

    expect(wrapped.args).toEqual([]);
    expect(wrapped.script).toContain(wrapScriptForDirectEval('(tauri, a) => a * 2', '[21]'));
    expect(
      await runInPage(
        wrapped,
        tauriWindow('main', async () => 'ipc'),
      ),
    ).toEqual({
      ok: true,
      value: 42,
      undef: false,
    });
  });

  it("should run the script in the page when the chosen window is the page's own", async () => {
    const window = tauriWindow('main', async () => 'ipc');

    const outcome = await runInPage(
      wrapScriptForWebDriver(
        'async ({ core }) => [await core.invoke("mocked_cmd"), await core.invoke("x")]',
        '[]',
        'main',
      ),
      window,
    );

    expect(outcome).toEqual({ ok: true, value: ['mocked', 'real:x'], undef: false });
    expect(window.wdioTauri.execute).not.toHaveBeenCalled();
  });

  it("should run a string script in the page when the chosen window is the page's own", async () => {
    const outcome = await runInPage(
      wrapScriptForWebDriver('return arguments[0] + 1', '[41]', 'main'),
      tauriWindow('main', async () => 'ipc'),
    );

    expect(outcome).toEqual({ ok: true, value: 42, undef: false });
  });

  it('should send the script to another window through the plugin', async () => {
    const window = tauriWindow('main', async () => ({ from: 'popup' }));

    const outcome = await runInPage(wrapScriptForWebDriver('(tauri, a) => a', '[1]', 'popup'), window);

    expect(outcome).toEqual({ ok: true, value: { from: 'popup' }, undef: false });
    expect(window.wdioTauri.execute).toHaveBeenCalledWith('(tauri, a) => a', { windowLabel: 'popup' }, '[1]');
  });

  it('should use the plugin when the page has no window metadata', async () => {
    const window = tauriWindow(undefined, async () => 'ipc');

    expect(await runInPage(wrapScriptForWebDriver('() => 1', '[]', 'main'), window)).toEqual({
      ok: true,
      value: 'ipc',
      undef: false,
    });
  });

  it("should report undefined from the plugin's marker", async () => {
    const outcome = await runInPage(
      wrapScriptForWebDriver('() => undefined', '[]', 'popup'),
      tauriWindow('main', async () => ({ __wdio_undefined__: true })),
    );

    expect(outcome).toEqual({ ok: true, value: null, undef: true });
  });

  it('should point to withGlobalTauri when core.invoke never appears', async () => {
    const window = { ...tauriWindow('main', async () => 'ipc'), __wdio_original_core__: undefined };
    let now = 0;
    // Each check of the clock moves it on a second, so the 5 s wait ends without waiting.
    const clock = { now: () => (now += 1000) };

    const outcome = await runInPage(wrapScriptForWebDriver('() => 1', '[]'), window, {
      Date: clock,
      setTimeout: (fn: () => void) => fn(),
    });

    expect(outcome).toEqual({
      ok: false,
      error:
        'Tauri core.invoke not available after 5s timeout. Make sure withGlobalTauri is enabled in tauri.conf.json',
    });
  });

  it("should report the plugin's error", async () => {
    const outcome = await runInPage(
      wrapScriptForWebDriver('() => 1', '[]', 'popup'),
      tauriWindow('main', async () => {
        throw new Error('Failed to execute script: boom');
      }),
    );

    expect(outcome).toEqual({ ok: false, error: 'Failed to execute script: boom' });
  });

  it('should give the plugin the script, label and args as data, not source', async () => {
    const userScript = `() => "a${String.fromCharCode(0x2028)}b</script>"`;
    const window = tauriWindow('main', async () => 'ipc');

    const wrapped = wrapScriptForWebDriver(userScript, '["</script>"]', 'po"pup');
    await runInPage(wrapped, window);

    expect(wrapped.args).toEqual(['po"pup', userScript, '["</script>"]']);
    expect(window.wdioTauri.execute).toHaveBeenCalledWith(userScript, { windowLabel: 'po"pup' }, '["</script>"]');
  });
});
