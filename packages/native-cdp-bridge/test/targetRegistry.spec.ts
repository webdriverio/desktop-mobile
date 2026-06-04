import { describe, expect, it } from 'vitest';

import { TargetRegistry } from '../src/targetRegistry.js';
import type { ClassifyTarget, Debugger } from '../src/types.js';

// A representative content/shell/other classifier (the kind a consumer injects).
const classify: ClassifyTarget = (t) => {
  if (t.type !== 'page') {
    return 'other';
  }
  const url = t.url ?? '';
  if (url.startsWith('devtools://') || url.startsWith('chrome://')) {
    return 'other';
  }
  if (url === '' || url === 'about:blank') {
    return 'shell';
  }
  return 'content';
};

const mk = (id: string, url: string, type = 'page'): Debugger => ({
  id,
  url,
  type,
  title: `title-${id}`,
  description: '',
  devtoolsFrontendUrl: '',
  devtoolsFrontendUrlCompat: '',
  faviconUrl: '',
  webSocketDebuggerUrl: `ws://localhost:9222/devtools/page/${id}`,
});

describe('TargetRegistry', () => {
  it('should label the first content target main and the rest window-N', () => {
    const registry = new TargetRegistry(classify);
    const entries = registry.reconcile([
      mk('A', 'views://mainview/index.html'),
      mk('B', 'views://secondview/index.html'),
    ]);
    expect(entries.map((entry) => entry.label)).toEqual(['main', 'window-1']);
  });

  it('should make main the URL-first content target regardless of /json order', () => {
    const registry = new TargetRegistry(classify);
    const entries = registry.reconcile([
      mk('B', 'views://secondview/index.html'),
      mk('A', 'views://mainview/index.html'),
    ]);
    expect(entries.find((entry) => entry.label === 'main')?.url).toBe('views://mainview/index.html');
  });

  it('should exclude non-content targets and still label the first content one main', () => {
    const registry = new TargetRegistry(classify);
    const entries = registry.reconcile([
      mk('A', 'about:blank'),
      mk('B', 'views://mainview/index.html'),
      mk('C', 'devtools://devtools/x.html'),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['B']);
    expect(entries[0].label).toBe('main');
  });

  it('should keep labels stable across re-enumeration regardless of order', () => {
    const registry = new TargetRegistry(classify);
    registry.reconcile([mk('A', 'views://m'), mk('B', 'views://s')]);
    const again = registry.reconcile([mk('B', 'views://s'), mk('A', 'views://m')]);
    expect(again.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(again.find((entry) => entry.id === 'B')?.label).toBe('window-1');
  });

  it('should deterministically order same-URL windows via the id tie-break', () => {
    const registry = new TargetRegistry(classify);
    const first = registry.reconcile([mk('B', 'views://same'), mk('A', 'views://same')]);
    const second = registry.reconcile([mk('A', 'views://same'), mk('B', 'views://same')]);
    expect(first.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(second.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(first.find((entry) => entry.id === 'B')?.label).toBe('window-1');
  });

  it('should not reclaim a stale label after a window closes', () => {
    const registry = new TargetRegistry(classify);
    registry.reconcile([mk('A', 'views://m'), mk('B', 'views://s')]);
    registry.reconcile([mk('A', 'views://m')]);
    const reopened = registry.reconcile([mk('A', 'views://m'), mk('C', 'views://t')]);
    expect(reopened.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(reopened.find((entry) => entry.id === 'C')?.label).toBe('window-2');
  });
});
