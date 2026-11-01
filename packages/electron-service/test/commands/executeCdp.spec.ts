import type { ElectronFunctionMock } from '@wdio/native-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronCdpBridge } from '../../src/bridge.js';
import { clearParsedFunctionCache, execute } from '../../src/commands/executeCdp.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/mockStore.js', () => {
  const mockStore = {
    getMocks: vi.fn().mockReturnValue([]),
  };
  return {
    default: mockStore,
  };
});

describe('execute Command', () => {
  beforeEach(async () => {
    globalThis.browser = {} as WebdriverIO.Browser;
    globalThis.mrBrowser = {
      isMultiremote: true,
      instances: ['browserA', 'browserB'],
      getInstance: vi.fn().mockReturnValue({
        electron: {
          execute: vi.fn(),
        },
      } as unknown as WebdriverIO.Browser),
    } as unknown as WebdriverIO.MultiRemoteBrowser;
    vi.clearAllMocks();
    clearParsedFunctionCache();
  });
  const client = {
    contextId: 9999,
    connect: vi.fn(),
    on: vi.fn(),
    send: vi.fn().mockResolvedValue({ result: { result: { value: 6 } } }),
  } as unknown as ElectronCdpBridge;

  it('should throw an error when called with a script argument of the wrong type', async () => {
    await expect(() => execute(globalThis.browser, client, {} as string)).rejects.toThrowError(
      new Error('Expecting script to be type of "string" or "function"'),
    );
  });

  it('should throw an error when called without a script argument', async () => {
    // @ts-expect-error no script argument
    await expect(() => execute(globalThis.browser, {})).rejects.toThrowError(
      new Error('Expecting script to be type of "string" or "function"'),
    );
  });

  it('should return undefined when called without client', async () => {
    const result = await execute(globalThis.browser, undefined, '() => {}');
    expect(result).toBeUndefined();
  });

  it('should throw an error when the browser is not initialised', async () => {
    await expect(() =>
      execute(undefined as unknown as typeof globalThis.browser, client, '() => 1 + 2 + 3'),
    ).rejects.toThrowError(new Error('WDIO browser is not yet initialised'));
  });

  it('should execute a function', async () => {
    await execute(globalThis.browser, client, (_electron, a, b, c) => a + b + c, 1, 2, 3);
    expect(client.send).toHaveBeenCalledWith('Runtime.callFunctionOn', {
      arguments: [{ value: 1 }, { value: 2 }, { value: 3 }],
      awaitPromise: true,
      executionContextId: 9999,
      functionDeclaration: '(a, b, c) => a + b + c',
      returnByValue: true,
    });
  });

  it('should execute a stringified function', async () => {
    await execute(globalThis.browser, client, '(electron) => 1 + 2 + 3');
    expect(client.send).toHaveBeenCalledWith('Runtime.callFunctionOn', {
      arguments: [],
      awaitPromise: true,
      executionContextId: 9999,
      functionDeclaration: '() => 1 + 2 + 3',
      returnByValue: true,
    });
  });

  it('should execute a function when multi remote browser', async () => {
    const mockElectron = globalThis.mrBrowser.getInstance('browserA');
    await execute(globalThis.mrBrowser, client, (_electron, a, b, c) => a + b + c, 1, 2, 3);

    expect(mockElectron.electron.execute).toHaveBeenCalledTimes(2); // Because mrBrowser has 2 browser instance
  });

  it('should execute a function declaration', async () => {
    await execute(
      globalThis.browser,
      client,
      function test(_electron, a: number, b: number, c: number) {
        return a + b + c;
      },
      1,
      2,
      3,
    );

    expect(client.send).toHaveBeenCalledWith('Runtime.callFunctionOn', {
      arguments: [{ value: 1 }, { value: 2 }, { value: 3 }],
      awaitPromise: true,
      executionContextId: 9999,
      functionDeclaration: expect.stringMatching(/function test\(a, b, c\)\s*\{\s*return a \+ b \+ c;\s*\}/),
      returnByValue: true,
    });
  });

  it('should wrap statement-style string scripts in async IIFE', async () => {
    // Statements like 'const a = 1' are now wrapped and executed properly (no longer throw)
    await execute(globalThis.browser, client, 'const a = 1');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        functionDeclaration: expect.stringContaining('async function() { const a = 1 }'),
      }),
    );
  });

  it('should treat semicolon after escaped backslash as real (not skip it)', async () => {
    // "foo\\";bar" — the backslash is itself escaped, so the " closes the string
    // and the ; is outside quotes. Single-char prevChar check wrongly skips the ;.
    await execute(globalThis.browser, client, '"foo\\\\";bar');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        functionDeclaration: expect.stringContaining('async function() {'),
      }),
    );
  });

  it('should handle arrow functions calling methods with "function" in the name', async () => {
    // Arrow function that calls a helper method — should pass through to recast
    // (not be falsely excluded by old guard that checked !includes('function'))
    await execute(globalThis.browser, client, '(electron) => electron.getFunction().call()');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        functionDeclaration: '() => electron.getFunction().call()',
      }),
    );
  });

  it('should handle arrow functions with "function" in property/method names', async () => {
    // Arrow function with methods named containing 'function' — should NOT be wrapped
    await execute(globalThis.browser, client, '(electron) => helpers.functionHelper(electron)');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        // Should pass through recast (parenthesized arrow with =>), electron param injected
        functionDeclaration: expect.stringMatching(/^\(.*\)\s*=>/),
      }),
    );
  });

  it('should route async arrow function strings through recast and strip the electron param', async () => {
    await execute(globalThis.browser, client, 'async (electron, x) => x * 2');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        functionDeclaration: expect.stringMatching(/^async\s+\(?x\)?\s*=>/),
      }),
    );
  });

  it('should route named function declaration strings through recast and strip the electron param', async () => {
    await execute(globalThis.browser, client, 'async function test(electron) { return 42; }');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        functionDeclaration: expect.stringContaining('async function test()'),
      }),
    );
  });

  it('should route anonymous function expression strings through recast and strip the electron param', async () => {
    await execute(globalThis.browser, client, 'function(electron) { return 42; }');
    expect(client.send).toHaveBeenCalledWith(
      'Runtime.callFunctionOn',
      expect.objectContaining({
        // Wrapped in parens for expression-context parsing; electron param stripped
        functionDeclaration: expect.stringContaining('(function() {'),
      }),
    );
  });

  it('should call `mock.update()` when mockStore has some mocks', async () => {
    const updateMock = vi.fn();
    vi.mocked(mockStore.getMocks).mockReturnValue([
      ['dummy', { update: updateMock } as unknown as ElectronFunctionMock],
    ]);
    await execute(globalThis.browser, client, (_electron, a, b, c) => a + b + c, 1, 2, 3);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(mockStore.getMocks).toHaveBeenCalledWith(globalThis.browser);
  });

  it("should update only the executing browser's mocks", async () => {
    const browserA = { sessionId: 'session-a' } as unknown as WebdriverIO.Browser;
    const updateA = vi.fn();
    const updateOther = vi.fn();
    vi.mocked(mockStore.getMocks).mockImplementation((owner) => [
      [
        'electron.app.getName',
        { update: owner === browserA ? updateA : updateOther } as unknown as ElectronFunctionMock,
      ],
    ]);

    try {
      await execute(browserA, client, () => 1);
    } finally {
      vi.mocked(mockStore.getMocks).mockReset().mockReturnValue([]);
    }

    expect(updateA).toHaveBeenCalledOnce();
    expect(updateOther).not.toHaveBeenCalled();
  });
});

describe('parsed function cache', () => {
  const client = {
    contextId: 9999,
    connect: vi.fn(),
    on: vi.fn(),
    send: vi.fn().mockResolvedValue({ result: { result: { value: 6 } } }),
  } as unknown as ElectronCdpBridge;

  beforeEach(() => {
    globalThis.browser = {} as WebdriverIO.Browser;
    clearParsedFunctionCache();
    vi.clearAllMocks();
  });

  it('should cache parsed function strings', async () => {
    const script = (_electron: unknown, a: number, b: number) => a + b;

    await execute(globalThis.browser, client, script, 1, 2);
    await execute(globalThis.browser, client, script, 3, 4);

    const calls = vi.mocked(client.send).mock.calls;
    const firstDecl = calls[0][1] as { functionDeclaration: string };
    const secondDecl = calls[1][1] as { functionDeclaration: string };

    expect(firstDecl.functionDeclaration).toBe('(a, b) => a + b');
    expect(secondDecl.functionDeclaration).toBe('(a, b) => a + b');
  });

  it('should clear cache when clearParsedFunctionCache is called', async () => {
    const script = (_electron: unknown, a: number) => a * 2;

    await execute(globalThis.browser, client, script, 5);
    clearParsedFunctionCache();
    await execute(globalThis.browser, client, script, 10);

    expect(client.send).toHaveBeenCalledTimes(2);
  });
});
