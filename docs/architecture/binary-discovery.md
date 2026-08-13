# Binary Discovery & Auto-Install

Services that depend on external binaries (drivers, backends) use a discovery chain with optional auto-install.

## Discovery Precedence
1. **User-provided path** — Check `options.*Path` config. Fail fast if set but missing.
2. **PATH lookup** — `which`/`where` command (platform-aware)
3. **Common install locations** — OS-specific paths (cargo bin, homebrew, etc.)
4. **Auto-install** — If `autoInstall*` option enabled, install via package manager

## Naming Convention
```typescript
// Discovery: find*() returns path or undefined
function findTauriDriver(): string | undefined;

// Ensure: ensure*() returns Result, handles full chain
async function ensureTauriDriver(options): Promise<Result<DriverInstallSuccess, Error>>;
```

## Return Type
```typescript
interface DriverInstallSuccess {
  path: string;
  method: 'found' | 'installed' | 'cached';
}
type DriverInstallResult = Result<DriverInstallSuccess, Error>;
```

## Result Type

`ensure*()` functions return `Result<T, E>` instead of throwing. Located at `native-utils/src/result.ts`, import from `@wdio/native-utils`.

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never>;
function Err<E>(error: E): Result<never, E>;
function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T };
function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E };
function unwrap<T, E>(result: Result<T, E>): T;  // throws if Err
function wrapAsync<T>(promise: Promise<T>): Promise<Result<T, Error>>;
```

Check with `isOk()`/`isErr()`, access `.value`/`.error`. Never use `.success`, `.data`, or `.result` properties.

## Rules
- Always return `Result`, never throw from `ensure*()` functions
- `find*()` is pure discovery (no side effects), `ensure*()` may install
- On Windows, handle `.cmd`/`.exe` extensions and Git Bash path conversion
- Error messages must include install instructions for the user
- Auto-install should be opt-in (default `false`), not opt-out
