# Tauri App Docker Testing

This directory contains Dockerfiles and testing scripts for verifying Tauri application compatibility across different Linux distributions.

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

| Distribution | glib Version | webkit2gtk | Status | Notes |
|-------------|-------------|-----------|---------|-------|
| **Ubuntu 24.04** | 2.80+ | webkit2gtk-4.1 | ✅ Supported | Stable, well-tested |
| **Debian 12+** | 2.74+ | webkit2gtk-4.0 | ✅ Supported | Rock-solid stability |
| **Fedora 40+** | 2.80+ | webkit2gtk-4.1 | ✅ Supported | Latest packages |
| **Arch Linux** | 2.82+ | webkit2gtk-4.1 | ✅ Supported | Rolling release |

### Unsupported Distributions

#### Alpine Linux
**Status:** ❌ Unsupported for building

Alpine uses **musl libc** which defaults to static linking. GTK/webkit libraries don't provide static versions (`.a` files) in Alpine repositories, making it impossible to build Tauri applications.

**Alternative:** Use Alpine for runtime-only containers by building on a glibc-based distro and copying the binary to Alpine.

#### CentOS Stream / RHEL
**Status:** ❌ Unsupported

- **CentOS Stream 9 / RHEL 9:** Ships with glib 2.68.4, but Tauri requires glib >= 2.70
- **CentOS Stream 10 / RHEL 10:** WebKitGTK was **intentionally removed** by Red Hat

**Why WebKitGTK was removed from RHEL 10:**
- **Security:** Accumulated 200+ unfixed CVEs enabling remote code execution
- **Maintenance burden:** Upstream requires frequent updates incompatible with RHEL's 10-year support model
- **Strategic shift:** Red Hat migrated to QtWebEngine (Chromium-based) for better security and enterprise hardening

**Alternative:** Use **Fedora 40+** for RHEL-based workflows.

**References:**
- [RHEL 10 Release Notes - Removed Features](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/10.0_release_notes/removed-features)
- [Fedora Devel Discussion on WebKitGTK Removal](https://lists.fedoraproject.org/archives/list/devel@lists.fedoraproject.org/thread/AKVB363GFCHHJ5MTHGVYHYT6NLLTF5VM/)

## Distribution Requirements

All supported distributions must provide:

1. **glib-2.0 >= 2.70** (critical for Tauri)
2. **webkit2gtk** (4.0 or 4.1)
3. **GTK 3** development libraries
4. **glibc** (musl is unsupported for building)
5. **pkg-config** for library detection
6. **Xvfb** for headless testing

## Package Installation Commands

### Ubuntu / Debian
```bash
apt-get update
apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    xvfb
```

### Fedora
```bash
dnf install -y \
    webkit2gtk4.1-devel \
    gtk3-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel \
    patchelf \
    xorg-x11-server-Xvfb
```

### Arch Linux
```bash
pacman -Syu --noconfirm \
    webkit2gtk-4.1 \
    gtk3 \
    libappindicator-gtk3 \
    librsvg \
    xorg-server-xvfb
```

## Test Script Usage

### Build Only
Tests if the Docker image can be built with all system dependencies:

```bash
./test.sh debian build
```

**What it does:**
- Pulls base image
- Installs system packages
- Installs Node.js, Rust
- Installs Tauri runtime dependencies
- Verifies critical packages are available

### Full Test Suite
Builds the Docker image and runs the complete test suite inside:

```bash
./test.sh debian test
```

**What it does:**
1. On the runner (Node 24, before Docker): build the `@wdio/*` packages and pack them to tarballs
2. Build Docker image (same as `build` mode)
3. Mount workspace at `/workspace` + tarballs at `/tarballs` into container
4. Rewrite the fixture's `workspace:*` deps to `file:` tarball paths and `npm install` (the fixture's pnpm `node_modules` is cleared first — npm's arborist cannot load a pnpm layout)
5. Build the Tauri example app (`build-web.ts` + `tauri build --debug`)
6. Run WebdriverIO tests with Xvfb

### Debug Mode
Build with verbose output and no caching:

```bash
./test.sh debian debug
```

**When to use:**
- Debugging package installation issues
- Investigating build failures
- Finding which layer fails

## Dockerfile Structure

Each Dockerfile follows this pattern:

```dockerfile
FROM <base-image>

# 1. Basic Requirements
RUN <install curl, git, build-essential, xvfb>

# 2. Node.js
RUN <install nodejs 24.x>

# 3. Rust Toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# 4. Tauri Dependencies
RUN <install webkit2gtk, gtk3, glib2, etc.>

# 5. Test User
RUN <create testuser with sudo>

# 6. Verification
RUN <verify WebKitWebDriver exists>

WORKDIR /app
USER testuser
CMD ["bash"]
```

## CI Integration

These Dockerfiles are used in:
- `.github/workflows/ci.yml` - CI workflow for cross-distribution compatibility tests
- Local development testing
- Cross-distribution compatibility verification

## Logs

Test logs are saved to `/tmp/docker-*.log`:

```bash
# View build logs
cat /tmp/docker-build-ubuntu.log

# View test logs
cat /tmp/docker-test-ubuntu.log
```

## Common Issues

### "glib-2.0 >= 2.70 not found"
**Cause:** Distribution ships with older glib version
**Solution:** Use Fedora 40+, Ubuntu 24.04, Debian 12+, or Arch Linux

### "cannot find -lgdk-3: No such file or directory"
**Cause:** Alpine Linux / musl static linking incompatibility
**Solution:** Use glibc-based distro (Ubuntu/Debian/Fedora/Arch)

### "No match for argument: webkit2gtk"
**Cause:** CentOS Stream 10 / RHEL 10 intentionally removed WebKitGTK
**Solution:** Use Fedora 40+ for RHEL-based workflows

### "WebKitWebDriver not found"
**Cause:** webkit2gtk-driver package not installed
**Solution:** Install the appropriate package for your distro (see [Package Installation Commands](#package-installation-commands))

## Why These Distributions?

### Ubuntu 24.04 LTS
- **Use case:** CI/CD, general testing
- **Pros:** Most documented, stable, wide tooling support, GitHub Actions default
- **Cons:** Some packages may lag behind latest

### Debian 13 (Trixie)
- **Use case:** Production builds, long-term stability
- **Pros:** Rock-solid, conservative updates, excellent for production
- **Cons:** Slightly older packages than Ubuntu

### Fedora 44
- **Use case:** Development, RHEL-based workflows
- **Pros:** Latest stable packages, upstream for RHEL, modern environment
- **Cons:** More frequent updates, shorter support lifecycle

### Arch Linux
- **Use case:** Development, bleeding-edge testing
- **Pros:** Always latest packages, excellent package manager
- **Cons:** Rolling release = potential for breaking changes

## Alpine Runtime Containers (Advanced)

While Alpine cannot be used for **building** Tauri apps, it can be used for minimal **runtime** containers:

### Multi-stage Build Example

```dockerfile
# Stage 1: Build on glibc-based distro
FROM ubuntu:24.04 AS builder
RUN apt-get update && apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    curl \
    build-essential
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
COPY . /build
WORKDIR /build
RUN cargo build --release

# Stage 2: Runtime on Alpine
FROM alpine:latest
RUN apk add --no-cache \
    webkit2gtk-4.1 \
    gtk+3.0 \
    libayatana-appindicator \
    librsvg
COPY --from=builder /build/target/release/tauri-app /usr/local/bin/
CMD ["tauri-app"]
```

**Benefits:**
- Smaller final image size
- Minimal attack surface
- Only runtime dependencies

**Caveats:**
- Must ensure all dynamic libraries are compatible
- May need additional runtime libraries
- Test thoroughly before production use

## Contributing

When adding support for a new distribution:

1. Create `distro-name.dockerfile` based on existing templates
2. Add entry to `get_test_case()` in `test.sh`
3. Add to `get_all_test_keys()` in `test.sh`
4. Test locally: `./test.sh distro-name test`
5. Update this README with:
   - Distribution in support table
   - Package installation commands
   - Any special considerations
6. Add to CI workflow if fully supported

## Testing Methodology

All distributions are tested using Docker containers with:

**System Package Installation:**
- Official base image from distribution
- All required development packages
- Rust toolchain (latest stable)
- Node.js 24.x

**Build Testing:**
- Install the runner-packed `@wdio/*` tarballs with npm (no in-container workspace build)
- Tauri example app build (web assets + `tauri build --debug`)
- WebdriverIO test execution with Xvfb

**Pass Criteria:**
- Docker image builds successfully
- All packages install without errors
- Tauri app compiles without errors
- WebdriverIO tests execute successfully

## Related Documentation

- **[Tauri Service README](../../README.md)** - Service usage and API reference
- **[Package Tests README](../README.md)** - Overview of package test fixtures

## License

Same as parent project.
