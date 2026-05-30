#!/bin/bash
# Setup script to register the testapp:// protocol handler for Tauri E2E testing
# Wrapper for shared setup script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

"$PROJECT_ROOT/scripts/protocol-handlers/setup-protocol-handler.sh" \
    "$APP_DIR" \
    "tauri-e2e-app" \
    "target/release,target/debug" \
    "tauri-e2e-app-testapp" \
    "Tauri E2E Test App"
