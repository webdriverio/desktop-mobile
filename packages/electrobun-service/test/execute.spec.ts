import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import type { Result } from '@wdio/native-types';
import { describe, expect, it, vi } from 'vitest';

import { execute, stashedNodeResolver } from '../src/commands/execute.js';
import { STASH_NODES_JS } from '../src/commands/stashNodes.js';
import { WebDriverEvalBridge } from '../src/webdriverEval.js';

function makeBridge(response: unknown): { bridge: CdpBridge; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue(response);
  const bridge = { send } as unknown as CdpBridge;
  return { bridge, send };
}

const noNodes = vi.fn();

describe('execute', () => {
  it('should inline function args as JSON literals into the IIFE', async () => {
    const { bridge, send } = makeBridge({ result: { value: 'done' } });

    await execute(bridge, noNodes, (_eb, a: number, b: string) => `${a}${b}`, 7, 'x');

    const expression = send.mock.calls[0][1].expression as string;
    expect(expression).toContain('7, "x"');
    expect(expression).toContain('__WDIO_ELECTROBUN__');
  });

  it('should return the evaluated value', async () => {
    const { bridge } = makeBridge({ result: { value: { ok: true } } });

    const result = await execute(bridge, noNodes, () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
  });

  it('should wrap a bare string expression so its value is returned', async () => {
    const { bridge, send } = makeBridge({ result: { value: 2 } });

    await execute(bridge, noNodes, 'document.title');

    expect(send.mock.calls[0][1].expression).toContain('await (async function () { return (document.title\n); })()');
  });

  it('should wrap a statement-style string (leading return) as a function body', async () => {
    const { bridge, send } = makeBridge({ result: { value: 42 } });

    await execute(bridge, noNodes, 'return 42');

    expect(send.mock.calls[0][1].expression).toContain('await (async function () { return 42\n})()');
  });

  it('should return the value of a string script that ends in a line comment', async () => {
    const win: FakeWindow = { title: 'My App' };

    expect(await execute(pageBridge(win).bridge, noNodes, 'window.title // the title')).toBe('My App');
    expect(await execute(pageBridge(win).bridge, noNodes, 'return window.title // the title')).toBe('My App');
  });

  it("should put a string script on the expression's first line, so its errors keep their line numbers", async () => {
    const { bridge, send } = makeBridge({ result: { value: 1 } });

    await execute(bridge, noNodes, 'return 1');

    expect((send.mock.calls[0][1].expression as string).split('\n')[0]).toContain('return 1');
  });

  it('should throw a descriptive error for non-JSON-serialisable args', async () => {
    const { bridge } = makeBridge({ result: { value: undefined } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(execute(bridge, noNodes, (_eb, _arg: unknown) => undefined, circular)).rejects.toThrow(
      /not JSON-serialisable/,
    );
  });

  it('should reject function/symbol args instead of silently dropping them', async () => {
    const { bridge, send } = makeBridge({ result: { value: undefined } });

    await expect(
      execute(
        bridge,
        noNodes,
        (_eb, _arg: unknown) => undefined,
        () => 1,
      ),
    ).rejects.toThrow(/not JSON-serialisable/);
    await expect(execute(bridge, noNodes, (_eb, _arg: unknown) => undefined, Symbol('s'))).rejects.toThrow(
      /not JSON-serialisable/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('should surface Runtime.evaluate exceptionDetails as a thrown error', async () => {
    const { bridge } = makeBridge({ exceptionDetails: { text: 'ReferenceError: x is not defined' } });

    await expect(execute(bridge, noNodes, () => undefined)).rejects.toThrow(/x is not defined/);
  });
});

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type FakeWindow = Record<string, unknown>;

function element(id: string) {
  return { nodeType: 1, id };
}

function list(...items: unknown[]) {
  const value: Record<string | symbol, unknown> = { length: items.length, [Symbol.iterator]: () => items.values() };
  items.forEach((item, i) => {
    value[i] = item;
  });
  return value;
}

function stashNodes(win: FakeWindow) {
  return new Function('window', `${STASH_NODES_JS}; return __wdioStashNodes;`)(win) as (
    value: unknown,
    stash: string,
    mark: string,
  ) => unknown;
}

describe('the page-side node stash', () => {
  it('should swap an element for a placeholder and keep it on window', () => {
    const win: FakeWindow = {};
    const el = element('counter');

    const result = stashNodes(win)(el, 'stash', 'mark');

    expect(result).toEqual({ mark: 1, value: { mark: 0 } });
    expect(win.stash).toEqual([el]);
    expect((win.stash as unknown[])[0]).toBe(el);
  });

  it('should swap nested elements and shadow roots, in order', () => {
    const win: FakeWindow = {};
    const root = { nodeType: 11, host: element('host') };

    const result = stashNodes(win)({ a: [element('x'), { b: root }], n: 1 }, 'stash', 'mark');

    expect(result).toEqual({ mark: 2, value: { a: [{ mark: 0 }, { b: { mark: 1 } }], n: 1 } });
    expect(win.stash).toEqual([element('x'), root]);
  });

  it('should keep nothing, and remove the null, when the stash was nulled by a failed call', () => {
    const win: FakeWindow = { stash: null };
    const value = [element('counter')];

    expect(stashNodes(win)(value, 'stash', 'mark')).toBe(value);
    expect(win).not.toHaveProperty('stash');
  });

  it('should keep a node that appears twice once, with both placeholders pointing at it', () => {
    const win: FakeWindow = {};
    const el = element('counter');

    expect(stashNodes(win)([el, { again: el }], 'stash', 'mark')).toEqual({
      mark: 1,
      value: [{ mark: 0 }, { again: { mark: 0 } }],
    });
    expect(win.stash).toEqual([el]);
  });

  it('should treat a callable element as an element', () => {
    const win: FakeWindow = {};
    const embed = Object.assign(() => undefined, { nodeType: 1 });

    expect(stashNodes(win)([embed], 'stash', 'mark')).toEqual({ mark: 1, value: [{ mark: 0 }] });
  });

  it('should leave a document fragment that is not a shadow root as a plain object', () => {
    const win: FakeWindow = {};
    const fragment = { nodeType: 11 };

    expect(stashNodes(win)(fragment, 'stash', 'mark')).toBe(fragment);
    expect(win).not.toHaveProperty('stash');
  });

  it('should turn an indexed list into an array of placeholders', () => {
    const win: FakeWindow = {};

    const result = stashNodes(win)(list(element('a'), element('b')), 'stash', 'mark');

    expect(result).toEqual({ mark: 2, value: [{ mark: 0 }, { mark: 1 }] });
  });

  it('should turn an empty list into an empty array without stashing anything', () => {
    const win: FakeWindow = {};

    expect(stashNodes(win)(list(), 'stash', 'mark')).toEqual({ mark: 0, value: [] });
    expect(win).not.toHaveProperty('stash');
  });

  it('should return a result without nodes or lists unchanged', () => {
    const win: FakeWindow = {};
    const value = { a: [1, 'x', null], b: { c: true } };

    expect(stashNodes(win)(value, 'stash', 'mark')).toBe(value);
    expect(win).not.toHaveProperty('stash');
  });

  it('should return a result JSON.stringify rejects unchanged, without stashing its nodes', () => {
    const win: FakeWindow = {};
    const value: Record<string, unknown> = { el: element('x') };
    value.self = value;

    expect(stashNodes(win)(value, 'stash', 'mark')).toBe(value);
    expect(win).not.toHaveProperty('stash');
  });
});

// Runs the expression the way Runtime.evaluate does with returnByValue: in the page, then copied by value.
function pageBridge(win: FakeWindow): { bridge: CdpBridge; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async (_method: string, { expression }: { expression: string }) => {
    const value = await new Function('window', `return ${expression}`)(win);
    return { result: { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } };
  });
  return { bridge: { send } as unknown as CdpBridge, send };
}

// What the WebDriver session's Execute Script returns for the stashed nodes.
function sessionResolver(win: FakeWindow) {
  return vi.fn(async (stash: string, _count: number): Promise<Result<unknown[]>> => {
    const nodes = win[stash] as Array<{ nodeType: number; id?: string; host?: { id: string } }>;
    delete win[stash];
    return {
      ok: true,
      value: nodes.map((node) => (node.nodeType === 1 ? { [ELEMENT_KEY]: node.id } : { [SHADOW_KEY]: node.host?.id })),
    };
  });
}

describe('execute — DOM nodes in the result', () => {
  it('should return an element as the session reference', async () => {
    const win: FakeWindow = { el: element('counter') };
    const resolve = sessionResolver(win);

    const result = await execute(pageBridge(win).bridge, resolve, 'return window.el');

    expect(result).toEqual({ [ELEMENT_KEY]: 'counter' });
    expect(resolve).toHaveBeenCalledWith(expect.stringMatching(/^__wdio_electrobun_nodes_[0-9a-f]{32}$/), 1);
    expect(Object.keys(win)).toEqual(['el']);
  });

  it('should return elements and shadow roots nested in objects and lists as references', async () => {
    const win: FakeWindow = {
      els: list(element('a'), element('b')),
      root: { nodeType: 11, host: element('host') },
    };

    const result = await execute(
      pageBridge(win).bridge,
      sessionResolver(win),
      'return { count: 2, els: window.els, deep: [{ root: window.root }] }',
    );

    expect(result).toEqual({
      count: 2,
      els: [{ [ELEMENT_KEY]: 'a' }, { [ELEMENT_KEY]: 'b' }],
      deep: [{ root: { [SHADOW_KEY]: 'host' } }],
    });
  });

  it('should return an element from an async function as a reference', async () => {
    const win: FakeWindow = { __WDIO_ELECTROBUN__: { el: element('counter') } };

    const result = await execute(
      pageBridge(win).bridge,
      sessionResolver(win),
      async (eb, key: string) => {
        await Promise.resolve();
        return { [key]: (eb as unknown as Record<string, unknown>).el };
      },
      'found',
    );

    expect(result).toEqual({ found: { [ELEMENT_KEY]: 'counter' } });
  });

  it('should not ask the session for nodes when the result has none', async () => {
    const win: FakeWindow = { els: list() };
    const resolve = sessionResolver(win);

    expect(await execute(pageBridge(win).bridge, resolve, 'return { a: 1, els: window.els }')).toEqual({
      a: 1,
      els: [],
    });
    expect(await execute(pageBridge(win).bridge, resolve, 'return { a: 1 }')).toEqual({ a: 1 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('should return an element as a reference over the Linux W3C eval bridge', async () => {
    const win: FakeWindow = { el: element('counter') };
    // Runs the posted /execute/async script in the page and returns what `done` got, by value.
    const poster = (script: string) =>
      new Promise<{ value: unknown }>((resolve) => {
        new Function('window', script)(win, (value: unknown) => resolve({ value: JSON.parse(JSON.stringify(value)) }));
      });
    const bridge = new WebDriverEvalBridge(poster) as unknown as CdpBridge;

    const result = await execute(bridge, sessionResolver(win), 'return [window.el]');

    expect(result).toEqual([{ [ELEMENT_KEY]: 'counter' }]);
  });

  it("should leave an object that looks like another call's placeholder alone", async () => {
    const win: FakeWindow = { el: element('x') };

    const result = await execute(
      pageBridge(win).bridge,
      sessionResolver(win),
      'return { el: window.el, other: { __wdio_node_00000000000000000000000000000000__: 0 } }',
    );

    expect(result).toEqual({
      el: { [ELEMENT_KEY]: 'x' },
      other: { __wdio_node_00000000000000000000000000000000__: 0 },
    });
  });

  it("should throw the resolver's error and discard the nodes", async () => {
    const win: FakeWindow = { el: element('counter') };
    const { bridge, send } = pageBridge(win);
    const error = new Error('no such window');

    await expect(execute(bridge, vi.fn().mockResolvedValue({ ok: false, error }), 'return window.el')).rejects.toBe(
      error,
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(Object.keys(win)).toEqual(['el']);
  });

  it('should return an element that appears twice as the same reference, reading it once', async () => {
    const win: FakeWindow = { el: element('counter') };
    const resolve = sessionResolver(win);
    let stashed: unknown;
    resolve.mockImplementationOnce(async (stash: string) => {
      stashed = win[stash];
      return { ok: true, value: [{ [ELEMENT_KEY]: 'counter' }] };
    });

    const result = await execute(pageBridge(win).bridge, resolve, 'return [window.el, { again: window.el }]');

    expect(result).toEqual([{ [ELEMENT_KEY]: 'counter' }, { again: { [ELEMENT_KEY]: 'counter' } }]);
    expect(stashed).toEqual([element('counter')]);
  });

  it('should discard the nodes in the target the script ran in, after a switch', async () => {
    const win: FakeWindow = { el: element('counter') };
    const { bridge } = pageBridge(win);
    const sendTo = vi.fn(async (_label: string, _method: string, params: { expression: string }) =>
      (bridge.send as unknown as (method: string, params: { expression: string }) => Promise<unknown>)(
        'Runtime.evaluate',
        params,
      ),
    );
    Object.assign(bridge, { activeLabel: 'main', sendTo });
    const resolve = vi.fn(async (): Promise<Result<unknown[]>> => {
      Object.assign(bridge, { activeLabel: 'window-1' });
      return { ok: false, error: new Error('no such window') };
    });

    await expect(execute(bridge, resolve, 'return window.el')).rejects.toThrow();
    expect(sendTo).toHaveBeenCalledWith('main', 'Runtime.evaluate', {
      expression: expect.stringMatching(/^delete window\["__wdio_electrobun_nodes_[0-9a-f]{32}"\]$/),
    });
    expect(Object.keys(win)).toEqual(['el']);
  });

  it('should discard the nodes when the call fails after the page stashed them, and rethrow', async () => {
    const win: FakeWindow = { el: element('counter') };
    const { send: runInPage } = pageBridge(win);
    const timeout = new Error('CDP timed out');
    const send = vi.fn(async (method: string, params: { expression: string }) => {
      await runInPage(method, params);
      if (send.mock.calls.length === 1) {
        throw timeout;
      }
      return { result: {} };
    });

    await expect(execute({ send } as unknown as CdpBridge, sessionResolver(win), 'return window.el')).rejects.toBe(
      timeout,
    );
    await vi.waitFor(() => expect(Object.keys(win)).toEqual(['el']));
  });

  it("should stop a script that's still running when the call fails from stashing its nodes later", async () => {
    const win: FakeWindow = { el: element('counter') };
    const { send: runInPage } = pageBridge(win);
    const timeout = new Error('CDP timed out');
    let script: { expression: string } | undefined;
    const send = vi.fn(async (method: string, params: { expression: string }) => {
      if (!script) {
        script = params;
        throw timeout;
      }
      return runInPage(method, params);
    });

    await expect(execute({ send } as unknown as CdpBridge, sessionResolver(win), 'return window.el')).rejects.toBe(
      timeout,
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await runInPage('Runtime.evaluate', script as { expression: string });

    expect(Object.keys(win)).toEqual(['el']);
  });

  it('should discard the nodes over the Linux W3C eval bridge when the request fails', async () => {
    const win: FakeWindow = { el: element('counter') };
    const failure = new Error('execute/async request timed out');
    let calls = 0;
    const poster = (script: string) =>
      new Promise<{ value: unknown }>((resolve, reject) => {
        calls += 1;
        const first = calls === 1;
        new Function('window', script)(win, (value: unknown) =>
          first ? reject(failure) : resolve({ value: JSON.parse(JSON.stringify(value)) }),
        );
      });

    await expect(
      execute(new WebDriverEvalBridge(poster) as unknown as CdpBridge, sessionResolver(win), 'return window.el'),
    ).rejects.toBe(failure);
    await vi.waitFor(() => expect(Object.keys(win)).toEqual(['el']));
  });

  it("should not clean up after the user's script throws", async () => {
    const { bridge, send } = makeBridge({ exceptionDetails: { text: 'Error: boom' } });

    await expect(execute(bridge, noNodes, 'throw new Error("boom")')).rejects.toThrow('boom');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('stashedNodeResolver', () => {
  function sessionReturning(value: unknown) {
    return {
      execute: typeof value === 'function' ? vi.fn(value as () => unknown) : vi.fn().mockResolvedValue(value),
    } as unknown as WebdriverIO.Browser;
  }

  it("should read and delete the stash through the session's Execute Script", async () => {
    const refs = [{ [ELEMENT_KEY]: 'x' }, { [SHADOW_KEY]: 'y' }];
    const browser = sessionReturning(refs);

    expect(await stashedNodeResolver(browser)('__wdio_electrobun_nodes_abc', 2)).toEqual({ ok: true, value: refs });
    expect(browser.execute).toHaveBeenCalledWith(
      'var nodes = window[arguments[0]]; delete window[arguments[0]]; return nodes;',
      '__wdio_electrobun_nodes_abc',
    );
  });

  it("should fail when the session doesn't find the stash, naming the likely causes", async () => {
    const result = await stashedNodeResolver(sessionReturning(null))('stash', 1);

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining(
          "the WebDriver session couldn't find them: it isn't on the window or frame the script ran in, or the page navigated first",
        ),
      },
    });
  });

  it("should fail with the session's error as the cause", async () => {
    const error = new Error('no such window');

    const result = await stashedNodeResolver(sessionReturning(() => Promise.reject(error)))('stash', 1);

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: "browser.electrobun.execute could not return the result's DOM nodes: no such window",
        cause: error,
      },
    });
  });

  it.each([
    ['too few references', [{ [ELEMENT_KEY]: 'x' }]],
    ['a null reference', [{ [ELEMENT_KEY]: 'x' }, null]],
    ['a reference without an ID', [{ [ELEMENT_KEY]: 'x' }, { [ELEMENT_KEY]: undefined }]],
    ['something else', [{ [ELEMENT_KEY]: 'x' }, { id: 'y' }]],
  ])('should fail when the session returns %s', async (_name, refs) => {
    const result = await stashedNodeResolver(sessionReturning(refs))('stash', 2);

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('expected 2 element or shadow root references') },
    });
  });
});
