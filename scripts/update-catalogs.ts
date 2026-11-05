#!/usr/bin/env node

import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkbox, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'yaml';

const execAsync = promisify(exec);

type UpdateType = 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';

interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  isUpToDate: boolean;
  updateType: UpdateType;
}

interface WorkspaceConfig {
  packages: string[];
  minimumReleaseAge?: number;
  catalogs: {
    [key: string]: {
      [key: string]: string;
    };
  };
}

// pnpm's built-in `minimumReleaseAge`, in minutes, for a workspace that doesn't set one.
const DEFAULT_MINIMUM_RELEASE_AGE_MINUTES = 1440;

// Check if dry run mode is enabled
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');

// Check for shortcut catalog selection
const shortcutCatalog = process.argv
  .find((arg) => ['--default', '--next', '--minimum'].includes(arg))
  ?.replace('--', '');

async function readWorkspaceYaml(): Promise<WorkspaceConfig> {
  const workspaceYamlPath = path.join(process.cwd(), 'pnpm-workspace.yaml');
  const yamlContent = await fs.readFile(workspaceYamlPath, 'utf8');
  return yaml.parse(yamlContent);
}

/**
 * Determine the type of update between two semantic versions
 */
export function getUpdateType(currentVersion: string, latestVersion: string): UpdateType {
  if (currentVersion === 'unknown' || latestVersion === 'unknown') {
    return 'unknown';
  }

  // Handle non-semver versions
  if (!currentVersion.match(/^\d+\.\d+\.\d+/) || !latestVersion.match(/^\d+\.\d+\.\d+/)) {
    return 'unknown';
  }

  const current = splitVersion(currentVersion).core;
  const latest = splitVersion(latestVersion).core;

  if (latest[0] > current[0]) {
    return 'major';
  } else if (latest[0] === current[0] && latest[1] > current[1]) {
    return 'minor';
  } else if (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2]) {
    return 'patch';
  } else if (latest.every((part, i) => part === current[i]) && compareVersions(latestVersion, currentVersion) > 0) {
    return 'prerelease';
  }

  return 'unknown';
}

/**
 * Get chalk color for update type
 */
function getUpdateColor(updateType: UpdateType): (text: string) => string {
  switch (updateType) {
    case 'prerelease':
      return chalk.cyan;
    case 'patch':
      return chalk.green;
    case 'minor':
      return chalk.yellow;
    case 'major':
      return chalk.red;
    default:
      return chalk.gray;
  }
}

/**
 * Check if a version string is a non-semver tag
 */
function isNonSemverTag(version: string): boolean {
  return ['latest', 'next', 'beta', 'alpha', 'nightly'].includes(version.toLowerCase());
}

const isWdioPackage = (name: string) => name === 'webdriverio' || name.startsWith('@wdio/');

function splitVersion(version: string): { core: number[]; prerelease?: string } {
  const [withoutBuild] = version.split('+');
  const dash = withoutBuild.indexOf('-');
  const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split('.').map(Number);
  return dash === -1 ? { core } : { core, prerelease: withoutBuild.slice(dash + 1) };
}

export function compareVersions(a: string, b: string): number {
  const left = splitVersion(a);
  const right = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  if (left.prerelease === undefined || right.prerelease === undefined) {
    return (left.prerelease === undefined ? 1 : 0) - (right.prerelease === undefined ? 1 : 0);
  }
  const leftIds = left.prerelease.split('.');
  const rightIds = right.prerelease.split('.');
  for (let i = 0; i < Math.max(leftIds.length, rightIds.length); i++) {
    const [x, y] = [leftIds[i], rightIds[i]];
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const [xNumeric, yNumeric] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xNumeric && yNumeric && Number(x) !== Number(y)) {
      return Number(x) - Number(y);
    }
    if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    }
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

interface Packument {
  'dist-tags'?: Record<string, string>;
  time?: Record<string, string>;
  versions?: string[];
}

// A package's upcoming release is the newer of its `next` and `latest` tags, as WebdriverIO's `next` stays on its last
// prerelease after a stable release. This takes the newest version up to that one that's old enough for pnpm's
// `minimumReleaseAge`, as pnpm would install a younger one only by adding it to `minimumReleaseAgeExclude`. It never
// goes below `current`.
export function pickNextCatalogVersion(
  packument: Packument,
  current: string,
  now: number,
  minimumReleaseAgeMinutes: number,
): string {
  const tags = packument['dist-tags'] ?? {};
  const upcoming = [tags.next, tags.latest]
    .filter((version): version is string => typeof version === 'string')
    .sort(compareVersions)
    .at(-1);
  const newestAllowed = now - minimumReleaseAgeMinutes * 60_000;
  const candidates =
    upcoming === undefined
      ? []
      : (packument.versions ?? []).filter(
          (version) =>
            compareVersions(version, upcoming) <= 0 && Date.parse(packument.time?.[version] ?? '') <= newestAllowed,
        );
  if (!isNonSemverTag(current)) {
    candidates.push(current);
  }
  return candidates.sort(compareVersions).at(-1) ?? current;
}

// Sets catalog versions in pnpm-workspace.yaml's content, leaving the rest of the file as it is.
export function setCatalogVersions(content: string, catalog: string, versions: Record<string, string>): string {
  const document = yaml.parseDocument(content);
  for (const [name, version] of Object.entries(versions)) {
    document.setIn(['catalogs', catalog, name], version);
  }
  return document.toString({ lineWidth: 0 });
}

async function getLatestVersions(
  packages: Record<string, string>,
  catalog: string,
  minimumReleaseAgeMinutes: number,
): Promise<PackageInfo[]> {
  console.log(chalk.blue('Fetching latest versions for packages...'));

  const packageInfos: PackageInfo[] = [];
  const spinner = ora('').start();
  const now = Date.now();

  for (const [name, currentVersion] of Object.entries(packages)) {
    const cleanVersion = currentVersion.replace(/^[\^~]/, '');
    spinner.text = `Checking ${chalk.cyan(name)}`;

    try {
      if (catalog === 'next' && !isNonSemverTag(cleanVersion)) {
        const { stdout } = await execAsync(`pnpm view ${name} dist-tags time versions --json`);
        const target = pickNextCatalogVersion(JSON.parse(stdout), cleanVersion, now, minimumReleaseAgeMinutes);
        packageInfos.push({
          name,
          currentVersion: cleanVersion,
          latestVersion: target,
          isUpToDate: cleanVersion === target,
          updateType: getUpdateType(cleanVersion, target),
        });
        continue;
      }

      // Skip non-semver tags
      if (isNonSemverTag(currentVersion)) {
        console.log(chalk.dim(`  Skipping ${name}: using non-semver tag "${currentVersion}"`));
        packageInfos.push({
          name,
          currentVersion,
          latestVersion: currentVersion,
          isUpToDate: true,
          updateType: 'unknown',
        });
        continue;
      }

      // Use pnpm view to get the latest version
      const { stdout } = await execAsync(`pnpm view ${name} version`);
      const latestVersion = stdout.trim();
      const updateType = getUpdateType(cleanVersion, latestVersion);

      packageInfos.push({
        name,
        currentVersion: cleanVersion,
        latestVersion,
        isUpToDate: cleanVersion === latestVersion,
        updateType,
      });
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Error fetching version for ${name}:`, error));
      spinner.start();

      packageInfos.push({
        name,
        currentVersion: cleanVersion,
        latestVersion: 'unknown',
        isUpToDate: true, // Mark as up-to-date to exclude from selection
        updateType: 'unknown',
      });
    }
  }

  if (catalog === 'next') {
    moveWdioPackagesTogether(packageInfos);
  }

  spinner.succeed('Finished checking all packages');
  return packageInfos;
}

// WebdriverIO's packages pin each other exactly, so the ones on webdriverio's version move to the lowest version any of
// them resolved: one that all of them have published, old enough for each.
export function moveWdioPackagesTogether(packageInfos: PackageInfo[]): void {
  const wdioVersion = packageInfos.find((pkg) => pkg.name === 'webdriverio')?.currentVersion;
  const shared = packageInfos.filter(
    (pkg) => isWdioPackage(pkg.name) && pkg.currentVersion === wdioVersion && pkg.latestVersion !== 'unknown',
  );
  const target = shared
    .map((pkg) => pkg.latestVersion)
    .sort(compareVersions)
    .at(0);
  if (target === undefined) {
    return;
  }
  for (const pkg of shared) {
    pkg.latestVersion = target;
    pkg.isUpToDate = pkg.currentVersion === target;
    pkg.updateType = getUpdateType(pkg.currentVersion, target);
  }
}

async function promptPackagesToUpdate(packageInfos: PackageInfo[], catalog: string): Promise<string[]> {
  const outdatedPackages = packageInfos.filter((pkg) => !pkg.isUpToDate);

  if (outdatedPackages.length === 0) {
    console.log(chalk.green('All packages are up to date!'));
    return [];
  }

  outdatedPackages.sort((a, b) => {
    const priority = { major: 0, minor: 1, patch: 2, prerelease: 3, unknown: 4 };
    return priority[a.updateType] - priority[b.updateType];
  });

  // Count updates by type
  const updateCounts = outdatedPackages.reduce(
    (acc, pkg) => {
      if (pkg.updateType !== 'unknown') {
        acc[pkg.updateType]++;
      }
      return acc;
    },
    { major: 0, minor: 0, patch: 0, prerelease: 0 },
  );

  console.log(chalk.yellow(`Found ${outdatedPackages.length} outdated packages:`));
  console.log(
    `  ${chalk.red(`${updateCounts.major} major`)} | ` +
      `${chalk.yellow(`${updateCounts.minor} minor`)} | ` +
      `${chalk.green(`${updateCounts.patch} patch`)} | ` +
      `${chalk.cyan(`${updateCounts.prerelease} prerelease`)}`,
  );

  const choices = outdatedPackages.map((pkg) => {
    const updateColor = getUpdateColor(pkg.updateType);
    const updateBadge = pkg.updateType !== 'unknown' ? ` [${updateColor(pkg.updateType)}]` : '';

    return {
      value: pkg.name,
      name: `${pkg.name}${updateBadge}: ${chalk.dim(pkg.currentVersion)} → ${updateColor(pkg.latestVersion)}`,
      // The next catalog tracks its upstreams, and WebdriverIO's packages must move together
      checked: catalog === 'next' || pkg.updateType === 'patch',
    };
  });

  return await checkbox({
    message: 'Select packages to update:',
    choices,
  });
}

async function updateWorkspaceYaml(
  workspaceYaml: WorkspaceConfig,
  packageInfos: PackageInfo[],
  packagesToUpdate: string[],
  selectedCatalog: string,
): Promise<void> {
  const catalog = workspaceYaml.catalogs[selectedCatalog];
  const updates: Record<string, string> = {};
  for (const packageName of packagesToUpdate) {
    const pkg = packageInfos.find((p) => p.name === packageName);
    if (!pkg) {
      continue;
    }
    const current = catalog[packageName];
    const prefix = current.startsWith('^') ? '^' : current.startsWith('~') ? '~' : '';
    updates[packageName] = `${prefix}${pkg.latestVersion}`;
  }

  if (isDryRun) {
    console.log(chalk.yellow('DRY RUN: The following changes would be made to pnpm-workspace.yaml:'));
    console.log();
    for (const [packageName, version] of Object.entries(updates)) {
      const updateType = packageInfos.find((p) => p.name === packageName)?.updateType ?? 'unknown';
      const updateColor = getUpdateColor(updateType);
      const updateBadge = updateType !== 'unknown' ? ` [${updateColor(updateType)}]` : '';
      console.log(`  ${packageName}${updateBadge}: ${chalk.dim(catalog[packageName])} → ${updateColor(version)}`);
    }
    console.log();
    return;
  }

  const spinner = ora('Updating workspace configuration...').start();
  const workspaceYamlPath = path.join(process.cwd(), 'pnpm-workspace.yaml');
  const originalContent = await fs.readFile(workspaceYamlPath, 'utf8');
  await fs.writeFile(workspaceYamlPath, setCatalogVersions(originalContent, selectedCatalog, updates));
  spinner.succeed('Updated pnpm-workspace.yaml with new versions.');
}

async function runPnpmInstall(): Promise<void> {
  if (isDryRun) {
    console.log(chalk.yellow('DRY RUN: Would run "pnpm install" to update dependencies'));
    return;
  }

  const spinner = ora('Installing dependencies...').start();

  try {
    const { stdout, stderr } = await execAsync('pnpm install');
    spinner.succeed('Dependencies updated successfully!');

    if (stdout.trim()) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    spinner.fail('Error updating dependencies');
    console.error(chalk.red('Error details:'), error);
    process.exit(1);
  }
}

async function selectCatalog(catalogs: Record<string, Record<string, string>>): Promise<string> {
  // If a shortcut was provided, use it
  if (shortcutCatalog) {
    if (!catalogs[shortcutCatalog]) {
      console.error(
        chalk.red(
          `Error: Invalid catalog "${shortcutCatalog}". Valid catalogs are: ${Object.keys(catalogs).join(', ')}`,
        ),
      );
      process.exit(1);
    }
    return shortcutCatalog;
  }

  // Otherwise, prompt for selection
  const choices = Object.keys(catalogs).map((catalog) => ({
    value: catalog,
    name: catalog,
  }));

  return await select({
    message: 'Select catalog to update:',
    choices,
  });
}

async function main() {
  try {
    if (isDryRun) {
      console.log(chalk.yellow('Running in dry run mode. No changes will be made.'));
    }

    // Read the workspace YAML file
    const workspaceYaml = await readWorkspaceYaml();

    // Select which catalog to update
    const selectedCatalog = await selectCatalog(workspaceYaml.catalogs);

    // Get the latest versions for all packages in the selected catalog
    const packageInfos = await getLatestVersions(
      workspaceYaml.catalogs[selectedCatalog],
      selectedCatalog,
      workspaceYaml.minimumReleaseAge ?? DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
    );

    // Prompt the user to select packages to update
    const packagesToUpdate = await promptPackagesToUpdate(packageInfos, selectedCatalog);

    if (packagesToUpdate.length === 0) {
      console.log(chalk.yellow('No packages selected for update.'));
      return;
    }

    // Count updates by type
    const updateCounts = packagesToUpdate.reduce(
      (acc, packageName) => {
        const pkg = packageInfos.find((p) => p.name === packageName);
        if (pkg && pkg.updateType !== 'unknown') {
          acc[pkg.updateType]++;
        }
        return acc;
      },
      { major: 0, minor: 0, patch: 0, prerelease: 0 },
    );

    // Confirm the selection with update type counts
    const updateSummary =
      `${chalk.red(`${updateCounts.major} major`)}, ` +
      `${chalk.yellow(`${updateCounts.minor} minor`)}, ` +
      `${chalk.green(`${updateCounts.patch} patch`)}, ` +
      `${chalk.cyan(`${updateCounts.prerelease} prerelease`)}`;

    const confirmMessage = isDryRun
      ? `Preview updates for ${packagesToUpdate.length} packages in ${chalk.cyan(selectedCatalog)} catalog (${updateSummary})?`
      : `Update ${packagesToUpdate.length} packages in ${chalk.cyan(selectedCatalog)} catalog (${updateSummary})?`;

    const shouldProceed = await confirm({
      message: confirmMessage,
      default: true,
    });

    if (!shouldProceed) {
      console.log(chalk.yellow('Update cancelled.'));
      return;
    }

    // Update the workspace YAML file with the new versions
    await updateWorkspaceYaml(workspaceYaml, packageInfos, packagesToUpdate, selectedCatalog);

    // Run pnpm install to apply the updates
    await runPnpmInstall();

    if (isDryRun) {
      console.log(chalk.green('Dry run completed. Run without --dry-run to apply changes.'));
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
