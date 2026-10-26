# Tauri Basic App

A basic Tauri application for WebDriverIO testing. This app demonstrates core Tauri functionality and serves as a test fixture for the `@wdio/tauri-service`.

## Features

### Frontend

- Simple counter application with increment, decrement, and reset functionality
- Modern UI with gradient background and smooth animations
- Status display showing application state
- Tauri API availability detection

### Backend (Rust)

- Window management commands (bounds, minimize, maximize, close)
- Screenshot capture functionality
- File system operations (read, write, delete)
- Platform information retrieval
- Clipboard operations
- Process management

## Commands

### Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build the application
pnpm build

# Build in debug mode
pnpm build:debug
```

### Testing

```bash
# Run WebDriverIO tests
pnpm test
```

## Test Structure

### Basic Functionality Tests (`test/basic.spec.ts`)

- Application loading and UI elements
- Counter increment/decrement/reset
- Status updates
- User interactions

### Tauri Commands Tests (`test/tauri-commands.spec.ts`)

- Window management (bounds, minimize, maximize)
- Screenshot capture
- File operations
- Platform information
- Clipboard operations

## Configuration

### WebDriverIO Configuration (`wdio.conf.ts`)

- Uses `@wdio/tauri-service` for Tauri-specific functionality
- Connects to `tauri-driver` on port 4444
- Configurable app binary path via environment variables
- Debug mode support

### Tauri Configuration (`src-tauri/tauri.conf.json`)

- Enables all necessary Tauri features
- Configures `tauri-driver` for WebDriver testing
- Sets up window properties and security settings

## Environment Variables

- `TAURI_APP_BINARY_PATH`: Path to the built Tauri app binary
- `DEBUG`: Enable debug logging (set to 'true')

## Dependencies

### Frontend

- `@tauri-apps/api`: Tauri frontend API

### Backend (Rust)

- `tauri`: Core Tauri framework
- `serde`: Serialization
- `screenshot-rs`: Screenshot capture
- `sysinfo`: Platform information
- `clipboard`: Clipboard operations

### Testing

- `@wdio/tauri-service`: WebDriverIO Tauri service
- `@wdio/cli`: WebDriverIO CLI
- `@wdio/local-runner`: Local test runner
- `@wdio/mocha-framework`: Mocha test framework
- `@wdio/spec-reporter`: Spec reporter

## Usage in CI/CD

This app is designed to be used as a test fixture in CI/CD pipelines:
1. **Build the app**: `pnpm build`
2. **Set binary path**: `export TAURI_APP_BINARY_PATH=/path/to/built/app`
3. **Run tests**: `pnpm test`

The app supports both Windows and Linux platforms for CI testing.
