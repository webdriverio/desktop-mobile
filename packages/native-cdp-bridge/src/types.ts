/**
 * A single entry from the CDP `/json` discovery endpoint. A runtime may expose
 * one entry per webview/page (e.g. a multi-window CEF app) or a single entry
 * (e.g. a React Native Hermes target); consumers decide which to keep via
 * `classifyTarget` / `selectTarget`.
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
 * Classification of a discovered CDP target, used by the multi-target client to
 * decide which targets are user-facing windows.
 * - `content` — an app webview/window surfaced via `switchWindow`/`listWindows`.
 * - `shell` — a host/chrome target (e.g. `about:blank`) not surfaced to users.
 * - `other` — devtools, service workers, and anything else ignored for routing.
 *
 * The discriminator (URL scheme / path) is renderer-specific and is supplied by
 * the consuming service via the injected `classifyTarget` function.
 */
export type TargetClass = 'content' | 'shell' | 'other';

/** Decides whether a discovered target is `content`/`shell`/`other`. Injected per consumer. */
export type ClassifyTarget = (target: Pick<Debugger, 'type' | 'url'>) => TargetClass;

/**
 * A discovered CDP page target plus the registry's derived routing metadata. The
 * stable identity is the target `id`; `label` is persisted against it so
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
 * An entry in the target registry: the discovered target plus the user-facing
 * label (`main`, `window-1`, …) the multi-window API maps onto.
 */
export type TargetRegistryEntry = PageTarget & {
  label: string;
};
