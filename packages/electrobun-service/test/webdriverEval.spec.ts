import { describe, expect, it, vi } from 'vitest';

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => logSpies };
});

import { installConsoleShim, WebDriverEvalBridge } from '../src/webdriverEval.js';

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

describe('installConsoleShim', () => {
  it('should drain buffered console entries into the logger as [webview] lines at mapped levels', async () => {
    for (const spy of Object.values(logSpies)) {
      spy.mockClear();
    }
    // The shim buffers { level, args } per entry; drain must forward each to the logger, mapping
    // console levels to logger levels (unknown / 'log' → info) and prefixing '[webview]'.
    const buffer = [
      { level: 'log', args: ['hello', 'world'] },
      { level: 'info', args: ['fyi'] },
      { level: 'warn', args: ['careful'] },
      { level: 'error', args: ['boom'] },
      { level: 'debug', args: ['trace-me'] },
      { level: 'weird', args: ['fallback'] },
    ];
    const execute = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(buffer);
    const browser = { execute } as unknown as WebdriverIO.Browser;

    const drain = await installConsoleShim(browser);
    await drain();

    expect(logSpies.info).toHaveBeenCalledWith('[webview] hello world');
    expect(logSpies.info).toHaveBeenCalledWith('[webview] fyi');
    expect(logSpies.info).toHaveBeenCalledWith('[webview] fallback');
    expect(logSpies.warn).toHaveBeenCalledWith('[webview] careful');
    expect(logSpies.error).toHaveBeenCalledWith('[webview] boom');
    expect(logSpies.debug).toHaveBeenCalledWith('[webview] trace-me');

    // Drain reads and clears the per-document buffer.
    expect(String(execute.mock.calls[1][0])).toContain('window.__WDIO_ELECTROBUN_LOGS__ = []');
  });

  it('should emit nothing when the buffer is empty', async () => {
    for (const spy of Object.values(logSpies)) {
      spy.mockClear();
    }
    const execute = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce([]);
    const browser = { execute } as unknown as WebdriverIO.Browser;

    const drain = await installConsoleShim(browser);
    await drain();

    for (const spy of Object.values(logSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
