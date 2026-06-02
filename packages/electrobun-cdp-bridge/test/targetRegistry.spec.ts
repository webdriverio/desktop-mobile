import { describe, expect, it } from 'vitest';

import { classifyTarget, TargetRegistry } from '../src/targetRegistry.js';
import type { Debugger } from '../src/types.js';

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

describe('classifyTarget', () => {
  it('should classify a views:// page as content', () => {
    expect(classifyTarget({ type: 'page', url: 'views://mainview/index.html' })).toBe('content');
  });

  it('should classify an http(s) dev-server page as content', () => {
    expect(classifyTarget({ type: 'page', url: 'http://localhost:5173/' })).toBe('content');
  });

  it('should classify about:blank as a shell target', () => {
    expect(classifyTarget({ type: 'page', url: 'about:blank' })).toBe('shell');
  });

  it('should classify devtools/chrome pages as other', () => {
    expect(classifyTarget({ type: 'page', url: 'devtools://devtools/bundled/inspector.html' })).toBe('other');
    expect(classifyTarget({ type: 'page', url: 'chrome://gpu' })).toBe('other');
  });

  it('should classify non-page targets as other', () => {
    expect(classifyTarget({ type: 'service_worker', url: 'views://mainview/sw.js' })).toBe('other');
  });

  it('should fail open to content for an unknown page scheme', () => {
    expect(classifyTarget({ type: 'page', url: 'app://weird/path' })).toBe('content');
  });
});

describe('TargetRegistry', () => {
  it('should label the first content target main and the rest window-N', () => {
    const registry = new TargetRegistry();
    const entries = registry.reconcile([
      mk('A', 'views://mainview/index.html'),
      mk('B', 'views://secondview/index.html'),
    ]);
    expect(entries.map((entry) => entry.label)).toEqual(['main', 'window-1']);
  });

  it('should make main the URL-first content target regardless of /json order', () => {
    const registry = new TargetRegistry();
    // CEF lists secondview first here, but URL order is deterministic, so mainview
    // (sorts before secondview) is consistently `main` — not whatever came first.
    const entries = registry.reconcile([
      mk('B', 'views://secondview/index.html'),
      mk('A', 'views://mainview/index.html'),
    ]);
    expect(entries.find((entry) => entry.label === 'main')?.url).toBe('views://mainview/index.html');
  });

  it('should exclude non-content targets and still label the first content one main', () => {
    const registry = new TargetRegistry();
    const entries = registry.reconcile([
      mk('A', 'about:blank'),
      mk('B', 'views://mainview/index.html'),
      mk('C', 'devtools://devtools/x.html'),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['B']);
    expect(entries[0].label).toBe('main');
  });

  it('should keep labels stable across re-enumeration regardless of order', () => {
    const registry = new TargetRegistry();
    registry.reconcile([mk('A', 'views://m'), mk('B', 'views://s')]);
    const again = registry.reconcile([mk('B', 'views://s'), mk('A', 'views://m')]);
    expect(again.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(again.find((entry) => entry.id === 'B')?.label).toBe('window-1');
  });

  it('should deterministically order same-URL windows via the id tie-break', () => {
    // Two windows loading the identical URL (e.g. a tiled layout) — localeCompare on URL
    // returns 0, so without the id tie-break main/window-1 could swap across refreshes.
    const registry = new TargetRegistry();
    const first = registry.reconcile([mk('B', 'views://same'), mk('A', 'views://same')]);
    const second = registry.reconcile([mk('A', 'views://same'), mk('B', 'views://same')]);
    // 'A' sorts before 'B' by id regardless of /json order, so it is consistently `main`.
    expect(first.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(second.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(first.find((entry) => entry.id === 'B')?.label).toBe('window-1');
  });

  it('should not reclaim a stale label after a window closes', () => {
    const registry = new TargetRegistry();
    registry.reconcile([mk('A', 'views://m'), mk('B', 'views://s')]);
    registry.reconcile([mk('A', 'views://m')]);
    const reopened = registry.reconcile([mk('A', 'views://m'), mk('C', 'views://t')]);
    expect(reopened.find((entry) => entry.id === 'A')?.label).toBe('main');
    expect(reopened.find((entry) => entry.id === 'C')?.label).toBe('window-2');
  });
});
