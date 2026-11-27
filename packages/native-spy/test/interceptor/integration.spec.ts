import { describe, expect, it } from 'vitest';
import { type BatchCallDataTarget, createIpcInterceptor } from '../../src/interceptor/index.js';
import { fn } from '../../src/mock.js';

type SyntheticWindow = {
  __wdio_spy__: { fn: typeof fn };
  __wdio_mocks__: Record<string, ReturnType<typeof fn>>;
  __wdio_ipc_context__?: Record<string, unknown>;
  __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
};

type TauriCore = { core: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };
type AnyFn = (...a: unknown[]) => unknown;

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
      expect(typeof win.__wdio_mocks__.my_cmd).toBe('function');
    });

    it('should call mockClear so calls start empty', () => {
      const win = makeSyntheticWindow();
      const script = interceptor.buildRegistrationScript('my_cmd');
      evalScript(script, win);
      const mock = win.__wdio_mocks__.my_cmd;
      mock('some_arg');
      evalScript(script, win);
      expect(win.__wdio_mocks__.my_cmd.mock.calls).toHaveLength(0);
    });

    it('should return the label of the window it ran in', () => {
      const win = {
        ...makeSyntheticWindow(),
        __TAURI_INTERNALS__: { metadata: { currentWindow: { label: 'settings' } } },
      };
      const script = interceptor.buildRegistrationScript('my_cmd');
      expect(evalScript(script, win)).toBe('settings');
    });
  });

  describe('buildCallDataReadScript', () => {
    it('should return call data', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      win.__wdio_mocks__.my_cmd('arg1');
      win.__wdio_mocks__.my_cmd('arg2');

      const readScript = interceptor.buildCallDataReadScript('my_cmd');
      const raw = evalScript(readScript, win);
      const data = interceptor.parseCallData(raw);
      expect(data.calls).toHaveLength(2);
    });

    it('should round-trip Error results without losing detail', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      const mock = win.__wdio_mocks__.my_cmd;
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
      const mock = win.__wdio_mocks__.my_cmd;
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

      const result = win.__wdio_mocks__.my_cmd();
      expect(result).toBe('hello');
    });

    it('should use mockImplementationOnce when once=true', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);

      const s = interceptor.serializeHandler(() => 'once');
      evalScript(interceptor.buildSetImplementationScript('my_cmd', s, true), win);

      expect(win.__wdio_mocks__.my_cmd()).toBe('once');
      expect(win.__wdio_mocks__.my_cmd()).toBeUndefined();
    });
  });

  describe('buildInnerSetterScript', () => {
    it('should set return value for mockReturnValue', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      evalScript(interceptor.buildInnerSetterScript('my_cmd', 'mockReturnValue', 42), win);
      expect(win.__wdio_mocks__.my_cmd()).toBe(42);
    });

    it('should reconstruct Error for mockRejectedValue', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      evalScript(interceptor.buildInnerSetterScript('my_cmd', 'mockRejectedValue', new Error('fail msg')), win);

      expect(() => win.__wdio_mocks__.my_cmd()).toThrow('fail msg');
    });
  });

  describe('buildInnerInvocationScript', () => {
    it('should empty call history for mockClear', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      win.__wdio_mocks__.my_cmd('test');
      expect(win.__wdio_mocks__.my_cmd.mock.calls).toHaveLength(1);

      evalScript(interceptor.buildInnerInvocationScript('my_cmd', 'mockClear'), win);
      expect(win.__wdio_mocks__.my_cmd.mock.calls).toHaveLength(0);
    });
  });

  describe('buildUnregistrationScript', () => {
    it('should remove mock from __wdio_mocks__', () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      expect(win.__wdio_mocks__.my_cmd).toBeDefined();

      evalScript(interceptor.buildUnregistrationScript('my_cmd'), win);
      expect(win.__wdio_mocks__.my_cmd).toBeUndefined();
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

  describe('buildWithImplementationScript', () => {
    it('should pass the tauri object to the callback and keep the implementation until it settles', async () => {
      const win = makeSyntheticWindow();
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      win.__wdio_mocks__.my_cmd.mockReturnValue('original');
      const tauri: TauriCore = { core: { invoke: async (cmd, args) => win.__wdio_mocks__[cmd](args) } };
      const callback = async ({ core }: TauriCore) => {
        await Promise.resolve();
        return core.invoke('my_cmd');
      };
      const script = interceptor.buildWithImplementationScript('my_cmd', () => 'temporary', callback as AnyFn);

      const result = await new Function('window', 'tauri', `return (${script})(tauri)`)(win, tauri);

      expect(result).toBe('temporary');
      expect(win.__wdio_mocks__.my_cmd()).toBe('original');
    });

    it('should build the tauri object from the mocked IPC when called without one', async () => {
      const win = makeSyntheticWindow();
      win.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => win.__wdio_mocks__[cmd](args) };
      evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
      const callback = ({ core }: TauriCore) => core.invoke('my_cmd', { a: 1 });
      const script = interceptor.buildWithImplementationScript('my_cmd', () => 'temporary', callback as AnyFn);

      const result = await evalScript(script, win);

      expect(result).toBe('temporary');
      expect(win.__wdio_mocks__.my_cmd.mock.calls).toEqual([[{ a: 1 }]]);
    });

    it('should reject without running the callback when the command is not mocked in this window', async () => {
      const win = makeSyntheticWindow();
      let called = false;
      const callback = () => {
        called = true;
      };
      const script = interceptor.buildWithImplementationScript('my_cmd', () => 'temporary', callback);

      await expect(evalScript(script, win)).rejects.toMatchObject({ message: 'my_cmd is not mocked in this window' });
      expect(called).toBe(false);
    });
  });
});

describe('ElectronAdapter integration (synthetic window)', () => {
  const interceptor = createIpcInterceptor('electron');

  it('should reject withImplementation without running the callback when the channel is not mocked', async () => {
    const win = makeSyntheticWindow();
    let called = false;
    const callback = () => {
      called = true;
    };
    const script = interceptor.buildWithImplementationScript('my-channel', () => 'temporary', callback);

    await expect(evalScript(script, win)).rejects.toMatchObject({ message: 'my-channel is not mocked in this window' });
    expect(called).toBe(false);
  });
});

// Native mode records with native-spy's `fn`; browser mode with the injection script's `createMockFn`.
const callDataCases = (['tauri', 'electron', 'dioxus'] as const).flatMap((framework) =>
  (['native-spy', 'browser-mode'] as const).map((spy) => [framework, spy] as const),
);

describe.each(callDataCases)('%s call data read with the %s spy (synthetic window)', (framework, spy) => {
  const interceptor = createIpcInterceptor(framework);

  function makeWindow(): SyntheticWindow {
    if (spy === 'native-spy') {
      return makeSyntheticWindow();
    }
    const win = {} as SyntheticWindow;
    new Function('window', interceptor.buildBrowserIpcInjectionScript())(win);
    return win;
  }

  function setup() {
    const win = makeWindow();
    evalScript(interceptor.buildRegistrationScript('my_cmd'), win);
    return { win, mock: win.__wdio_mocks__.my_cmd };
  }

  // WebDriver and CDP return the result as JSON, so clone it the same way.
  function read(win: SyntheticWindow) {
    const raw = JSON.parse(JSON.stringify(evalScript(interceptor.buildCallDataReadScript('my_cmd'), win)));
    return interceptor.parseCallData(raw);
  }

  it('should keep undefined arguments and the call length', () => {
    const { win, mock } = setup();
    mock({ a: 1 }, undefined);
    mock(undefined);
    mock();

    expect(read(win).calls).toStrictEqual([[{ a: 1 }, undefined], [undefined], []]);
  });

  it('should keep undefined inside nested arrays and objects', () => {
    const { win, mock } = setup();
    mock([1, undefined, 2], { a: undefined, b: { c: undefined } });

    expect(read(win).calls).toStrictEqual([[[1, undefined, 2], { a: undefined, b: { c: undefined } }]]);
  });

  it('should keep null distinct from undefined', () => {
    const { win, mock } = setup();
    mock(null, undefined);
    mock.mockReturnValueOnce(null);
    mock();
    mock();

    const data = read(win);
    expect(data.calls[0]).toStrictEqual([null, undefined]);
    expect(data.results.map((r) => r.value)).toStrictEqual([undefined, null, undefined]);
  });

  it('should satisfy toHaveBeenCalledWith on an outer mock replaying the calls', () => {
    const { win, mock } = setup();
    mock({ a: 1 }, undefined);

    const outer = fn();
    for (const args of read(win).calls) {
      outer(...args);
    }
    expect(outer).toHaveBeenCalledWith({ a: 1 }, undefined);
    expect(outer).not.toHaveBeenCalledWith({ a: 1 }, null);
  });

  function readBatch(win: SyntheticWindow, targets: Array<string | BatchCallDataTarget>) {
    const raw = JSON.parse(JSON.stringify(evalScript(interceptor.buildBatchCallDataReadScript(targets), win)));
    return interceptor.parseBatchCallData(raw);
  }

  it('should read multiple mocks in one eval with undefined and Error values preserved', () => {
    const win = makeWindow();
    evalScript(interceptor.buildRegistrationScript('cmd_a'), win);
    evalScript(interceptor.buildRegistrationScript('cmd_b'), win);
    win.__wdio_mocks__.cmd_a('first', undefined);
    win.__wdio_mocks__.cmd_b(new Error('bad input'));

    const batch = readBatch(win, ['cmd_a', 'cmd_b', 'missing_cmd']);
    expect(batch.cmd_a.calls).toStrictEqual([['first', undefined]]);
    expect(batch.cmd_b.calls[0][0]).toBeInstanceOf(Error);
    expect((batch.cmd_b.calls[0][0] as Error).message).toBe('bad input');
    expect(batch.missing_cmd.calls).toStrictEqual([]);
  });

  it('should mark unchanged mocks and return only delta calls when since matches history', () => {
    const win = makeWindow();
    evalScript(interceptor.buildRegistrationScript('cmd_a'), win);
    evalScript(interceptor.buildRegistrationScript('cmd_b'), win);
    win.__wdio_mocks__.cmd_a('one');
    const firstOrder = win.__wdio_mocks__.cmd_a.mock.invocationCallOrder[0];

    const first = readBatch(win, [
      { name: 'cmd_a', since: 0 },
      { name: 'cmd_b', since: 0 },
    ]);
    expect(first.cmd_a.calls).toStrictEqual([['one']]);
    expect(first.cmd_b.unchanged).toBe(true);

    win.__wdio_mocks__.cmd_a('two');
    const second = readBatch(win, [
      { name: 'cmd_a', since: 1, lastCallOrder: firstOrder },
      { name: 'cmd_b', since: 0 },
    ]);
    expect(second.cmd_a.start).toBe(1);
    expect(second.cmd_a.calls).toStrictEqual([['two']]);
    expect(second.cmd_b.unchanged).toBe(true);

    const secondOrder = win.__wdio_mocks__.cmd_a.mock.invocationCallOrder[1];
    const third = readBatch(win, [{ name: 'cmd_a', since: 2, lastCallOrder: secondOrder }]);
    expect(third.cmd_a.unchanged).toBe(true);
  });

  it('should return full reset data when inner mock shrank or cleared to equal length', () => {
    const win = makeWindow();
    evalScript(interceptor.buildRegistrationScript('cmd_a'), win);
    win.__wdio_mocks__.cmd_a('old1');
    win.__wdio_mocks__.cmd_a('old2');
    const oldLastOrder = win.__wdio_mocks__.cmd_a.mock.invocationCallOrder[1];

    win.__wdio_mocks__.cmd_a.mockClear();
    win.__wdio_mocks__.cmd_a('new1');
    const shrunk = readBatch(win, [{ name: 'cmd_a', since: 2, lastCallOrder: oldLastOrder }]);
    expect(shrunk.cmd_a.unchanged).toBeUndefined();
    expect(shrunk.cmd_a.calls).toStrictEqual([['new1']]);

    win.__wdio_mocks__.cmd_a('new2');
    const equalAfterClear = readBatch(win, [{ name: 'cmd_a', since: 2, lastCallOrder: oldLastOrder }]);
    expect(equalAfterClear.cmd_a.unchanged).toBeUndefined();
    expect(equalAfterClear.cmd_a.reset).toBe(true);
    expect(equalAfterClear.cmd_a.calls).toStrictEqual([['new1'], ['new2']]);
  });

  it('should isolate per-mock serialization errors without failing healthy mocks', () => {
    const win = makeWindow();
    evalScript(interceptor.buildRegistrationScript('healthy'), win);
    evalScript(interceptor.buildRegistrationScript('circular'), win);
    win.__wdio_mocks__.healthy('ok');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    win.__wdio_mocks__.circular(loop);

    const batch = readBatch(win, ['healthy', 'circular']);
    expect(batch.healthy.calls).toStrictEqual([['ok']]);
    expect(batch.healthy.__error).toBeUndefined();
    expect(batch.circular.__error).toEqual(expect.any(String));
  });
});
