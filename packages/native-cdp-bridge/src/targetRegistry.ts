import type { ClassifyTarget, Debugger, DebuggerList, PageTarget, TargetRegistryEntry } from './types.js';

function byCodepoint(x: string, y: string): number {
  if (x < y) {
    return -1;
  }
  return x > y ? 1 : 0;
}

function labelOrder(label: string): number {
  return label === 'main' ? -1 : Number.parseInt(label.replace('window-', ''), 10);
}

/**
 * Tracks the user-facing label for each content target. Labels are stable: the
 * first content target seen becomes `main`, then `window-1`, `window-2`…, keyed
 * on the target `id` so re-enumeration never renumbers a live target. The counter
 * is monotonic — a closed-then-reopened window gets a fresh label rather than
 * reclaiming a stale one.
 *
 * Renderer-neutral: what counts as a `content` target is the injected `classify`
 * function (e.g. a CEF service supplies one that keys off the `views://` scheme).
 */
export class TargetRegistry {
  #labelById = new Map<string, string>();
  #counter = 0;
  #classify: ClassifyTarget;

  constructor(classify: ClassifyTarget) {
    this.#classify = classify;
  }

  #toPageTarget(target: Debugger): PageTarget {
    return {
      id: target.id,
      title: target.title,
      url: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      class: this.#classify(target),
    };
  }

  /** Reconcile against a fresh `/json` listing; returns live content targets in label order. */
  reconcile(list: DebuggerList): TargetRegistryEntry[] {
    // Sort by URL before assigning labels: the runtime's /json order isn't stable, so
    // the first content target (which becomes `main`) would otherwise flip between
    // windows across runs. URL order is deterministic; tie-break on the stable target
    // `id`. Codepoint comparison, not localeCompare — the latter follows the runtime's
    // locale, so the order could differ across environments.
    const content = list
      .map((target) => this.#toPageTarget(target))
      .filter((target) => target.class === 'content')
      .sort((a, b) => byCodepoint(a.url, b.url) || byCodepoint(a.id, b.id));
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
