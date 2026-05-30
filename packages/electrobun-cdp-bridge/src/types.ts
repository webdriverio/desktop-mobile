/**
 * A single entry from the CDP `/json` discovery endpoint. Electrobun's CEF
 * renderer exposes one entry per webview (a `BrowserWindow` shell or a
 * `BrowserView`/OOPIF content webview), so unlike Electron we keep *all* the
 * `type === 'page'` entries rather than just the first.
 */
export type Debugger = {
  description: string;
  devtoolsFrontendUrl: string;
  devtoolsFrontendUrlCompat: string;
  faviconUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

export type Version = {
  browser: string;
  protocolVersion: string;
};

export type DebuggerList = Array<Debugger>;

/**
 * Classification of a discovered CDP target.
 * - `content` — an app webview (a `BrowserWindow`/`BrowserView` rendering app
 *   content); these are surfaced via `switchWindow`/`listWindows`.
 * - `shell` — a host/chrome target (e.g. `about:blank`) not surfaced to users.
 * - `other` — devtools, service workers, and anything else ignored for routing.
 *
 * The exact discriminator (URL scheme / path) is finalised by the Phase 0 spike.
 */
export type TargetClass = 'content' | 'shell' | 'other';

/**
 * A discovered CDP page target plus the bridge's derived routing metadata. The
 * stable identity is the CEF target `id`; `label` is persisted against it so
 * re-enumeration doesn't renumber a live target.
 */
export type PageTarget = {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  class: TargetClass;
};

/**
 * An entry in the bridge's target registry: the discovered target plus the
 * user-facing label (`main`, `window-1`, …) the multi-window API maps onto.
 */
export type TargetRegistryEntry = PageTarget & {
  label: string;
};
