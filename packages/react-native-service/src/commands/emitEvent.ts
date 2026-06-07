// browser.reactNative.emitEvent — fires a React Native DeviceEventEmitter event
// from the Hermes realm over CDP.
//
// DeviceEventEmitter is a module export, NOT a Hermes global — `Runtime.evaluate`
// runs in global scope, so a bare `DeviceEventEmitter.emit(...)` throws ReferenceError.
// Resolve it through Metro's `require('react-native')` (the convention RN tooling uses),
// falling back to a `globalThis.DeviceEventEmitter` an app may have exposed.

import type { CdpBridge } from '@wdio/native-cdp-bridge';

import { evaluateInRealm, jsonLiteral } from './execute.js';

export function buildEmitEventExpression(event: string, payload: unknown): string {
  const eventLiteral = jsonLiteral(event, 'browser.reactNative.emitEvent event');
  const payloadLiteral = jsonLiteral(payload ?? null, 'browser.reactNative.emitEvent payload');
  return `(function () {
  var rn = typeof require === 'function' ? require('react-native') : undefined;
  var emitter = (rn && rn.DeviceEventEmitter) || globalThis.DeviceEventEmitter;
  if (!emitter) {
    throw new Error('DeviceEventEmitter is not reachable in the app realm — run a Metro/Hermes debug build, or expose it on globalThis.');
  }
  emitter.emit(${eventLiteral}, ${payloadLiteral});
})()`;
}

export async function emitEvent(bridge: CdpBridge, event: string, payload?: unknown): Promise<void> {
  await evaluateInRealm<void>(bridge, buildEmitEventExpression(event, payload));
}
