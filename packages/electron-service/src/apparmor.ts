import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { ElectronServiceGlobalOptions } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('electron-service', 'launcher');

/**
 * Checks if AppArmor is active and the unprivileged user namespace restriction is enabled
 * This is the condition that causes Electron to fail on Ubuntu 24.04+
 */
function isApparmorRestricted(): boolean {
  try {
    let isApparmorRunning = false;

    // Method 1: Try aa-status first (best practice when available)
    try {
      const apparmorStatus = spawnSync('aa-status', { encoding: 'utf8' });
      if (apparmorStatus.status === 0 || apparmorStatus.status === 4) {
        // Exit code 4 means AppArmor is present but we lack privileges
        isApparmorRunning = true;
      }
    } catch {
      // aa-status not available, fall through to filesystem check
    }

    // Method 2: Fallback to filesystem check if aa-status wasn't conclusive
    if (!isApparmorRunning) {
      const apparmorProfilesPath = '/sys/kernel/security/apparmor/profiles';

      if (fs.existsSync(apparmorProfilesPath)) {
        try {
          const profiles = fs.readFileSync(apparmorProfilesPath, 'utf8').trim();
          isApparmorRunning = profiles.length > 0;
        } catch {
          isApparmorRunning = true; // Assume running if we can't read (permission issue)
        }
      }
    }

    if (!isApparmorRunning) {
      return false;
    }

    // Check the specific kernel restriction that breaks Electron
    const restrictionPath = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';

    if (!fs.existsSync(restrictionPath)) {
      log.debug('AppArmor active but restriction file missing — applying workaround as precaution');
      return true; // Apply workaround when AppArmor is active but we can't check the specific restriction
    }

    const restriction = fs.readFileSync(restrictionPath, 'utf8').trim();
    return restriction === '1';
  } catch (error) {
    log.debug(
      `AppArmor restriction check errored, applying workaround: ${error instanceof Error ? error.message : String(error)}`,
    );
    return true;
  }
}

/**
 * Checks if we can run sudo non-interactively
 */
function canUseSudo(): boolean {
  try {
    // Test if sudo -n (non-interactive) works
    const result = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' });
    return result.status === 0;
  } catch (error) {
    log.debug(`sudo check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Checks if we're running as root
 */
function isRoot(): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && uid === 0;
}

/**
 * Creates a custom AppArmor profile for Electron applications
 * This is a safer alternative to disabling the kernel restriction entirely
 */
function createElectronApparmorProfile(
  electronBinaryPaths: string[],
  installMode: ElectronServiceGlobalOptions['apparmorAutoInstall'],
): boolean {
  log.debug(
    `Starting AppArmor profile creation for ${electronBinaryPaths.length} binaries: ${electronBinaryPaths.join(', ')}`,
  );
  try {
    const profileName = 'electron-wdio-service';
    const profilePath = `/etc/apparmor.d/${profileName}`;
    log.debug(`Profile name: ${profileName}`);
    log.debug(`Profile path: ${profilePath}`);

    // Create individual profiles for each Electron binary using Ubuntu's recommended approach
    const profiles = electronBinaryPaths.map((binaryPath) => {
      const binaryName = binaryPath.split('/').pop() || 'electron';
      return `# AppArmor profile for Electron binary: ${binaryPath}
# This profile allows unprivileged user namespaces for Electron on Ubuntu 24.04+
abi <abi/4.0>,
include <tunables/global>

profile ${binaryName}-${profileName} "${binaryPath}" flags=(unconfined) {
  userns,
  
  # Site-specific additions and overrides
  include if exists <local/${binaryName}-${profileName}>
}`;
    });

    const profileContent = profiles.join('\n\n');

    // Determine if we should proceed based on install mode and permissions
    const hasRootAccess = isRoot();
    const hasSudoAccess = installMode === 'sudo' && canUseSudo();
    const shouldProceed =
      installMode === true ? hasRootAccess : installMode === 'sudo' ? hasRootAccess || hasSudoAccess : false;

    if (!shouldProceed) {
      if (installMode === true && !hasRootAccess) {
        log.debug('AppArmor auto-install enabled but not running as root (apparmorAutoInstall: true)');
      } else if (installMode === 'sudo' && !hasRootAccess && !hasSudoAccess) {
        log.debug('AppArmor auto-install with sudo enabled but sudo not available (apparmorAutoInstall: "sudo")');
      }
      return false;
    }

    // Check if we can write to /etc/apparmor.d (requires root or sudo)
    log.debug('Checking write permissions for /etc/apparmor.d directory');
    const needsSudo = !hasRootAccess && hasSudoAccess;

    // Write the profile (using sudo if needed)
    log.debug(`Writing AppArmor profile content to file system${needsSudo ? ' using sudo' : ''}`);
    if (needsSudo) {
      // Use sudo to write the file
      execSync(`sudo tee ${profilePath} > /dev/null`, { input: profileContent, encoding: 'utf8' });
    } else {
      fs.writeFileSync(profilePath, profileContent);
    }
    log.debug(`AppArmor profile file created at ${profilePath}`);

    // Load the profile (using sudo if needed)
    log.debug('Loading AppArmor profile using apparmor_parser');
    const parserCommand = needsSudo ? `sudo apparmor_parser -r ${profilePath}` : `apparmor_parser -r ${profilePath}`;
    log.debug(`Running command: ${parserCommand}`);
    execSync(parserCommand, { encoding: 'utf8' });
    log.info('Successfully created and loaded custom AppArmor profile for Electron');
    log.debug('AppArmor profile creation completed successfully');

    return true;
  } catch (error) {
    log.error(`Failed to create AppArmor profile: ${error instanceof Error ? error.message : String(error)}`);
    log.debug('AppArmor profile creation failed, falling back to manual workaround suggestion');
    return false;
  }
}

/**
 * Applies the AppArmor workaround for Ubuntu 24.04+ Electron issues
 * This should be called once per session with all discovered Electron binaries
 *
 * Compatible with:
 * - Ubuntu 24.04+ (primary target)
 * - openSUSE with AppArmor enabled
 * - Other AppArmor-enabled Linux distributions
 *
 * Safe on:
 * - Non-Linux platforms (no-op)
 * - Linux without AppArmor (RHEL, Fedora, Arch, etc.)
 * - Systems where AppArmor restriction is already disabled
 * - CI environments (respects apparmorAutoInstall configuration)
 */
export function applyApparmorWorkaround(
  electronBinaryPaths: string[],
  installMode: ElectronServiceGlobalOptions['apparmorAutoInstall'] = false,
): void {
  log.debug(
    `AppArmor workaround check: platform=${process.platform}, installMode=${installMode}, binaries=${electronBinaryPaths.join(', ')}`,
  );

  // Only apply on Linux
  if (process.platform !== 'linux') {
    return;
  }

  // Skip if auto-install is disabled
  if (installMode === false) {
    log.debug('AppArmor auto-install disabled, skipping workaround');
    return;
  }

  // Check if AppArmor restriction is active
  if (!isApparmorRestricted()) {
    log.debug('AppArmor restriction not active, no workaround needed');
    return;
  }

  log.info('Detected AppArmor unprivileged user namespace restriction (Ubuntu 24.04+ issue). Applying workaround...');

  // Try to create custom AppArmor profile
  const profileCreated = createElectronApparmorProfile(electronBinaryPaths, installMode);

  if (!profileCreated) {
    // Fall back to suggesting the kernel workaround
    log.warn(`
AppArmor restriction detected but could not create custom profile.
This may cause Electron to fail to start on Ubuntu 24.04+ and similar systems.

To fix this issue manually, run one of the following commands:

1. Disable the restriction temporarily:
   sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

2. Or disable it permanently:
   echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee -a /etc/sysctl.conf

See: https://github.com/electron/electron/issues/41066
    `);
  } else {
    log.debug('AppArmor profile created successfully, workaround applied');
  }
}
