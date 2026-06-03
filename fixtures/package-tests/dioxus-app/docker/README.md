# Dioxus App Docker Testing

Dockerfiles and a test script for verifying Dioxus application compatibility across
different Linux distributions.

## Why this exists (and how it differs from Tauri)

Dioxus desktop renders through **Wry → WebKitGTK** — the same system WebView that
Tauri uses on Linux. Each distribution ships a different WebKitGTK version, so the
app build and rendering runtime genuinely vary per distro, which is what this matrix
exercises.

The crucial difference from the [Tauri Docker harness](../../tauri-app/docker/README.md):
the Dioxus fixture uses the **`'embedded'` driver provider**. The WebDriver server is
compiled *into* the app from `wdio-dioxus-embedded-driver`, so there is **no system
`WebKitWebDriver` binary to detect or install**. These images therefore:

- install only the WebKitGTK **build** dependencies (Wry links against `webkit2gtk-4.1`);
- **omit** `webkit2gtk-driver` / `webkitgtk-6.0` and the `WebKitWebDriver` lookup;
- verify the build invariant with `pkg-config --exists webkit2gtk-4.1` instead.

What this matrix validates: **app build + headless launch + bridge protocol** against
each distro's WebKitGTK — not driver discovery.

## Quick Start

```bash
# Test a specific distribution
./test.sh ubuntu build     # Build Docker image only
./test.sh ubuntu test      # Build image + run full test suite
./test.sh ubuntu debug     # Build with verbose output for debugging

# Test all distributions
./test.sh all build
./test.sh all test
```

## Supported Distributions

| Distribution | WebKitGTK | Status |
|-------------|-----------|--------|
| **Ubuntu 24.04** | webkit2gtk-4.1 | ✅ Supported |
| **Debian 12+** | webkit2gtk-4.1 | ✅ Supported |
| **Fedora 40+** | webkit2gtk-4.1 | ✅ Supported |
| **Arch Linux** | webkit2gtk-4.1 | ✅ Supported |
| **Void Linux** | webkit2gtk-4.1 | ✅ Supported |

### Excluded Distributions

Same exclusions as the Tauri harness, for the same reasons (they are properties of
WebKitGTK on Linux, not of the driver model):

- **Alpine** — musl/static linking is incompatible with GTK/WebKit (no static libs).
- **CentOS Stream 9 / RHEL 9** — glib too old for the WebKitGTK stack.
- **CentOS Stream 10 / RHEL 10** — WebKitGTK removed by Red Hat.
- **openSUSE** — no convenient packaged WebKitGTK build for this flow.

See the [Tauri Docker README](../../tauri-app/docker/README.md#unsupported-distributions)
for the detailed rationale.

## What the full test suite does

```bash
./test.sh ubuntu test
```

1. Build the Docker image (system packages, Node 20, pnpm, Rust toolchain, WebKitGTK build deps).
2. Mount the workspace into the container and start Xvfb.
3. `pnpm install --frozen-lockfile`.
4. `pnpm --filter @wdio/dioxus-service... build` (service + its workspace dependencies).
5. `pnpm --filter @wdio/dioxus-bridge... build` — the guest-js bundle the bridge crate's
   `build.rs` bakes into the app binary. Not a service dependency, so step 4 skips it;
   without it the bundle silently degrades to a no-op and every bridge call times out.
6. `cargo build` the Dioxus app — this also compiles the embedded driver and the bridge crate into the binary.
7. `pnpm test` (WebdriverIO against the embedded driver, headless under Xvfb).

There is no separate plugin-build step: unlike Tauri's JS plugin, the Dioxus bridge
and embedded driver are Rust crates pulled in by the app's `Cargo.toml` and built by `cargo`.

## Logs

```bash
cat /tmp/docker-build-ubuntu.log   # image build log
cat /tmp/docker-test-ubuntu.log    # in-container test log
```

In CI these are uploaded as the `test-results-dioxus-<distro>-…` artifact.

## Adding a distribution

1. Create `<distro>.dockerfile` from an existing template (drop any `WebKitWebDriver`
   bits — the embedded driver does not need them).
2. Add the distro to `get_test_case()` and `get_all_test_keys()` in `test.sh`.
3. Add a matrix entry to `package-dioxus-distros` in `.github/workflows/ci.yml`.
4. Test locally: `./test.sh <distro> test`.

## Related Documentation

- [Tauri Docker README](../../tauri-app/docker/README.md) — the sibling harness this one mirrors
- [Dioxus Service Platform Support](../../../../packages/dioxus-service/docs/platform-support.md)
- [Package Tests README](../../README.md)
