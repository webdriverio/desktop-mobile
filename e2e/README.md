# E2E Testing Framework

This directory contains end-to-end tests for WebdriverIO desktop & mobile services, supporting both Electron and Tauri applications.

## Overview

The E2E testing framework provides comprehensive testing capabilities for desktop applications built with Electron and Tauri frameworks. It includes:

- **Framework-aware configuration**: Automatic detection and configuration based on the target framework
- **Multi-platform support**: Windows, macOS, and Linux testing
- **Comprehensive test coverage**: API testing, window management, file operations, and more
- **Flexible test execution**: Support for different test types and configurations

## Directory Structure

```
e2e/
├── config/
│   └── envSchema.ts          # Environment variable schema and validation
├── lib/
│   ├── statusBar.ts          # Test execution status tracking
│   └── utils.ts              # Utility functions
├── scripts/
│   ├── build-apps.ts         # App building and management
│   └── run-matrix.ts         # Test matrix execution
├── test/
│   ├── electron/             # Electron-specific tests
│   │   ├── api.spec.ts       # Electron API testing
│   │   ├── application.spec.ts
│   │   ├── dom.spec.ts       # DOM interaction tests
│   │   ├── interaction.spec.ts
│   │   ├── multiremote/      # Multi-instance tests
│   │   ├── standalone/       # Standalone mode tests
│   │   └── window.spec.ts    # Window management tests
│   └── tauri/                # Tauri-specific tests
│       ├── commands.spec.ts  # Tauri command execution
│       ├── window.spec.ts    # Window management
│       ├── filesystem.spec.ts # File operations
│       ├── platform.spec.ts  # Platform information
│       ├── backend-access.spec.ts # Rust backend access
│       ├── multiremote/      # Multi-instance tests
│       └── standalone/       # Standalone mode tests
├── wdio.conf.ts              # Main configuration (framework-aware)
├── wdio.electron.conf.ts     # Electron-specific configuration
└── wdio.tauri.conf.ts        # Tauri-specific configuration
```

## Environment Variables

The testing framework uses environment variables to control test execution:

### Core Configuration

- **`FRAMEWORK`**: Target framework (`electron` | `tauri`)
- **`APP`**: Application type
  - For Electron: `builder` | `forge` | `script`
  - For Tauri: `basic` | `advanced`
- **`TEST_TYPE`**: Test execution mode (`standard` | `window` | `multiremote` | `standalone`)
- **`BINARY`**: Binary mode (`true` | `false`)

### Special Modes

- **`MAC_UNIVERSAL`**: Mac Universal builds (`true` | `false`) - Electron only
- **`ENABLE_SPLASH_WINDOW`**: Enable splash window for window tests
- **`CONCURRENCY`**: Number of parallel test executions

### Debug Options

- **`WDIO_VERBOSE`**: Enable verbose WebDriverIO output
- **`WDIO_MATRIX_DEBUG`**: Enable debug output for test matrix
- **`FORCE_REBUILD`**: Force rebuild of test applications

## Test Execution

### Running Tests

#### Full Test Matrix
```bash
# Run all tests for all frameworks and configurations
pnpm e2e

# Run with specific framework
FRAMEWORK=electron pnpm e2e
FRAMEWORK=tauri pnpm e2e
```

#### Framework-Specific Tests
```bash
# Electron tests
pnpm e2e:builder
pnpm e2e:forge
pnpm e2e:electron-script

# Tauri tests
pnpm e2e:tauri
pnpm e2e:tauri:basic
pnpm e2e:tauri:advanced
```

#### Test Type-Specific
```bash
# Standard tests
pnpm e2e:standard

# Window management tests
pnpm e2e:window

# Multi-instance tests
pnpm e2e:multiremote

# Standalone mode tests
pnpm e2e:standalone
```

**Note**: E2E tests use ESM only. CJS/ESM module system testing is done in package tests (see `fixtures/package-tests/`).

### Test Matrix Script

The `run-matrix.ts` script provides comprehensive test execution with filtering:

```bash
# Run full matrix
tsx scripts/run-matrix.ts

# Filter by framework
tsx scripts/run-matrix.ts --framework=tauri

# Filter by app
tsx scripts/run-matrix.ts --app=basic

# Filter by test type
tsx scripts/run-matrix.ts --test-type=window

# Combine filters
tsx scripts/run-matrix.ts --framework=electron --app=builder --test-type=multiremote

# Run with concurrency
tsx scripts/run-matrix.ts --concurrency=3
```

## Test Patterns

### Electron Testing

Electron tests focus on:
- **API Testing**: Electron main process APIs
- **Window Management**: BrowserWindow operations
- **DOM Interaction**: Renderer process testing
- **Multi-instance**: Multiple Electron processes
- **Standalone Mode**: Direct Electron service usage

#### Example Electron Test
```typescript
describe('Electron API', () => {
  it('should execute main process code', async () => {
    const result = await browser.electron.execute(() => {
      return process.platform;
    });
    expect(result).to.equal(process.platform);
  });

  it('should mock Electron APIs', async () => {
    await browser.electron.mock('dialog', 'showOpenDialog');
    // Test mocked dialog behavior
  });
});
```

### Tauri Testing

Tauri tests focus on:
- **Command Execution**: Rust backend commands
- **Window Management**: Tauri window operations
- **File Operations**: File system access
- **Platform Information**: System information
- **Backend Access**: Rust crate functionality

#### Example Tauri Test
```typescript
describe('Tauri Commands', () => {
  it('should execute Rust commands', async () => {
    const result = await browser.tauri.execute('get_platform_info');
    expect(result.success).to.be.true;
    expect(result.data).to.have.property('platform');
  });

  it('should manage windows', async () => {
    const bounds = await browser.tauri.getWindowBounds();
    expect(bounds.success).to.be.true;
    expect(bounds.data).to.have.property('width');
  });
});
```

## Configuration Files

### Main Configuration (`wdio.conf.ts`)

The main configuration file automatically selects the appropriate framework-specific configuration based on the `FRAMEWORK` environment variable.

### Framework-Specific Configurations

#### Electron Configuration (`wdio.electron.conf.ts`)
- Configures Electron service
- Handles binary detection for Forge/Builder apps
- Sets up script mode for development
- Manages Electron-specific capabilities

#### Tauri Configuration (`wdio.tauri.conf.ts`)
- Configures Tauri service
- Handles Tauri binary detection
- Sets up tauri-driver integration
- Manages Tauri-specific capabilities

## Application Building

The `build-apps.ts` script manages building test applications:

```bash
# Build apps for current environment
tsx scripts/build-apps.ts

# Build all apps
tsx scripts/build-apps.ts --all

# Force rebuild
tsx scripts/build-apps.ts --force

# Clean build artifacts
tsx scripts/build-apps.ts --clean
```

### Build Artifacts

#### Electron Apps
- **Builder apps**: `dist/` directory with packaged binaries
- **Forge apps**: `out/` directory with packaged binaries
- **Script apps**: `dist/` directory with main.js

#### Tauri Apps
- **Basic/Advanced apps**: `target/release/` with compiled binaries (Cargo workspace root)

## Test Applications

### Electron Test Apps
Located in `../fixtures/e2e-apps/`:
- `electron-builder`: Electron Builder app (ESM only)
- `electron-forge`: Electron Forge app (ESM only)
- `electron-script`: Development mode app (ESM only)

**Note**: E2E tests use ESM-only apps. CJS/ESM variants are tested in package tests.

### Tauri Test Apps
Located in `../fixtures/e2e-apps/`:
- `tauri`: Tauri app with core functionality

## CI/CD Integration

### GitHub Actions

The framework integrates with GitHub Actions for continuous integration:

```yaml
# Example workflow step
- name: Run E2E Tests
  run: |
    FRAMEWORK=electron APP=builder pnpm e2e
    FRAMEWORK=tauri APP=basic pnpm e2e
```

### Turborepo Integration

Tests are integrated with Turborepo for efficient execution:

```bash
# Run specific test combinations
turbo run test:e2e:electron-builder
turbo run test:e2e:tauri
```

## Debugging

### Log Files
Test logs are stored in `logs/` directory with framework and configuration-specific subdirectories.

### Debug Mode
Enable debug output:
```bash
WDIO_MATRIX_DEBUG=true tsx scripts/run-matrix.ts
WDIO_VERBOSE=true pnpm e2e
```

### Status Tracking
The framework includes real-time status tracking during test execution, showing progress and results.

## Troubleshooting

### Common Issues

1. **App Build Failures**: Ensure all dependencies are installed and build tools are available
2. **Binary Detection Issues**: Check that apps are properly built before running tests
3. **Framework Detection**: Verify `FRAMEWORK` environment variable is set correctly
4. **Path Issues**: Ensure test applications exist in the correct fixture directories

### Debug Commands

```bash
# Check environment configuration
tsx -e "import { createEnvironmentContext } from './config/envSchema.js'; console.log(createEnvironmentContext().toString())"

# Verify app paths
tsx -e "import { createEnvironmentContext } from './config/envSchema.js'; const ctx = createEnvironmentContext(); console.log('App path:', ctx.appDirPath)"

# Test build artifacts
tsx scripts/build-apps.ts --all
```

## Contributing

When adding new tests:

1. **Framework-specific tests**: Place in `test/electron/` or `test/tauri/` directories
2. **Test naming**: Use descriptive names that indicate the test purpose
3. **Environment variables**: Update `envSchema.ts` for new configuration options
4. **Documentation**: Update this README for new patterns or features

## Architecture

The E2E framework follows a modular architecture:

- **Configuration Layer**: Environment-aware configuration management
- **Test Layer**: Framework-specific test implementations
- **Build Layer**: Application building and artifact management
- **Execution Layer**: Test matrix and parallel execution
- **Reporting Layer**: Status tracking and result reporting

This architecture ensures maintainability, extensibility, and clear separation of concerns between different testing frameworks and configurations.
