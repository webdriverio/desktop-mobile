# Service Architecture: Launcher/Worker Split

WDIO runs launcher and worker services in **separate processes**. Every service package splits into two classes accordingly.

## Launcher (`launcher.ts`)
- Runs in **main process** (no `browser` access)
- Hooks: `onPrepare`, `onWorkerStart`, `onWorkerEnd`, `onComplete`
- Responsibilities: binary detection, port allocation, driver spawning, capability mutation

## Worker Service (`service.ts`)
- Runs in **worker process** (receives `browser` via `before` hook)
- Hooks: `before`, `beforeTest`, `beforeCommand`, `after`, `afterSession`
- Responsibilities: API injection onto `browser`, mock lifecycle, window focus, log capture

## Rules
- Never access `browser` in launcher — it doesn't exist there
- Never spawn processes in worker — use launcher for all process management
- Capability mutations happen in `onPrepare` (ports, paths, browser options)
- `onWorkerStart` is for per-worker setup (debugger ports, per-worker driver spawning)
- Throw `SevereServiceError` (from `webdriverio`) for critical launcher failures that should stop the runner
- Regular `Error` in service hooks gets logged but doesn't stop the runner

## Entry Point (`index.ts`)
```typescript
import LauncherService from './launcher.js';
import WorkerService from './service.js';

export default WorkerService;
export const launcher = LauncherService;
```

WDIO expects `default` = worker service, named `launcher` = launcher service.
