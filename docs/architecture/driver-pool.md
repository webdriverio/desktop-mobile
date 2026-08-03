# Driver Pool

Some services manage their own driver processes (e.g. Tauri manages `tauri-driver`). Others delegate to the parent WDIO (e.g. Electron delegates Chromedriver to WDIO, since Chromedriver is shared across all Chromium-based apps).

For services that manage their own drivers, use `DriverPool` to handle multiple concurrent instances.

## When to Use
- Service spawns its own driver binary (not handled by WDIO core)
- Need to support parallel workers, multiremote, or single-driver mode

## Pattern
```typescript
class DriverPool {
  private drivers = new Map<string, DriverInfo>();

  async startDriver(config: DriverStartConfig): Promise<DriverInfo>;
  async stopDriver(identifier: string): Promise<void>;
  async stopAll(): Promise<void>;  // Stop all in parallel
  getStatus(): { running: boolean; count: number };
}
```

## Modes
- `single` — One shared driver for all workers (low parallelism)
- `worker` — Dedicated driver per worker (high parallelism)
- `multiremote` — Dedicated driver per multiremote instance

## Rules
- Auto-detect mode based on `maxInstances` and multiremote config
- `stopAll()` must run in `onComplete` to prevent orphan processes
- Each driver gets its own port pair via `PortManager`
- Use `identifier` (worker ID or instance name) as the pool key
