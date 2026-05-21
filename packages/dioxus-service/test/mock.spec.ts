import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMock } from '../src/mock.js';
import mockStore from '../src/mockStore.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;
}

describe('createMock', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    mockStore.clear();
    vi.restoreAllMocks();
  });

  it('should return an object flagged as a DioxusMock', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    expect((m as unknown as { __isDioxusMock: boolean }).__isDioxusMock).toBe(true);
  });

  it('should name the outer mock dioxus.<command>', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    expect(m.getMockName()).toBe('dioxus.greet');
  });

  it('should register the inner mock via browser.execute', async () => {
    const browser = makeBrowser();
    await createMock('greet', browser);
    expect(browser.execute).toHaveBeenCalled();
    const [firstScript] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(firstScript).toContain('dioxus.greet');
    expect(firstScript).toContain('__wdio_spy__');
  });

  it('should store the mock in the singleton mockStore', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    expect(mockStore.getMock('dioxus.greet')).toBe(m);
  });

  it('should expose async lifecycle methods', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);

    expect(typeof m.mockImplementation).toBe('function');
    expect(typeof m.mockImplementationOnce).toBe('function');
    expect(typeof m.mockReturnValue).toBe('function');
    expect(typeof m.mockReturnValueOnce).toBe('function');
    expect(typeof m.mockResolvedValue).toBe('function');
    expect(typeof m.mockResolvedValueOnce).toBe('function');
    expect(typeof m.mockRejectedValue).toBe('function');
    expect(typeof m.mockRejectedValueOnce).toBe('function');
    expect(typeof m.mockClear).toBe('function');
    expect(typeof m.mockReset).toBe('function');
    expect(typeof m.mockRestore).toBe('function');
    expect(typeof m.mockReturnThis).toBe('function');
    expect(typeof m.update).toBe('function');
  });

  it('should forward mockReturnValue to browser.execute with the setter script', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    vi.mocked(browser.execute).mockClear();

    await m.mockReturnValue('hello');

    const [script] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(script).toContain('mockReturnValue');
    expect(script).toContain('greet');
    expect(script).toContain('"hello"');
  });

  it('should forward mockResolvedValue to browser.execute', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    vi.mocked(browser.execute).mockClear();

    await m.mockResolvedValue({ ok: true });

    const [script] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(script).toContain('mockResolvedValue');
  });

  it('should forward mockClear to browser.execute and clear the outer mock', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    // Simulate a call landing on the outer mock so we can verify it gets cleared.
    (m as unknown as (...a: unknown[]) => unknown)('arg');
    expect(m.mock.calls.length).toBe(1);

    vi.mocked(browser.execute).mockClear();
    await m.mockClear();

    const [script] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(script).toContain('mockClear');
    expect(m.mock.calls.length).toBe(0);
  });

  it('should remove the mock from the store on mockRestore', async () => {
    const browser = makeBrowser();
    const m = await createMock('greet', browser);
    expect(mockStore.getMocks()).toHaveLength(1);

    await m.mockRestore();
    expect(mockStore.getMocks()).toHaveLength(0);
  });

  it('should append new inner-mock calls to the outer state on update()', async () => {
    const browser = makeBrowser();
    // Registration call (returns undefined). Then read-call data returns
    // one inner call.
    vi.mocked(browser.execute)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        calls: [['arg1']],
        results: [{ type: 'return', value: 42 }],
        invocationCallOrder: [1],
      });

    const m = await createMock('greet', browser);
    await m.update();

    expect(m.mock.calls).toEqual([['arg1']]);
    expect(m.mock.results).toEqual([{ type: 'return', value: 42 }]);
  });

  it('should reset the outer state when the inner shrinks', async () => {
    const browser = makeBrowser();
    vi.mocked(browser.execute)
      .mockResolvedValueOnce(undefined)
      // First update: two calls.
      .mockResolvedValueOnce({
        calls: [['a'], ['b']],
        results: [
          { type: 'return', value: 1 },
          { type: 'return', value: 2 },
        ],
        invocationCallOrder: [1, 2],
      })
      // Second update: inner cleared, only one call now.
      .mockResolvedValueOnce({
        calls: [['c']],
        results: [{ type: 'return', value: 3 }],
        invocationCallOrder: [3],
      });

    const m = await createMock('greet', browser);
    await m.update();
    expect(m.mock.calls).toEqual([['a'], ['b']]);

    await m.update();
    expect(m.mock.calls).toEqual([['c']]);
  });
});
