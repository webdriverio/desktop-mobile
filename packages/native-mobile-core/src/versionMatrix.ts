// Known-good Appium server↔driver version matrix (the chromedriver-vs-Chrome analog).
//
// Appium drivers pin to the Appium *server* major, so `ensureAppiumDriver` installs the
// matrix-specified driver version for the detected server major rather than letting npm
// resolution drift. Keep these ranges in sync with `e2e/package.json` — a unit test
// guards the drift. Add a new row (not a new range on an existing row) when supporting a
// new Appium major.

export interface DriverSpec {
  /** Appium driver short-name (the registry key + automationName lineage), e.g. `'uiautomator2'`. */
  name: string;
  /** npm package the driver ships as, e.g. `'appium-uiautomator2-driver'`. */
  source: string;
  /** Known-good version range for the owning Appium server major (an npm-installable spec). */
  version: string;
}

export interface AppiumCompat {
  /** Appium server major this row applies to. */
  appiumMajor: number;
  /** Drivers keyed by short-name. */
  drivers: Record<string, DriverSpec>;
}

export const APPIUM_MATRIX: AppiumCompat[] = [
  {
    appiumMajor: 3,
    drivers: {
      uiautomator2: { name: 'uiautomator2', source: 'appium-uiautomator2-driver', version: '^8.2.2' },
      xcuitest: { name: 'xcuitest', source: 'appium-xcuitest-driver', version: '^11.17.1' },
      flutter: { name: 'flutter', source: 'appium-flutter-driver', version: '^3.9.1' },
    },
  },
];

/** Resolve the known-good {@link DriverSpec} for a driver short-name under an Appium server major. */
export function driverSpecFor(name: string, appiumMajor: number): DriverSpec | undefined {
  return APPIUM_MATRIX.find((row) => row.appiumMajor === appiumMajor)?.drivers[name];
}

/** The Appium server majors the matrix knows about (for clear error messages). */
export function supportedAppiumMajors(): number[] {
  return APPIUM_MATRIX.map((row) => row.appiumMajor);
}
