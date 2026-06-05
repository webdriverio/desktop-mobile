import { describe, expect, it } from 'vitest';

import { buildEmitEventExpression } from '../src/commands/emitEvent.js';

const U2028 = String.fromCharCode(0x2028);

describe('buildEmitEventExpression', () => {
  it('should resolve DeviceEventEmitter via require, not as a bare global', () => {
    const expr = buildEmitEventExpression('wdio:setCount', 5);
    expect(expr).toContain("require('react-native')");
    expect(expr).toContain('DeviceEventEmitter');
    // Must not reference a bare DeviceEventEmitter global (the original bug).
    expect(expr).not.toMatch(/^\s*DeviceEventEmitter\.emit/m);
  });

  it('should serialise the event name and payload as escaped literals', () => {
    const expr = buildEmitEventExpression('evt', { a: 1 });
    expect(expr).toContain('emitter.emit("evt", {"a":1})');
  });

  it('should default a missing payload to null', () => {
    const expr = buildEmitEventExpression('evt', undefined);
    expect(expr).toContain('emitter.emit("evt", null)');
  });

  it('should escape JS line terminators in the payload', () => {
    const expr = buildEmitEventExpression('evt', `a${U2028}b`);
    expect(expr).toContain('\\u2028');
  });
});
