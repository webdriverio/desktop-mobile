# Architecture references

Detailed, cross-service architecture notes for the native-testing service family.
Each file describes a pattern that recurs across `@wdio/*-service` packages; the
higher-level overview lives in [../architecture.md](../architecture.md), and
one-off decisions are recorded as [ADRs](../adr/).

| Reference | Covers |
|-----------|--------|
| [service-architecture](./service-architecture.md) | Launcher/worker service split and WDIO hook responsibilities |
| [package-entry-points](./package-entry-points.md) | Required exports from a service package's `index.ts` |
| [binary-discovery](./binary-discovery.md) | Binary discovery chain, auto-install, and the `Result` type pattern |
| [driver-process-lifecycle](./driver-process-lifecycle.md) | Spawning, readiness detection, log forwarding, graceful shutdown |
| [driver-pool](./driver-pool.md) | Managing multiple concurrent driver instances |
| [port-allocation](./port-allocation.md) | Dynamic port allocation with `PortManager` for parallel/multiremote |
| [cross-platform](./cross-platform.md) | Cross-platform process handling for Windows, macOS, Linux |
| [diagnostics](./diagnostics.md) | Environment diagnostics for pre-flight checks |
| [error-messages](./error-messages.md) | Actionable error messages with fix steps; launcher error conventions |
| [browser-api-injection](./browser-api-injection.md) | The framework API namespace on `browser` and mock lifecycle |
| [mock-architecture](./mock-architecture.md) | Inner/outer mock pattern spanning app and test process boundaries |
| [mock-store](./mock-store.md) | `MockStore` singleton for tracking active mocks and bulk operations |
| [mock-wrapper](./mock-wrapper.md) | Wrapper pattern for vitest mock compatibility across processes |
| [native-spy](./native-spy.md) | `@wdio/native-spy` — vitest-compatible mocking in app contexts |
