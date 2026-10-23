import { describe, expect, it } from 'vitest';
import { getWebKitWebDriverInstallCommand, WEBKIT_WEBDRIVER_INSTALL_HINT } from '../src/webkitWebDriver.js';

describe('getWebKitWebDriverInstallCommand', () => {
  it('should name both apt packages without chaining a fallback install', () => {
    expect(getWebKitWebDriverInstallCommand('apt')).toBe(
      'sudo apt-get install -y webkitgtk-webdriver (Ubuntu 26.04+ and Debian 13+; webkit2gtk-driver on older Ubuntu and Debian)',
    );
  });

  it('should name both zypper packages without chaining a fallback install', () => {
    expect(getWebKitWebDriverInstallCommand('zypper')).toBe(
      'sudo zypper install -y webkitgtk4-minibrowser (openSUSE Tumbleweed; webkit2gtk4-minibrowser on openSUSE Leap)',
    );
  });

  it.each([
    ['dnf', 'sudo dnf install -y webkitgtk6.0'],
    ['pacman', 'sudo pacman -S webkitgtk-6.0'],
    ['xbps', 'sudo xbps-install -y libwebkit2gtk41'],
  ])('should give the single %s package', (packageManager, command) => {
    expect(getWebKitWebDriverInstallCommand(packageManager)).toBe(command);
  });

  it.each(['yum', 'apk', 'unknown'])('should give the general hint for %s, which has no known package', (manager) => {
    expect(getWebKitWebDriverInstallCommand(manager)).toBe(WEBKIT_WEBDRIVER_INSTALL_HINT);
  });
});

describe('WEBKIT_WEBDRIVER_INSTALL_HINT', () => {
  it('should name every known package with its distro, and the PATH alternative', () => {
    expect(WEBKIT_WEBDRIVER_INSTALL_HINT).toBe(
      'Install the package that ships WebKitWebDriver (webkitgtk-webdriver on Ubuntu 26.04+ and Debian 13+, ' +
        'webkit2gtk-driver on older Ubuntu and Debian, webkitgtk6.0 on Fedora, webkitgtk-6.0 on Arch, ' +
        'webkitgtk4-minibrowser on openSUSE Tumbleweed, webkit2gtk4-minibrowser on openSUSE Leap, ' +
        'libwebkit2gtk41 on Void), or put WebKitWebDriver on PATH.',
    );
  });
});
