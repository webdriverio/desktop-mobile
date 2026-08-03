# Common Issues

These are some common issues which others have encountered whilst using the service. For debugging tools and features, see the [Debugging guide](./debugging.md).

## Could not determine the Electron version under test

The service works out which Chromedriver to use from your app's Electron version, which it reads from the `electron` (or `electron-nightly`) dependency in the `package.json` nearest your `rootDir`. This error means it found no such dependency.

The usual cause is testing an app built elsewhere — a downloaded release artifact, or a build produced by a separate CI job — so the tests have no local Electron install even though `appBinaryPath` points at a perfectly good app.

Any one of these resolves it:

- Install `electron` as a `devDependency` in the project being tested.
- Set the `browserVersion` capability to the Electron version under test — see [Chromedriver Configuration](./configuration.md#chromedriver-configuration).
- Set `wdio:chromedriverOptions.binary` to a Chromedriver you provide.

## Could not determine the Chromium version for Electron vX

The Electron version was found, but the service could not map it to a Chromium version, so it cannot select a matching Chromedriver. Installing Electron will not help — it is already installed.

The mapping comes from `https://electronjs.org/headers/index.json`, falling back to the bundled `electron-to-chromium` data when that request fails. It comes up short when:

- the build is a **fork** whose version is not a published Electron release;
- the build is a **nightly** and the online lookup is unavailable — the bundled fallback contains no nightly versions;
- the Electron release is **newer than the bundled data** and the online lookup is unavailable.

Resolve it by pinning Chromedriver yourself:

- Set `wdio:chromedriverOptions.binary` to a Chromedriver matching your app's Chromium version.
- Or set the `browserVersion` capability to the **Chromium** version your Electron build uses. You can read that from the app itself:

  ```console
  $ ELECTRON_RUN_AS_NODE=1 /path/to/your/app -p "process.versions.chrome"
  150.0.7871.129
  ```

See [Chromedriver Configuration](./configuration.md#chromedriver-configuration) for where these belong in your config.

## CDP bridge cannot be initialized: EnableNodeCliInspectArguments fuse is disabled

This warning appears when your Electron app has the `EnableNodeCliInspectArguments` fuse explicitly disabled. The CDP (Chrome DevTools Protocol) bridge relies on the `--inspect` flag to connect to Electron's main process, so when this fuse is disabled, the service cannot provide access to the main process APIs.

#### Impact

When this fuse is disabled:
- ❌ `browser.electron.execute()` - main process API access will not work
- ❌ `browser.electron.mock()` - mocking main process APIs will not work
- ❌ Main process log capture will not work (see [Debugging - Log Capture Requirements](./debugging.md#log-capture-requirements))
- ✅ Renderer process testing continues to work normally
- ✅ Renderer process log capture continues to work (uses Puppeteer, not CDP bridge)
- ✅ Service initialization continues normally - no crashes or failures
- ✅ Clear error messages when attempting to use disabled APIs

#### Solution

Enable the fuse in your test builds. If you're disabling this fuse for production (which is good security practice), use conditional configuration:

```typescript
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

await flipFuses(require('electron'), {
  version: FuseVersion.V1,
  [FuseV1Options.EnableNodeCliInspectArguments]: process.env.BUILD_FOR_TESTS === 'true',
  // ... other fuses
});
```

Then build with the environment variable, e.g.:
```bash
BUILD_FOR_TESTS=true npm run build  # for testing
npm run build                       # for production
```

See: [Electron Fuses Documentation](https://www.electronjs.org/docs/latest/tutorial/fuses#nodecliinspect)

## DevToolsActivePort file doesn't exist

This is a Chromium error which may appear when using Docker or CI. Most of the "fixes" discussed online are based around passing different combinations of args to Chromium - you can set these via [`appArgs`](./configuration.md#appargs), though in most cases using xvfb has proven to be more effective; the service itself uses xvfb when running E2Es on Linux CI.

See this [WDIO documentation page](https://webdriver.io/docs/headless-and-xvfb) for instructions on how to set up xvfb.

**Note:** WebdriverIO 9.19.1+ is required for automatic Xvfb support via the `autoXvfb` configuration option. For legacy WDIO versions, you'll need to use external tools like `xvfb-maybe` or manually set up Xvfb.

### Failed to create session. session not created: probably user data directory is already in use, please specify a unique value for --user-data-dir argument, or don't use --user-data-dir

This is another obscure Chromium error which, despite the message, is usually not fixed by providing a unique `--user-data-dir` value. In the Electron context this usually occurs when the Electron app crashes during or shortly after initialization. WDIO / ChromeDriver attempts to reconnect, starting a new electron instance, which attempts to use the same user-data-dir path. Whilst there may be other causes, on Linux this is often fixed with xvfb.

See this [WDIO documentation page](https://webdriver.io/docs/headless-and-xvfb) for instructions on how to set up xvfb.

**Note:** WebdriverIO 9.19.1+ is required for automatic Xvfb support via the `autoXvfb` configuration option. For legacy WDIO versions, you'll need to use external tools like `xvfb-maybe` or manually set up Xvfb.

### All versions of Electron fail to open on Ubuntu 24.04+

See [this issue](https://github.com/electron/electron/issues/41066) for more details. This is caused by AppArmor restrictions on unprivileged user namespaces.

#### Recommended Solution: Automatic AppArmor Profile

The service can automatically create and install a custom AppArmor profile for your Electron binary. Enable this feature by setting the `apparmorAutoInstall` option:

```ts
export const config = {
  // ...
  services: [
    [
      'electron',
      {
        apparmorAutoInstall: 'sudo' // or true if running as root
      }
    ]
  ],
  // OR configure it per capability:
  capabilities: [
    {
      'browserName': 'electron',
      'wdio:electronServiceOptions': {
        apparmorAutoInstall: 'sudo'
      }
    }
  ]
};
```

- `'sudo'`: Install if root or via non-interactive sudo (`sudo -n`) if available
- `true`: Install only if running as root (no sudo)
- `false` (default): Never install; warn and continue without AppArmor profile

#### Alternative Solution

**Manual AppArmor workaround**: Run `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before running your tests. This command requires root privileges; if necessary, run it as the root user or use the `sudo` command.

### TypeError: logger is not a function

> Still applies in v10. The package was renamed from `wdio-electron-service` to `@wdio/electron-service`, but the import-time initialization order didn't change — the same workaround is needed.

This error occurs when importing the `browser` object directly at the top level of test files:

```typescript
// ❌ This may cause "TypeError: logger is not a function"
import { browser } from "@wdio/electron-service";

describe("My Tests", () => {
  it("should work", async () => {
    await browser.electron.execute(/* ... */);
  });
});
```

The service's internal logger and other dependencies aren't fully initialized when the browser object is imported during the test file loading phase, before WebDriverIO services have completed their initialization.

The solution is to use dynamic import within a `before` hook to ensure the service is fully initialized:

```typescript
// ✅ Correct approach - dynamic import in before hook
import type { Mock } from "@vitest/spy";
import { $, expect } from "@wdio/globals";
import type { browser as WdioBrowser } from "@wdio/electron-service";

let browser: typeof WdioBrowser;

describe("My Tests", () => {
  before(async () => {
    ({ browser } = await import("@wdio/electron-service"));
  });

  it("should work", async () => {
    await browser.electron.execute(/* ... */);
  });
});
```

**Note for Service Contributors:** If you're working within the desktop-mobile repository itself, you can use pnpm overrides to link to the workspace version:

```json
{
  "pnpm": {
    "overrides": {
      "@wdio/electron-service": "workspace:*"
    }
  }
}
```

This allows direct imports to work reliably within the service's own repository, but this approach only applies when developing the service itself.
