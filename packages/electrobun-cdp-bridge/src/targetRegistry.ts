import type { Debugger, DebuggerList, PageTarget, TargetClass, TargetRegistryEntry } from './types.js';

const CONTENT_SCHEME_PREFIXES = ['views://', 'http://', 'https://', 'file://'];
const NON_CONTENT_PREFIXES = ['devtools://', 'chrome://', 'chrome-extension://', 'chrome-untrusted://'];

/**
 * Classify a discovered CDP target. Pure + unit-tested in isolation because the
 * discriminator is the part most likely to drift across Electrobun versions.
 *
 * Per the Phase 0 spike, Electrobun CEF windows surface as `type: 'page'` under
 * the custom `views://` scheme with no separate shell target; we still keep the
 * `shell`/`other` branches for robustness and fail **open** to `content` for an
 * unknown page scheme so a real app webview is never hidden from the user.
 */
export function classifyTarget(target: Pick<Debugger, 'type' | 'url'>): TargetClass {
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
}

function toPageTarget(target: Debugger): PageTarget {
  return {
    id: target.id,
    title: target.title,
    url: target.url,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    class: classifyTarget(target),
  };
}

function labelOrder(label: string): number {
  return label === 'main' ? -1 : Number.parseInt(label.replace('window-', ''), 10);
}

/**
 * Tracks the user-facing label for each content target. Labels are stable: the
 * first content target seen becomes `main`, then `window-1`, `window-2`…, keyed
 * on the CEF target `id` so re-enumeration never renumbers a live target. The
 * counter is monotonic — a closed-then-reopened window gets a fresh label rather
 * than reclaiming a stale one.
 */
export class TargetRegistry {
  #labelById = new Map<string, string>();
  #counter = 0;

  /** Reconcile against a fresh `/json` listing; returns live content targets in label order. */
  reconcile(list: DebuggerList): TargetRegistryEntry[] {
    const content = list.map(toPageTarget).filter((target) => target.class === 'content');
    const liveIds = new Set(content.map((target) => target.id));

    for (const target of content) {
      if (!this.#labelById.has(target.id)) {
        this.#labelById.set(target.id, this.#counter === 0 ? 'main' : `window-${this.#counter}`);
        this.#counter++;
      }
    }
    for (const id of [...this.#labelById.keys()]) {
      if (!liveIds.has(id)) {
        this.#labelById.delete(id);
      }
    }

    return content
      .map((target) => ({ ...target, label: this.#labelById.get(target.id) as string }))
      .sort((a, b) => labelOrder(a.label) - labelOrder(b.label));
  }

  labelFor(id: string): string | undefined {
    return this.#labelById.get(id);
  }
}
