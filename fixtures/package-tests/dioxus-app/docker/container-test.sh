#!/bin/bash

# Runs INSIDE the distro container (test.sh bind-mounts the workspace at
# /workspace and invokes this file). Kept as a separate script rather than an
# inline `bash -c "..."` string: an unescaped double quote inside an inline
# script silently truncates it at that quote, and the container then exits 0
# having run nothing — CI reports a green no-op. That exact failure shipped
# two false-positive runs of this matrix.

set -e

export TURBO_TELEMETRY_DISABLED=1
export DISPLAY=:99
# The Dioxus embedded app uses a plain Wry WebKitGTK webview (not the
# WebKitWebDriver automation webview the sibling Tauri image drives).
# Xvfb in a bare container has no DRI3/GPU, so the WebKitGTK renderer
# fails GL init ("libEGL DRI3 error") and never executes page JS — every
# bridge round-trip then times out. Point GL at Mesa's software
# rasteriser (the images install the swrast/llvmpipe driver) and take
# the WebKit software paths. Tauri needs none of this because its
# automation webview renders differently.
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

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

echo '=== Building dioxus-service and dependencies ==='
pnpm --filter @wdio/dioxus-service... build

echo '=== Building Dioxus app (compiles embedded driver + bridge) ==='
cd fixtures/package-tests/dioxus-app
pnpm run build

echo '=== Running Dioxus package test ==='
# Capture the exit code instead of letting set -e abort here, so the
# wdio session logs (backend/frontend tracing) are still copied out on
# failure — that is exactly when they are needed.
set +e
pnpm test
TEST_EXIT=$?
set -e

echo '=== Copying logs to mounted volume ==='
# Absolute path: CWD is the app dir at this point, so a repo-relative
# path would double-nest and silently copy nothing.
cp -r /workspace/fixtures/package-tests/dioxus-app/logs* /workspace/logs-output/ 2>/dev/null || echo 'No logs to copy'

# Clean up Xvfb if it was started
if [ ! -z "$XVFB_PID" ]; then
    kill $XVFB_PID 2>/dev/null || true
fi

exit $TEST_EXIT
