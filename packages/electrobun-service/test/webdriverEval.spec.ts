import { describe, expect, it, vi } from 'vitest';

import { WebDriverEvalBridge } from '../src/webdriverEval.js';

const bridge = (poster: (script: string) => Promise<{ value: unknown }>) => new WebDriverEvalBridge(poster);

describe('WebDriverEvalBridge', () => {
  it('should map a resolved outcome to result.value', async () => {
    const b = bridge(vi.fn().mockResolvedValue({ value: { ok: true, value: 42 } }));
    expect(await b.send('Runtime.evaluate', { expression: '1' })).toEqual({ result: { value: 42 } });
  });

  it('should preserve a genuine undefined (undef flag) rather than null', async () => {
    const b = bridge(vi.fn().mockResolvedValue({ value: { ok: true, undef: true } }));
    expect(await b.send('Runtime.evaluate', { expression: '1' })).toEqual({ result: { value: undefined } });
  });

  it('should map a caught page error to exceptionDetails carrying the message', async () => {
    const b = bridge(vi.fn().mockResolvedValue({ value: { ok: false, error: 'Test error from execute' } }));
    const response = await b.send('Runtime.evaluate', { expression: '1' });
    expect(response.exceptionDetails?.exception?.description).toBe('Test error from execute');
    expect(response.result).toBeUndefined();
  });

  it('should map a raw W3C error response (no ok field) via its message', async () => {
    const b = bridge(vi.fn().mockResolvedValue({ value: { error: 'javascript error', message: 'MsgSync' } }));
    const response = await b.send('Runtime.evaluate', { expression: '1' });
    expect(response.exceptionDetails?.exception?.description).toBe('MsgSync');
  });

  it('should wrap the expression in a try/catch → done protocol script', async () => {
    const poster = vi.fn().mockResolvedValue({ value: { ok: true, value: 1 } });
    await bridge(poster).send('Runtime.evaluate', { expression: 'doThing()' });
    const script = poster.mock.calls[0][0] as string;
    expect(script).toContain('arguments[arguments.length - 1]');
    expect(script).toContain('(doThing())');
    expect(script).toContain('done({ ok: true');
    expect(script).toContain('done({ ok: false');
  });

  it('should reject a non-Runtime.evaluate method (wiring bug)', async () => {
    await expect(
      bridge(vi.fn()).send('Page.navigate', { expression: '' } as unknown as { expression: string }),
    ).rejects.toThrow(/Runtime\.evaluate/);
  });
});
