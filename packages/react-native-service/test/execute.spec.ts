import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { describe, expect, it, vi } from 'vitest';

import { evaluateInRealm, executeScript, jsonLiteral } from '../src/commands/execute.js';

type EvalParams = { expression: string; returnByValue: boolean; awaitPromise: boolean };

function fakeBridge(response: unknown) {
  const send = vi.fn(async () => response);
  return { bridge: { send } as unknown as CdpBridge, send };
}

const lastExpression = (send: ReturnType<typeof vi.fn>): string => (send.mock.calls[0][1] as EvalParams).expression;

describe('jsonLiteral', () => {
  it('should serialise a JSON value', () => {
    expect(jsonLiteral({ a: 1 }, 'ctx')).toBe('{"a":1}');
  });

  it('should reject a function value', () => {
    expect(() => jsonLiteral(() => {}, 'ctx', 0)).toThrow(/not JSON-serialisable/);
  });

  it('should reject a symbol value', () => {
    expect(() => jsonLiteral(Symbol('x'), 'ctx')).toThrow(/not JSON-serialisable/);
  });

  it('should escape JS line terminators and the less-than sign', () => {
    expect(jsonLiteral('a\u2028b', 'ctx')).toBe('"a\\u2028b"');
    expect(jsonLiteral('</x>', 'ctx')).toContain('\\u003C');
  });
});

describe('evaluateInRealm', () => {
  it('should return the evaluated value', async () => {
    const { bridge, send } = fakeBridge({ result: { value: 7 } });
    await expect(evaluateInRealm(bridge, '1')).resolves.toBe(7);
    expect(send.mock.calls[0][0]).toBe('Runtime.evaluate');
    expect(send.mock.calls[0][1]).toMatchObject({ returnByValue: true, awaitPromise: true });
  });

  it('should throw with the exception detail on a CDP exception', async () => {
    const { bridge } = fakeBridge({ exceptionDetails: { exception: { description: 'boom' } } });
    await expect(evaluateInRealm(bridge, 'x')).rejects.toThrow(/failed: boom/);
  });
});

describe('executeScript', () => {
  it('should evaluate a function and return its value', async () => {
    const { bridge, send } = fakeBridge({ result: { value: 42 } });
    await expect(executeScript(bridge, () => 42)).resolves.toBe(42);
    expect(lastExpression(send)).toContain('globalThis');
  });

  it('should inline args into the evaluated source', async () => {
    const { bridge, send } = fakeBridge({ result: { value: undefined } });
    await executeScript(bridge, (_rn, name) => name, 'sam');
    expect(lastExpression(send)).toContain('"sam"');
  });

  it('should strip the execute options sentinel before inlining args', async () => {
    const { bridge, send } = fakeBridge({ result: { value: undefined } });
    await executeScript(bridge, (_rn, key) => key, { __wdioOptions__: true } as never, 'appTheme');
    const expr = lastExpression(send);
    expect(expr).toContain('"appTheme"');
    expect(expr).not.toContain('__wdioOptions__');
  });

  it('should wrap a bare expression string and return its value', async () => {
    const { bridge, send } = fakeBridge({ result: { value: 3 } });
    await expect(executeScript(bridge, '1 + 2')).resolves.toBe(3);
    expect(lastExpression(send)).toContain('return (1 + 2)');
  });

  it('should run a statement-style string as a function body', async () => {
    const { bridge, send } = fakeBridge({ result: { value: 5 } });
    await executeScript(bridge, 'return 5');
    expect(lastExpression(send)).not.toContain('return (return 5)');
  });

  it('should throw when a string-form script receives positional arguments', async () => {
    const { bridge } = fakeBridge({ result: { value: undefined } });
    await expect(executeScript(bridge, 'return 1', 'extra' as never)).rejects.toThrow(
      /positional arguments are not supported with string-form scripts/,
    );
  });

  it('should treat a function declaration as a statement body, not an expression', async () => {
    const { bridge, send } = fakeBridge({ result: { value: undefined } });
    await executeScript(bridge, 'function foo() { return 42; }');
    const expr = lastExpression(send);
    // A function declaration at the top level is a statement — wrapping it as `return (function foo…)`
    // would return the function object instead of undefined (expected for a declaration with no call).
    expect(expr).not.toContain('return (function foo');
    expect(expr).toContain('function foo');
  });
});
