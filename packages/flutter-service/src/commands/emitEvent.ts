// browser.flutter.emitEvent — push an event into the app's wdio_flutter event bus.
//
// The conditional convergent feature (present because Flutter has an event-bus concept via
// the contract). The app opts in by listening to `wdioEvents.stream`; we drive the bus over
// the Dart VM Service `ext.wdio.emitEvent` extension.

import type { VmServiceClient } from '../vmService.js';

export async function emitEvent(client: VmServiceClient, name: string, payload?: unknown): Promise<void> {
  const isolateId = await client.getMainIsolateId();
  await client.callServiceExtension('ext.wdio.emitEvent', {
    isolateId,
    name,
    payload: JSON.stringify(payload ?? null),
  });
}
