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
  const response = await fetch('wdio://invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
