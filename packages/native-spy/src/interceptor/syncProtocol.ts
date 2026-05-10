export interface MockCallData {
  calls: unknown[][];
  results: Array<{ type: 'return' | 'throw'; value: unknown }>;
  invocationCallOrder: number[];
}

function reconstructErrors(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reconstructErrors);
  const obj = value as Record<string, unknown>;
  if (obj.__wdioError === true) {
    const err = new Error(typeof obj.message === 'string' ? obj.message : '');
    if (typeof obj.name === 'string') err.name = obj.name;
    if (typeof obj.stack === 'string') err.stack = obj.stack;
    return err;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) out[k] = reconstructErrors(obj[k]);
  return out;
}

export function parseCallData(raw: unknown): MockCallData {
  if (!raw || typeof raw !== 'object') return { calls: [], results: [], invocationCallOrder: [] };
  const r = raw as Record<string, unknown>;
  const calls = Array.isArray(r.calls)
    ? (r.calls as unknown[][]).map((args) => (Array.isArray(args) ? args.map(reconstructErrors) : args) as unknown[])
    : [];
  const results = Array.isArray(r.results)
    ? (r.results as MockCallData['results']).map((res) => ({
        type: res.type,
        value: reconstructErrors(res.value),
      }))
    : [];
  return {
    calls,
    results,
    invocationCallOrder: Array.isArray(r.invocationCallOrder) ? (r.invocationCallOrder as number[]) : [],
  };
}
