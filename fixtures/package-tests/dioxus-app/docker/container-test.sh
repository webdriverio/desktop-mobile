#!/bin/bash

# Runs INSIDE the distro container (test.sh bind-mounts the workspace at
# /workspace and invokes this file). Kept as a separate script rather than an
# inline `bash -c "..."` string: an unescaped double quote inside an inline
# script silently truncates it at that quote, and the container then exits 0
# having run nothing -- CI reports a green no-op. That exact failure shipped
# two false-positive runs of this matrix.
#
# Tarballs are pre-packed on the CI runner (Node 24, full workspace toolchain)
# and bind-mounted at /tarballs. The container only needs to install them and
# build the fixture's Rust binary -- it no longer requires the workspace
# toolchain (pnpm install --frozen-lockfile, turbo, TS execution). (#350)
#
# Note: dioxus-bridge dist-js is baked into the app binary at cargo-build time
# via build.rs (packages/dioxus-bridge/build.rs). The bridge Rust crate is
# referenced via a workspace path dep in Cargo.toml, so dist-js/index.js is
# already present in the bind-mounted workspace after the runner's build step.

set -e

export DISPLAY=:99
# No GL/WebKit env tweaks needed: the "libEGL DRI3 error" warnings under
# Xvfb are benign (the bare-runner package test prints the same ones and
# passes), and Mesa falls back to its software rasteriser on its own.

echo '=== Starting Xvfb ==='
# Start Xvfb in background (some distros use different paths)
if command -v Xvfb > /dev/null; then
    Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
    XVFB_PID=$!
    sleep 2
    echo "Xvfb started with PID: $XVFB_PID"
else
    echo 'Warning: Xvfb not found, tests may fail'
fi

# Verify tarballs were provided
if [ ! -d /tarballs ] || [ -z "$(ls /tarballs/*.tgz 2>/dev/null)" ]; then
    echo 'ERROR: /tarballs must contain pre-packed workspace tarballs.'
    echo 'Pack them on the runner before launching the container:'
    echo '  for pkg in dioxus-service native-core native-spy native-types native-utils; do'
    echo '    pnpm pack -C packages/$pkg --pack-destination dist/tarballs'
    echo '  done'
    exit 1
fi

echo '=== Tarballs available ==='
ls -lh /tarballs/

echo '=== Verifying bridge guest-js bundle ==='
# The bridge crate's build.rs (packages/dioxus-bridge/build.rs) embeds
# dist-js/index.js into the binary at cargo-build time. The CI runner builds
# @wdio/dioxus-bridge before packing, so the file is present in the workspace.
test -s /workspace/packages/dioxus-bridge/dist-js/index.js || {
    echo 'ERROR: bridge guest-js bundle missing from workspace.'
    echo 'The runner build step should have produced packages/dioxus-bridge/dist-js/index.js.'
    exit 1
}

echo '=== Installing workspace packages from tarballs ==='
# Install from fixture app directory. Replace workspace:* refs in package.json
# with file: paths to the pre-packed tarballs, then run npm install so that
# all @wdio/* workspace packages resolve to the built artefacts rather than
# the live workspace source.
cd /workspace/fixtures/package-tests/dioxus-app

# Rewrite workspace:* entries in package.json to file:/tarballs/<tarball>.
# npm understands file: protocol; pnpm workspace: protocol is workspace-only.
# `set -e` does NOT abort on a failed `VAR=$(cmd)` assignment, so guard the patch
# step explicitly -- otherwise a missing-tarball exit(1) falls through and
# resurfaces as an opaque `npm install` error instead of this clear one.
if ! PATCHED_PKG=$(node - << 'JS_EOF'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tarballs = fs.readdirSync('/tarballs').filter(f => f.endsWith('.tgz'));

// Build a map of @wdio/package-name -> file: path for every tarball
const tarballMap = {};
for (const tarball of tarballs) {
  const base = tarball.replace('.tgz', '');
  const segments = base.split('-');
  const versionIdx = segments.findIndex(s => /^\d+\.\d+/.test(s));
  if (versionIdx <= 1) continue;
  const pkgName = '@' + segments[0] + '/' + segments.slice(1, versionIdx).join('-');
  tarballMap[pkgName] = 'file:/tarballs/' + tarball;
}

// Patch workspace:* in all dep sections
for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  if (!pkg[section]) continue;
  for (const [name, ver] of Object.entries(pkg[section])) {
    if (ver !== 'workspace:*') continue;
    if (!tarballMap[name]) { console.error('No tarball found for ' + name); process.exit(1); }
    pkg[section][name] = tarballMap[name];
  }
}

// Add ALL workspace tarballs as direct devDependencies so npm can
// deduplicate transitive @wdio/* deps without hitting the registry.
// (Avoids the npm arborist bug with file: in overrides.)
pkg.devDependencies = pkg.devDependencies || {};
for (const [name, path] of Object.entries(tarballMap)) {
  if (!pkg.dependencies?.[name] && !pkg.devDependencies[name]) {
    pkg.devDependencies[name] = path;
  }
}
// Remove any overrides left from a previous attempt
delete pkg.overrides;

process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
JS_EOF
); then
  echo 'ERROR: failed to rewrite package.json deps to /tarballs paths (see node error above).'
  exit 1
fi
echo "$PATCHED_PKG" > package.json.patched
mv package.json package.json.orig
mv package.json.patched package.json
trap 'mv -f package.json.orig package.json 2>/dev/null || true' EXIT

# This fixture is a pnpm workspace member, so the runner's `pnpm install` leaves
# a symlinked node_modules here (entries link out to ../../../../node_modules/.pnpm
# and ../../../../packages). The whole workspace is bind-mounted in, so npm's
# arborist tries to load that pnpm layout and crashes on a symlink it can't
# resolve in its own model: "Cannot destructure property 'package' of
# 'node.target' as it is null". Clear it so npm builds node_modules purely from
# the tarballs + registry.
rm -rf node_modules package-lock.json

npm install --prefer-offline 2>&1

# Restore original package.json so the working tree stays clean for log uploads
rm package.json
mv package.json.orig package.json

echo '=== Building Dioxus app (compiles embedded driver + bridge) ==='
cargo build --manifest-path src-dioxus/Cargo.toml

echo '=== Running Dioxus package test ==='
# Capture the exit code instead of letting set -e abort here, so the
# wdio session logs (backend/frontend tracing) are still copied out on
# failure -- that is exactly when they are needed.
set +e
npx wdio run wdio.conf.ts
TEST_EXIT=$?
set -e

echo '=== Copying logs to mounted volume ==='
# Absolute path: CWD is the app dir at this point, so a repo-relative
# path would double-nest and silently copy nothing.
cp -r /workspace/fixtures/package-tests/dioxus-app/logs* /workspace/logs-output/ 2>/dev/null || echo 'No logs to copy'

# Clean up Xvfb if it was started
if [ -n "$XVFB_PID" ]; then
    kill $XVFB_PID 2>/dev/null || true
fi

exit $TEST_EXIT
