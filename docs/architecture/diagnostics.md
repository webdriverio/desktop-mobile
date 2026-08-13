# Environment Diagnostics

Services should run environment diagnostics in `onWorkerStart` before tests execute.

## DiagnosticResult Format
```typescript
interface DiagnosticResult {
  category: string;     // e.g. 'Binary', 'Driver', 'Platform'
  status: 'ok' | 'warn' | 'error';
  message: string;      // Human-readable summary
  details?: string;     // Additional context (shown at debug level)
}
```

## Standard Checks
All services should check:
- **Platform** — OS, arch, Node version
- **Binary** — App exists, is executable, correct permissions
- **Driver** — Required driver found and correct version
- **Dependencies** — Platform-specific libraries/packages

## Output
```
✅ Platform: linux x64
✅ Binary Permissions: 755
✅ Tauri Driver: /usr/local/bin/tauri-driver (found)
⚠️ WebKitWebDriver: Not found
❌ Shared Libraries: 2 missing
```

## Rules
- `warn` = tests may work but something is suboptimal
- `error` = tests will likely fail
- Always include actionable details for `warn`/`error` results
- Log at `info` level for `ok`/`warn`, `debug` for details
- Don't throw from diagnostics — collect all results, then decide if it's fatal
