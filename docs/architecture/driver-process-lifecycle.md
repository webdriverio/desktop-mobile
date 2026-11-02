# Driver Process Lifecycle

Services that spawn external driver processes (tauri-driver, chromedriver, etc.) follow this lifecycle. `DriverProcess` in `@wdio/native-core` implements it; use that rather than spawning a driver yourself.

## Spawning

```typescript
spawn(driverPath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  env: mergeEnv(process.env, customEnv),
});
```

- `stdin` ignored, `stdout`/`stderr` piped for log forwarding
- Never use `detached: true` — driver must die with parent
- Merge the environment with `mergeEnv` from `@wdio/native-utils`, not `{ ...process.env, ...customEnv }`. Windows variable names ignore case, and a spread keeps both `PATH` and `Path`, so a child process can drop the override.
- On Windows, start a `.exe` (or `.com`) directly, with its path and arguments as they are. Only a `.cmd` or `.bat` shim, or a bare name, needs `cmd.exe` (`shell: true`). Pass it one command line with each argument quoted, because spawn's shell mode joins the arguments unquoted and a path with a space would split.

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

1. Send `SIGTERM`. A driver started through `cmd.exe` on Windows needs `taskkill /pid <pid> /T /F` instead: killing `cmd.exe` alone leaves the driver it started running and holding its port.
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
