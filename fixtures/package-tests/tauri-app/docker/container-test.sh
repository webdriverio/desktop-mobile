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
PATCHED_PKG=$(node - << 'JS_EOF'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tarballs = fs.readdirSync('/tarballs').filter(f => f.endsWith('.tgz'));

for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  if (!pkg[section]) continue;
  for (const [name, ver] of Object.entries(pkg[section])) {
    if (ver !== 'workspace:*') continue;
    // Map @wdio/foo-bar -> wdio-foo-bar-*.tgz
    const base = name.replace(/^@/, '').replace('/', '-');
    const match = tarballs.find(t => t.startsWith(base + '-'));
    if (!match) { console.error('No tarball found for ' + name); process.exit(1); }
    pkg[section][name] = 'file:/tarballs/' + match;
  }
}
process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
JS_EOF
)
echo "$PATCHED_PKG" > package.json.patched
mv package.json package.json.orig
mv package.json.patched package.json

npm install --prefer-offline 2>&1

# Restore original package.json so the working tree stays clean for log uploads
mv package.json package.json.installed
mv package.json.orig package.json

echo '=== Building Tauri app ==='
# Run the build steps individually rather than via `pnpm run build`, which
# would invoke build:js -- a workspace-filtered pnpm operation that requires
# tsx + Node >=23.6 to execute @wdio/tauri-plugin's build script. The plugin
# JS is already in node_modules/@wdio/tauri-plugin from the tarball install.
# build-web.ts probes node_modules/@wdio/tauri-plugin and copies it to dist/.
node scripts/build-web.ts
npx tauri build --debug

echo '=== Running Tauri package test ==='
# Capture the exit code instead of letting set -e abort here, so the wdio
# session logs are still copied out on failure -- that is exactly when they
# are needed.
set +e
npx wdio run wdio.conf.ts
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
