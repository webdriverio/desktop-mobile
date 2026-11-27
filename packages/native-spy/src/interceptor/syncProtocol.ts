export interface MockCallData {
  calls: unknown[][];
  results: Array<{ type: 'return' | 'throw'; value: unknown }>;
  invocationCallOrder: number[];
}

export interface BatchCallDataTarget {
  name: string;
  since?: number;
  lastCallOrder?: number;
}

export interface BatchCallDataSlice extends MockCallData {
  start?: number;
  unchanged?: boolean;
  reset?: boolean;
  __error?: string;
}

function reviveMarkers(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(reviveMarkers);
  }
  const obj = value as Record<string, unknown>;
  if (obj.__wdioUndefined === true) {
    return undefined;
  }
  if (obj.__wdioError === true) {
    const err = new Error(typeof obj.message === 'string' ? obj.message : '');
    if (typeof obj.name === 'string') {
      err.name = obj.name;
    }
    if (typeof obj.stack === 'string') {
      err.stack = obj.stack;
    }
    return err;
  }
  // fromEntries defines each key, so an own `__proto__` key stays data instead of setting the prototype
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, reviveMarkers(v)]));
}

/** Restore the `undefined` and `Error` markers that a call-data read writes. */
export function parseCallData(raw: unknown): MockCallData {
  if (!raw || typeof raw !== 'object') {
    return { calls: [], results: [], invocationCallOrder: [] };
  }
  const r = raw as Record<string, unknown>;
  const calls = Array.isArray(r.calls)
    ? (r.calls as unknown[][]).map((args) => (Array.isArray(args) ? args.map(reviveMarkers) : args) as unknown[])
    : [];
  const results = Array.isArray(r.results)
    ? (r.results as MockCallData['results']).map((res) => ({
        type: res.type,
        value: reviveMarkers(res.value),
      }))
    : [];
  return {
    calls,
    results,
    invocationCallOrder: Array.isArray(r.invocationCallOrder) ? (r.invocationCallOrder as number[]) : [],
  };
}

/** Restore markers across every mock slice returned by `buildBatchCallDataReadScript`. */
export function parseBatchCallData(raw: unknown): Record<string, BatchCallDataSlice> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, entry]) => {
      if (entry && typeof entry === 'object' && (entry as Record<string, unknown>).unchanged === true) {
        return [key, { calls: [], results: [], invocationCallOrder: [], unchanged: true } satisfies BatchCallDataSlice];
      }
      const parsed = parseCallData(entry);
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
      const slice: BatchCallDataSlice = {
        ...parsed,
        ...(typeof e?.start === 'number' ? { start: e.start } : {}),
        ...(e?.reset === true ? { reset: true } : {}),
        ...(typeof e?.__error === 'string' ? { __error: e.__error } : {}),
      };
      return [key, slice];
    }),
  );
}
