# Port Allocation

Driver processes require known ports before spawning. Use dynamic allocation to avoid conflicts in parallel/multiremote scenarios.

## Use `PortManager`

Preferred pattern for new services. Tracks used ports to prevent double-allocation.

```typescript
import getPort from 'get-port';

class PortManager {
  private usedPorts = new Set<number>();

  async allocatePort(preferred?: number): Promise<number> {
    const port = await getPort({
      port: preferred,
      host: '127.0.0.1',
      exclude: Array.from(this.usedPorts),
    });
    this.usedPorts.add(port);
    return port;
  }

  clear(): void { this.usedPorts.clear(); }
}
```

## Rules
- Always bind to `127.0.0.1` (not `0.0.0.0` or `localhost`)
- Always pass `exclude` with previously allocated ports
- Release ports in `onComplete` via `portManager.clear()`
- For services needing port pairs (e.g. main + native driver), allocate both atomically via `allocatePortPair()`
- Prefer `get-port` over hardcoded ports — never assume a port is available
