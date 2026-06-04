import type { ClassifyTarget } from '@wdio/native-cdp-bridge';

const CONTENT_SCHEME_PREFIXES = ['views://', 'http://', 'https://', 'file://'];
const NON_CONTENT_PREFIXES = ['devtools://', 'chrome://', 'chrome-extension://', 'chrome-untrusted://'];

/**
 * Classify a discovered CDP target for Electrobun's CEF renderer — the
 * renderer-specific bit injected into `@wdio/native-cdp-bridge`'s `MultiTargetCdpBridge`.
 * Pure + unit-tested in isolation because the discriminator is the part most
 * likely to drift across Electrobun versions.
 *
 * Per the Phase 0 spike, Electrobun CEF windows surface as `type: 'page'` under
 * the custom `views://` scheme with no separate shell target; we still keep the
 * `shell`/`other` branches for robustness and fail **open** to `content` for an
 * unknown page scheme so a real app webview is never hidden from the user.
 */
export const classifyTarget: ClassifyTarget = (target) => {
  if (target.type !== 'page') {
    return 'other';
  }
  const url = target.url ?? '';
  if (NON_CONTENT_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return 'other';
  }
  if (url === '' || url === 'about:blank') {
    return 'shell';
  }
  if (CONTENT_SCHEME_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return 'content';
  }
  return 'content';
};
