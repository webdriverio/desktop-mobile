import type { Debugger, DebuggerList, SelectTarget } from '@wdio/native-cdp-bridge';

/**
 * Title/description hint that a discovered target is the React Native / Hermes
 * page (rather than, say, a leftover devtools entry). Metro's inspector-proxy
 * labels RN targets with strings like "React Native Experimental …" / the app
 * name; the discriminator stays loose because it drifts across RN versions.
 */
const HERMES_HINT = /hermes|react native|experimental/i;

/** A discovered target is connectable only if it exposes a debugger socket. */
const isConnectable = (target: Debugger): boolean => Boolean(target.webSocketDebuggerUrl);

const looksLikeHermes = (target: Debugger): boolean =>
  HERMES_HINT.test(target.title) || HERMES_HINT.test(target.description);

/**
 * Pick the live Hermes target from Metro's inspector-proxy `/json/list`.
 *
 * The proxy can expose several entries and briefly retains stale ones after a
 * reload, so we don't blindly take the first like the single-target default:
 * prefer a connectable entry whose title/description looks like the RN/Hermes
 * page, and within that pool take the **last** (newest registration — the live
 * page is appended after a reload). Falls back to the last connectable entry,
 * then `undefined` when nothing is connectable.
 */
export const selectHermesTarget: SelectTarget = (targets: DebuggerList): Debugger | undefined => {
  const connectable = targets.filter(isConnectable);
  if (connectable.length === 0) {
    return undefined;
  }
  const hinted = connectable.filter(looksLikeHermes);
  const pool = hinted.length > 0 ? hinted : connectable;
  return pool[pool.length - 1];
};
