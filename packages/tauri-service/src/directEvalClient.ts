export class DirectEvalClient {
  constructor(
    private readonly port: number,
    private readonly defaultTimeoutMs = 30_000,
  ) {}

  async eval(
    wrappedScript: string,
    opts: {
      windowLabel?: string;
      timeoutMs?: number;
      sessionId?: string;
      args?: unknown[];
    } = {},
  ): Promise<unknown> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const url = `http://127.0.0.1:${this.port}/wdio/eval`;

    const body: Record<string, unknown> = {
      script: wrappedScript,
      timeout_ms: timeoutMs,
    };
    if (opts.windowLabel !== undefined) {
      body.window_label = opts.windowLabel;
    }
    if (opts.sessionId !== undefined) {
      body.session_id = opts.sessionId;
    }
    if (opts.args !== undefined) {
      body.args = opts.args;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    });

    const data = (await response.json().catch(() => null)) as {
      value?: unknown;
      error?: string;
      undef?: boolean;
    } | null;

    if (!response.ok) {
      throw new Error(data?.error ?? `Direct eval HTTP error: ${response.status} ${response.statusText}`);
    }

    if (data === null) {
      throw new Error('Direct eval: server returned 200 but body was not valid JSON');
    }

    if (data.error) {
      throw new Error(data.error);
    }

    if (data.undef === true) {
      return undefined;
    }

    return data.value;
  }
}
