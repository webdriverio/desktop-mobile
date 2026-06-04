import type { CdpBridge } from '@wdio/electrobun-cdp-bridge';
import { describe, expect, it, vi } from 'vitest';

import { execute } from '../src/commands/execute.js';

function makeBridge(response: unknown): { bridge: CdpBridge; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue(response);
  const bridge = { send } as unknown as CdpBridge;
  return { bridge, send };
}

describe('execute', () => {
  it('should inline function args as JSON literals into the IIFE', async () => {
    const { bridge, send } = makeBridge({ result: { value: 'done' } });

    await execute(bridge, (_eb, a: number, b: string) => `${a}${b}`, 7, 'x');

    const expression = send.mock.calls[0][1].expression as string;
    expect(expression).toContain('7, "x"');
    expect(expression).toContain('__WDIO_ELECTROBUN__');
  });

  it('should return the evaluated value', async () => {
    const { bridge } = makeBridge({ result: { value: { ok: true } } });

    const result = await execute(bridge, () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
  });

  it('should wrap a bare string expression so its value is returned', async () => {
    const { bridge, send } = makeBridge({ result: { value: 2 } });

    await execute(bridge, 'document.title');

    expect(send.mock.calls[0][1].expression).toBe('(async function () { return (document.title); })()');
  });

  it('should wrap a statement-style string (leading return) as a function body', async () => {
    const { bridge, send } = makeBridge({ result: { value: 42 } });

    await execute(bridge, 'return 42');

    expect(send.mock.calls[0][1].expression).toBe('(async function () { return 42 })()');
  });

  it('should throw a descriptive error for non-JSON-serialisable args', async () => {
    const { bridge } = makeBridge({ result: { value: undefined } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(execute(bridge, (_eb, _arg: unknown) => undefined, circular)).rejects.toThrow(/not JSON-serialisable/);
  });

  it('should reject function/symbol args instead of silently dropping them', async () => {
    const { bridge, send } = makeBridge({ result: { value: undefined } });

    await expect(
      execute(
        bridge,
        (_eb, _arg: unknown) => undefined,
        () => 1,
      ),
    ).rejects.toThrow(/not JSON-serialisable/);
    await expect(execute(bridge, (_eb, _arg: unknown) => undefined, Symbol('s'))).rejects.toThrow(
      /not JSON-serialisable/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('should surface Runtime.evaluate exceptionDetails as a thrown error', async () => {
    const { bridge } = makeBridge({ exceptionDetails: { text: 'ReferenceError: x is not defined' } });

    await expect(execute(bridge, () => undefined)).rejects.toThrow(/x is not defined/);
  });
});
