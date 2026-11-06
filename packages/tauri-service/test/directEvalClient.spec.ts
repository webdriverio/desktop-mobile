import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectEvalClient } from '../src/directEvalClient.js';

const PORT = 4445;

function mockFetch(response: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: vi.fn().mockResolvedValue(response),
  });
}

describe('DirectEvalClient', () => {
  let client: DirectEvalClient;

  beforeEach(() => {
    client = new DirectEvalClient(PORT);
    vi.stubGlobal('fetch', mockFetch({ value: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('successful responses', () => {
    it('should return value from server response', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: 42 }));
      const result = await client.eval('script', {});
      expect(result).toBe(42);
    });

    it('should return undefined when undef is true', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: null, undef: true }));
      const result = await client.eval('script', {});
      expect(result).toBeUndefined();
    });

    it('should return null value when undef is false', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: null, undef: false }));
      const result = await client.eval('script', {});
      expect(result).toBeNull();
    });

    it('should return object values', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: { foo: 'bar' } }));
      const result = await client.eval('script', {});
      expect(result).toEqual({ foo: 'bar' });
    });
  });

  describe('error responses', () => {
    it('should throw when server returns error field', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: 'script threw an error' }));
      await expect(client.eval('script', {})).rejects.toThrow('script threw an error');
    });

    it('should throw when HTTP response is not ok', async () => {
      vi.stubGlobal('fetch', mockFetch(null, false, 500));
      await expect(client.eval('script', {})).rejects.toThrow('Direct eval HTTP error: 500');
    });

    it('should propagate fetch connection errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(client.eval('script', {})).rejects.toThrow('ECONNREFUSED');
    });

    it('should propagate abort/timeout errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));
      await expect(client.eval('script', {})).rejects.toThrow(/aborted/i);
    });

    it('should throw when 200 response body is not valid JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        }),
      );
      await expect(client.eval('script', {})).rejects.toThrow(
        'Direct eval: server returned 200 but body was not valid JSON',
      );
    });
  });

  describe('request body construction', () => {
    it('should send script in body without args field', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('myScript', {});

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.script).toBe('myScript');
      expect(body.args).toBeUndefined();
    });

    it('should send window_label when provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', { windowLabel: 'settings' });

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.window_label).toBe('settings');
    });

    it('should omit window_label when not provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', {});

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.window_label).toBeUndefined();
    });

    it('should send session_id when provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', { sessionId: 'abc-123' });

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.session_id).toBe('abc-123');
    });

    it('should send args when provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', { args: [1, { a: 2 }] });

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.args).toEqual([1, { a: 2 }]);
    });

    it('should omit session_id when not provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', {});

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body).not.toHaveProperty('session_id');
      expect(body).not.toHaveProperty('args');
    });

    it('should send timeout_ms in body', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      await client.eval('script', { timeoutMs: 5000 });

      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.timeout_ms).toBe(5000);
    });

    it('should post to the correct URL', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      const customClient = new DirectEvalClient(9999);
      await customClient.eval('script', {});

      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:9999/wdio/eval');
    });
  });
});
