import { describe, expect, it, vi } from 'vitest';

import { emitEvent } from '../src/commands/emitEvent.js';
import type { VmServiceClient } from '../src/vmService.js';

const makeClient = () => {
  const callServiceExtension = vi.fn().mockResolvedValue({ ok: true });
  const client = {
    getMainIsolateId: vi.fn().mockResolvedValue('iso'),
    callServiceExtension,
  } as unknown as VmServiceClient;
  return { client, callServiceExtension };
};

describe('emitEvent', () => {
  it('should call ext.wdio.emitEvent with isolateId, name, and JSON payload', async () => {
    const { client, callServiceExtension } = makeClient();
    await emitEvent(client, 'deeplink', { path: '/x' });
    expect(callServiceExtension).toHaveBeenCalledWith('ext.wdio.emitEvent', {
      isolateId: 'iso',
      name: 'deeplink',
      payload: JSON.stringify({ path: '/x' }),
    });
  });

  it('should serialize a missing payload as null', async () => {
    const { client, callServiceExtension } = makeClient();
    await emitEvent(client, 'tick');
    expect(callServiceExtension).toHaveBeenCalledWith('ext.wdio.emitEvent', {
      isolateId: 'iso',
      name: 'tick',
      payload: 'null',
    });
  });
});
