#!/bin/bash

# Runs INSIDE the distro container (test.sh bind-mounts the workspace at
# /workspace and invokes this file). Kept as a separate script rather than an
# inline `bash -c "..."` string: an unescaped double quote inside an inline
# script silently truncates it at that quote, and the container then exits 0
# having run nothing — CI reports a green no-op. That exact failure shipped
# two false-positive runs of the sibling Dioxus matrix.

set -e

export TURBO_TELEMETRY_DISABLED=1
export DISPLAY=:99

echo '=== Starting Xvfb ==='
# Start Xvfb in background (some distros use different paths)
if command -v Xvfb > /dev/null; then
    Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
    XVFB_PID=$!
    sleep 2
    echo "Xvfb started with PID: $XVFB_PID"
else
    echo '⚠️  Xvfb not found, tests may fail'
fi

echo '=== Installing workspace dependencies ==='
pnpm install --frozen-lockfile

echo '=== Building tauri-service and dependencies ==='
pnpm --filter @wdio/tauri-service... build

echo '=== Building tauri-plugin (required for app build) ==='
pnpm --filter @wdio/tauri-plugin build

echo '=== Building Tauri app ==='
cd fixtures/package-tests/tauri-app
pnpm run build

echo '=== Running Tauri package test ==='
# Capture the exit code instead of letting set -e abort here, so the wdio
# session logs are still copied out on failure — that is exactly when they
# are needed.
set +e
pnpm test
TEST_EXIT=$?
set -e

echo '=== Copying logs to mounted volume ==='
# Absolute path: CWD is the app dir at this point, so a repo-relative
# path would double-nest and silently copy nothing.
cp -r /workspace/fixtures/package-tests/tauri-app/logs-* /workspace/logs-output/ 2>/dev/null || echo 'No logs to copy'

# Clean up Xvfb if it was started
if [ -n "$XVFB_PID" ]; then
    kill $XVFB_PID 2>/dev/null || true
fi

exit $TEST_EXIT
