# Driver Process Lifecycle

Services that spawn external driver processes (tauri-driver, chromedriver, etc.) follow this lifecycle.

## Spawning
```typescript
spawn(driverPath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  env: { ...process.env, ...customEnv },
});
```
- `stdin` ignored, `stdout`/`stderr` piped for log forwarding
- Never use `detached: true` — driver must die with parent

## Readiness Detection
Approach depends on what the driver supports:
- **TCP + HTTP polling** (preferred): poll port with `net.Socket`, then check HTTP endpoint
- **stdout detection**: parse startup message from stdout (fallback)
- Set a startup timeout (30s default)
- Use poll intervals of ~100ms

## Log Forwarding
- Use `readline.createInterface` on stdout/stderr
- Parse log lines, forward via structured logger
- Detect errors (e.g. bind failures) and reject startup promise

## Graceful Shutdown
1. Send `SIGTERM`
2. Wait for exit (5s local, 10s CI — CI environments are slower)
3. If still running, send `SIGKILL`
4. Wait 500ms after exit for port release

```typescript
process.kill('SIGTERM');
await waitForExit(process.env.CI ? 10000 : 5000);
process.kill('SIGKILL'); // if still alive
```

## Cleanup
- Close all readline interfaces
- Remove all process event listeners
- Clear startup timeouts
