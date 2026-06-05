import type { Debugger } from '@wdio/native-cdp-bridge';
import { describe, expect, it } from 'vitest';

import { selectHermesTarget } from '../src/hermesTarget.js';

const target = (over: Partial<Debugger>): Debugger => ({
  id: 'x',
  title: '',
  description: '',
  type: 'node',
  url: '',
  devtoolsFrontendUrl: '',
  devtoolsFrontendUrlCompat: '',
  faviconUrl: '',
  webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=x',
  ...over,
});

describe('selectHermesTarget', () => {
  it('should return undefined when the list is empty', () => {
    expect(selectHermesTarget([])).toBeUndefined();
  });

  it('should return undefined when no target is connectable', () => {
    expect(selectHermesTarget([target({ webSocketDebuggerUrl: '' })])).toBeUndefined();
  });

  it('should skip targets without a webSocketDebuggerUrl', () => {
    const dead = target({ id: 'dead', title: 'React Native', webSocketDebuggerUrl: '' });
    const live = target({ id: 'live', title: 'React Native' });
    expect(selectHermesTarget([dead, live])?.id).toBe('live');
  });

  it('should prefer a Hermes/React Native-hinted target over an unrelated one', () => {
    const other = target({ id: 'other', title: 'some page' });
    const hermes = target({ id: 'hermes', title: 'React Native Experimental (Improved Chrome Reloads)' });
    expect(selectHermesTarget([hermes, other])?.id).toBe('hermes');
  });

  it('should match the hint in the description too', () => {
    const other = target({ id: 'o', title: 'page', description: '' });
    const hermes = target({ id: 'h', title: 'page', description: 'Hermes' });
    expect(selectHermesTarget([other, hermes])?.id).toBe('h');
  });

  it('should take the newest (last) of multiple hinted targets', () => {
    const stale = target({ id: 'stale', title: 'React Native' });
    const live = target({ id: 'live', title: 'React Native' });
    expect(selectHermesTarget([stale, live])?.id).toBe('live');
  });

  it('should fall back to the last connectable when nothing is hinted', () => {
    const a = target({ id: 'a', title: 'foo' });
    const b = target({ id: 'b', title: 'bar' });
    expect(selectHermesTarget([a, b])?.id).toBe('b');
  });
});
