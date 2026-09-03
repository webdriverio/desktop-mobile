#!/bin/bash

# Runs INSIDE the distro container (test.sh bind-mounts the workspace at
# /workspace and invokes this file). Kept as a separate script rather than an
# inline `bash -c "..."` string: an unescaped double quote inside an inline
# script silently truncates it at that quote, and the container then exits 0
# having run nothing -- CI reports a green no-op. That exact failure shipped
# two false-positive runs of the sibling Dioxus matrix.
#
# Tarballs are pre-packed on the CI runner (Node 24, full workspace toolchain)
# and bind-mounted at /tarballs. The container only needs to install them and
# build the fixture's Rust binary -- it no longer requires the workspace
# toolchain (pnpm install --frozen-lockfile, turbo, TS execution). (#350)

set -e

export DISPLAY=:99

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
    echo '  for pkg in tauri-service tauri-plugin native-core native-spy native-types native-utils; do'
    echo '    pnpm pack -C packages/$pkg --pack-destination dist/tarballs'
    echo '  done'
    exit 1
fi

echo '=== Tarballs available ==='
ls -lh /tarballs/

echo '=== Installing workspace packages from tarballs ==='
# Install from fixture app directory. Replace workspace:* refs in package.json
# with file: paths to the pre-packed tarballs, then run npm install so that
# all @wdio/* workspace packages resolve to the built artefacts rather than
# the live workspace source.
cd /workspace/fixtures/package-tests/tauri-app

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

echo '=== Building Tauri app ==='
# Run the build steps individually rather than via `pnpm run build`, which would
# invoke build:js -- a workspace-filtered pnpm operation (`pnpm --filter
# @wdio/tauri-plugin build:js`) that needs the full pnpm workspace the container
# doesn't have. The plugin JS is already in node_modules/@wdio/tauri-plugin from the
# tarball install, and build-web.ts probes that path and copies it into dist/.
# build-web.ts runs under bare `node` -- the container is Node 24, which strips TS
# natively, so no tsx is needed (matches the fixture's own `build:web` script).
node scripts/build-web.ts
npx tauri build --debug

echo '=== Running Tauri package test ==='
# Capture the exit code instead of letting set -e abort here, so the wdio
# session logs are still copied out on failure -- that is exactly when they
# are needed.
set +e
npx wdio run wdio.conf.ts 2>&1 | tee /workspace/logs-output/wdio-run.log
TEST_EXIT=${PIPESTATUS[0]} # wdio's exit code
set -e

# libgtk-3.so.0 is guaranteed present in a Tauri container (WebKitGTK needs GTK 3).
echo '=== Regression guard: installed libraries must not be reported missing ==='
LDCONFIG_BIN=''
for c in ldconfig /usr/sbin/ldconfig /sbin/ldconfig; do
    if command -v "$c" > /dev/null 2>&1; then LDCONFIG_BIN="$c"; break; fi
done
if [ -z "$LDCONFIG_BIN" ]; then
    echo 'SKIP: no ldconfig found; cannot run guard'
elif ! "$LDCONFIG_BIN" -p 2>/dev/null | grep -q 'libgtk-3\.so\.0'; then
    echo 'SKIP: libgtk-3.so.0 not in ldconfig cache; cannot run guard'
elif grep -Eq 'Missing:.*libgtk-3\.so\.0' /workspace/logs-output/wdio-run.log; then
    echo 'FAIL: libgtk-3.so.0 is installed but the diagnostic reported it missing'
    TEST_EXIT=1
else
    echo 'OK: installed libgtk-3.so.0 was not falsely reported missing'
fi

echo '=== Copying logs to mounted volume ==='
# Absolute path: CWD is the app dir at this point, so a repo-relative
# path would double-nest and silently copy nothing.
cp -r /workspace/fixtures/package-tests/tauri-app/logs-* /workspace/logs-output/ 2>/dev/null || echo 'No logs to copy'

# Clean up Xvfb if it was started
if [ -n "$XVFB_PID" ]; then
    kill $XVFB_PID 2>/dev/null || true
fi

exit $TEST_EXIT
