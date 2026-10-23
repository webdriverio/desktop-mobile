interface DriverPackage {
  name: string;
  distros: string;
}

interface PackageManagerInstall {
  command: string;
  packages: [DriverPackage, ...DriverPackage[]];
}

// Where releases name the package differently, the newer release's comes first. There's no apk or
// yum entry, as Alpine and RHEL aren't supported.
const INSTALLS: Record<string, PackageManagerInstall> = {
  apt: {
    command: 'sudo apt-get install -y',
    packages: [
      { name: 'webkitgtk-webdriver', distros: 'Ubuntu 26.04+ and Debian 13+' },
      { name: 'webkit2gtk-driver', distros: 'older Ubuntu and Debian' },
    ],
  },
  dnf: { command: 'sudo dnf install -y', packages: [{ name: 'webkitgtk6.0', distros: 'Fedora' }] },
  pacman: { command: 'sudo pacman -S', packages: [{ name: 'webkitgtk-6.0', distros: 'Arch' }] },
  zypper: {
    command: 'sudo zypper install -y',
    packages: [
      { name: 'webkitgtk4-minibrowser', distros: 'openSUSE Tumbleweed' },
      { name: 'webkit2gtk4-minibrowser', distros: 'openSUSE Leap' },
    ],
  },
  xbps: { command: 'sudo xbps-install -y', packages: [{ name: 'libwebkit2gtk41', distros: 'Void' }] },
};

const packageList = Object.values(INSTALLS)
  .flatMap(({ packages }) => packages)
  .map(({ name, distros }) => `${name} on ${distros}`)
  .join(', ');

export const WEBKIT_WEBDRIVER_INSTALL_HINT = `Install the package that ships WebKitWebDriver (${packageList}), or put WebKitWebDriver on PATH.`;

/** The command that installs WebKitWebDriver with `packageManager`, or the general hint if it has no known package. */
export function getWebKitWebDriverInstallCommand(packageManager: string): string {
  const install = INSTALLS[packageManager];
  if (!install) {
    return WEBKIT_WEBDRIVER_INSTALL_HINT;
  }
  const [newest, ...older] = install.packages;
  const command = `${install.command} ${newest.name}`;
  if (older.length === 0) {
    return command;
  }
  const olderNames = older.map(({ name, distros }) => `${name} on ${distros}`).join(', ');
  return `${command} (${newest.distros}; ${olderNames})`;
}
