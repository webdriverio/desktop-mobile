import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const icon = path.join(__dirname, 'src', 'assets', 'icon', 'webdriverio');

const config = {
  packagerConfig: {
    ignore: /node_modules/,
    asar: true,
    icon,
    osxSign: false,
    // Skip electron-packager's native-dependency prune (flora-colossus) — it can't traverse
    // pnpm's symlinked workspace store and intermittently fails packaging in CI. A larger
    // package is fine for a fixture that only needs to launch.
    prune: false,
  },
  rebuildConfig: {},
  makers: [],
  plugins: [],
};

export default config;
