// Testbed (#306): pre-warm the @electron/get cache (~/.cache/electron) that
// electron-forge's @electron/packager uses to acquire the Electron binary at
// package time. On cold CI runners `electron-forge package` bails at "Copying
// files" without writing a binary, and listr2 (CI renderer) swallows the
// @electron/get error — so we invoke the download directly here to surface any
// failure unmediated and warm the cache before the isolated package tests run.
//
// Uses @electron/get@3.1.0 (the same version @electron/packager@18.4.4 bundles),
// so the cache it writes is the one forge's packager reads.
const { readFileSync } = require('node:fs');
const { downloadArtifact } = require('@electron/get');

const fixturePkg = JSON.parse(readFileSync('fixtures/package-tests/electron-forge-app-cjs/package.json', 'utf8'));
const version = process.env.ELECTRON_PREWARM_VERSION || fixturePkg.devDependencies.electron;

console.log(`[prewarm] electron@${version} for ${process.platform}/${process.arch} via @electron/get`);

downloadArtifact({ version, artifactName: 'electron', platform: process.platform, arch: process.arch })
  .then((zipPath) => {
    console.log(`[prewarm] OK -> ${zipPath}`);
  })
  .catch((err) => {
    console.error('[prewarm] FAILED:', err);
    process.exit(1);
  });
