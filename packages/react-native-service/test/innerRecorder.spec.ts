import { type Context, createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import {
  buildInstallScript,
  buildPushImplementationScript,
  buildSetImplementationScript,
} from '../src/innerRecorder.js';

// The inner-recorder scripts are plain ES5 IIFEs meant to run in the app's Hermes realm. Run
// them in a vm context whose global stands in for the app's globalThis, so these tests exercise
// the real spy runtime (the closure-held _savedImpls stack) rather than just the source strings.
function realm(initial: Record<string, unknown>): Context {
  const ctx = createContext({ ...initial });
  return ctx;
}
const exec = (ctx: Context, script: string) => runInContext(script, ctx);
const call = (ctx: Context, key: string): unknown => (ctx[key] as () => unknown)();

describe('inner recorder impl stack (reconnect recovery)', () => {
  it('drains a stuck withImplementation impl back to the prior default on reconnect', () => {
    const ctx = realm({ greet: () => 'orig' });
    exec(ctx, buildInstallScript('greet'));
    exec(ctx, buildSetImplementationScript('greet', '() => "base"'));
    exec(ctx, buildPushImplementationScript('greet', '() => "temp"'));
    expect(call(ctx, 'greet')).toBe('temp');

    // popImpl never landed (bridge dropped mid-withImplementation); the reconnect re-runs
    // buildInstallScript, whose existing-entry path must drain the impl stack back to base.
    exec(ctx, buildInstallScript('greet'));
    expect(call(ctx, 'greet')).toBe('base');
  });

  it('preserves a plain default impl on reconnect (no pending withImplementation)', () => {
    const ctx = realm({ greet: () => 'orig' });
    exec(ctx, buildInstallScript('greet'));
    exec(ctx, buildSetImplementationScript('greet', '() => "set"'));
    expect(call(ctx, 'greet')).toBe('set');

    // _savedImpls is empty (no withImplementation), so the reconnect reset must be a no-op.
    exec(ctx, buildInstallScript('greet'));
    expect(call(ctx, 'greet')).toBe('set');
  });
});
