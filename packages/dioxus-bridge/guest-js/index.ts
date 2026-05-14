/**
 * Guest-side JS bundle for `wdio-dioxus-bridge`.
 *
 * The Rust crate embeds this bundle via `build.rs` and injects it into the
 * Dioxus app's webview through `Config::with_custom_head`. At runtime it
 * exposes `window.__WDIO_DIOXUS__.invoke(command, args)` — a thin fetch
 * wrapper around the `wdio://invoke` custom protocol.
 *
 * @wdio/dioxus-service uses `browser.execute` to dispatch this invoke into
 * the page when running E2E specs; tests can also call it directly from the
 * frontend code under test (e.g., to opt into mocking).
 *
 * Phase 3 will add the mock-interception Proxy here, mirroring
 * packages/tauri-plugin/guest-js/index.ts's `window.__wdio_spy__` /
 * `window.__wdio_mocks__` shape. For now this is the minimum viable IPC
 * client.
 */

declare global {
  interface Window {
    __WDIO_DIOXUS__?: {
      invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
    };
  }
}

interface InvokeResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Send a JSON-encoded command to the `wdio://invoke` protocol and unwrap the
 * response envelope. Resolves with the `value` on success; rejects with the
 * `error` string on failure.
 */
export async function invoke(command: string, args?: unknown): Promise<unknown> {
  // Omit Content-Type so the browser sends text/plain — a CORS "simple"
  // request that skips the OPTIONS preflight. The Rust handler parses the
  // body as JSON regardless of Content-Type.
  const response = await fetch('wdio://invoke', {
    method: 'POST',
    body: JSON.stringify({ command, args: args ?? null }),
  });
  const body = (await response.json()) as InvokeResponse;
  if (body.ok) {
    return body.value;
  }
  throw new Error(body.error ?? 'wdio:// invoke failed with no error message');
}

// Install on the window. Re-installing is safe — subsequent calls overwrite
// the previous `invoke`, which lets debug-mode hot-reload swap in newer
// versions of this bundle without leaving a stale function behind.
if (!window.__WDIO_DIOXUS__) {
  window.__WDIO_DIOXUS__ = {};
}
window.__WDIO_DIOXUS__.invoke = invoke;

/**
 * Wrap a console method so each call is forwarded to the bridge's
 * `log_frontend` Rust command in addition to going to the original method.
 * Errors from the forward are swallowed silently — losing a frontend log
 * line beats locking up the page.
 */
function wrapConsoleMethod(method: 'log' | 'info' | 'warn' | 'error' | 'debug', level: string): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    void invoke('log_frontend', { level, message }).catch(() => {
      // Intentionally swallow — see comment above.
    });
  };
}

// Install the console wrapper exactly once per webview load. Re-installing
// would create a chain of wrappers and exponentially amplify each log call.
const CONSOLE_INSTALLED_KEY = '__WDIO_DIOXUS_CONSOLE_INSTALLED__';
if (!(window as unknown as Record<string, unknown>)[CONSOLE_INSTALLED_KEY]) {
  wrapConsoleMethod('log', 'info');
  wrapConsoleMethod('info', 'info');
  wrapConsoleMethod('warn', 'warn');
  wrapConsoleMethod('error', 'error');
  wrapConsoleMethod('debug', 'debug');
  (window as unknown as Record<string, unknown>)[CONSOLE_INSTALLED_KEY] = true;
}

// ============================================================================
// Embedded WebDriver polling loop
// ============================================================================
// When wdio-dioxus-embedded-driver is active, the bridge injects
// `window.__WDIO_EMBEDDED_PORT` before this module executes. This loop polls
// for pending eval requests, executes them, and sends results back — all via
// the existing wdio:// IPC channel.
//
// Polling interval: immediate retry when a command was found (back-pressure
// free), 10 ms sleep when the queue was empty (low CPU when idle).
declare global {
  interface Window {
    __WDIO_EMBEDDED_PORT?: number;
    __WDIO_EMBEDDED_RUNNING__?: boolean;
  }
}

if (typeof window.__WDIO_EMBEDDED_PORT === 'number' && !window.__WDIO_EMBEDDED_RUNNING__) {
  window.__WDIO_EMBEDDED_RUNNING__ = true;

  // TEMPORARY DIAGNOSTIC — beacon proving the polling-loop branch was taken.
  // To be removed alongside the bridge invoke.rs diag logs.
  void fetch('wdio://beacon/polling-loop-start').catch(() => {
    // ignore — diagnostic only
  });

  void (async function embeddedDriverLoop() {
    while (true) {
      try {
        const cmd = (await invoke('__embedded_poll')) as {
          id: string;
          script: string;
          args: unknown[];
        } | null;

        if (cmd !== null) {
          let result: unknown = null;
          let error: string | null = null;
          try {
            // Wrap the script body the same way WebDriver does: a function
            // that receives `arguments` (the args array) and can return a
            // value. Using AsyncFunction so `await` inside the script works.
            const AsyncFunction = (async () => {}).constructor as new (
              ...params: string[]
            ) => (...args: unknown[]) => Promise<unknown>;
            const fn = new AsyncFunction(...cmd.args.map((_, i) => `__arg${i}`), cmd.script);
            result = await fn(...cmd.args);
          } catch (e) {
            error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          }
          try {
            await invoke('__embedded_result', { id: cmd.id, result: result ?? null, error });
          } catch {
            // Result delivery failed (e.g. IPC teardown during navigation).
            // Attempt once more with an error marker so the Axum oneshot
            // sender is resolved rather than leaking until script timeout.
            try {
              await invoke('__embedded_result', {
                id: cmd.id,
                result: null,
                error: 'IPC error during result delivery',
              });
            } catch {
              console.warn('[wdio-dioxus-bridge] dropped command', cmd.id, '— IPC unavailable');
            }
          }
        } else {
          await new Promise<void>((r) => setTimeout(r, 10));
        }
      } catch {
        // Bridge not yet ready or IPC error — back off and retry.
        await new Promise<void>((r) => setTimeout(r, 100));
      }
    }
  })();
}
