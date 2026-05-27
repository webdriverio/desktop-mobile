#!/usr/bin/env node

/**
 * Script to switch catalog dependencies for all packages in the workspace
 * Usage: pnpx tsx scripts/switch-catalog.ts [default|next|minimum]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const workspaceFile = path.join(rootDir, 'pnpm-workspace.yaml');

// Valid catalog names
const VALID_CATALOGS = ['default', 'next', 'minimum'] as const;
type CatalogName = (typeof VALID_CATALOGS)[number];

// Function to sort dependencies alphabetically
function sortDependencies(deps: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!deps) return undefined;
  return Object.keys(deps)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = deps[key];
        return acc;
      },
      {} as Record<string, string>,
    );
}

// Read workspace YAML to get catalog dependencies and package paths
const workspaceContent = fs.readFileSync(workspaceFile, 'utf8');
const workspaceLines = workspaceContent.split('\n');
let inCatalogs = false;
let inPackages = false;
let currentCatalogName: string | null = null;
// Map: catalog name (e.g. "default") -> Set of dep names declared in that catalog.
// Used so the switch loop can detect deps that exist in `default` but not in the
// target catalog and fall back to `catalog:default` rather than write a broken
// `catalog:<missing>` ref.
const CATALOGS = new Map<string, Set<string>>();
const WORKSPACE_PACKAGES = new Set<string>();

for (const line of workspaceLines) {
  const trimmedLine = line.trim();

  if (trimmedLine === 'packages:') {
    inPackages = true;
    inCatalogs = false;
    continue;
  }

  if (trimmedLine === 'catalogs:') {
    inCatalogs = true;
    inPackages = false;
    continue;
  }

  if (inPackages && line.startsWith('  - ')) {
    const packagePath = line
      .trim()
      .replace(/^-\s*/, '')
      .replace(/^['"]|['"]$/g, '');
    WORKSPACE_PACKAGES.add(packagePath);
    continue;
  }

  // A catalog header line: 2-space indent, no further indent, ends with ":".
  // e.g. "  default:", "  minimum:", "  next:".
  if (inCatalogs && line.startsWith('  ') && !line.startsWith('    ')) {
    const headerMatch = trimmedLine.match(/^([^:]+):$/);
    if (headerMatch) {
      currentCatalogName = headerMatch[1];
      CATALOGS.set(currentCatalogName, new Set());
    }
    continue;
  }

  if (inCatalogs && currentCatalogName && line.startsWith('    ')) {
    const [packagePart] = line.split(':').map((part) => part.trim());
    if (packagePart && !packagePart.startsWith('#')) {
      const cleanPackageName = packagePart.replace(/^['"]|['"]$/g, '');
      CATALOGS.get(currentCatalogName)?.add(cleanPackageName);
    }
  }
}

const CATALOG_DEPENDENCIES = CATALOGS.get('default') ?? new Set<string>();

// Only handles "dir/*" trailing-glob; the workspace doesn't use anything fancier.
function expandWorkspacePath(entry: string): string[] {
  if (!entry.endsWith('/*')) return [entry];
  const parent = entry.slice(0, -2);
  const parentAbs = path.join(rootDir, parent);
  if (!fs.existsSync(parentAbs)) return [];
  return fs
    .readdirSync(parentAbs, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => `${parent}/${dirent.name}`);
}

const EXPANDED_PACKAGES = new Set<string>();
for (const entry of WORKSPACE_PACKAGES) {
  for (const expanded of expandWorkspacePath(entry)) {
    EXPANDED_PACKAGES.add(expanded);
  }
}

// Convert Sets to arrays and sort for consistent ordering
const CATALOG_DEPENDENCIES_ARRAY = Array.from(CATALOG_DEPENDENCIES).sort();
const WORKSPACE_PACKAGES_ARRAY = Array.from(EXPANDED_PACKAGES).sort();

// Handle CLI arguments
const catalogName = process.argv[2]?.toLowerCase() as CatalogName | undefined;

if (!catalogName || !VALID_CATALOGS.includes(catalogName)) {
  console.error(`Error: Please specify a valid catalog: ${VALID_CATALOGS.join(', ')}`);
  process.exit(1);
}

// Resolve the catalog ref a dep should use under the target catalog. If the
// target catalog contains the dep, use it directly. Otherwise fall back to
// `catalog:default` so deps that exist only in default (e.g. @wdio/xvfb, which
// is v9-only and has no v8 to put in the `minimum` catalog) don't produce a
// broken `catalog:<missing>` ref. The next predictable case for this is the
// `@wdio/xvfb` → `@wdio/display-server` rename in WDIO v10.
function resolveCatalogRef(dep: string, target: CatalogName): string {
  const targetDeps = CATALOGS.get(target);
  if (targetDeps?.has(dep)) return `catalog:${target}`;
  return 'catalog:default';
}

try {
  console.log(`Switching all packages to '${catalogName}' catalog...\n`);

  // Process each package's package.json
  for (const packagePath of WORKSPACE_PACKAGES_ARRAY) {
    // Skip fixture packages - they should use specific versions, not catalog references
    // this is to ensure they work reliably in isolated test environments without needing access to the catalog system
    if (packagePath.startsWith('fixtures/')) {
      console.log(`- Skipping ${packagePath} (fixture package)`);
      continue;
    }

    const packageJsonPath = path.join(rootDir, packagePath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      const isRustOnlyPackage = fs.existsSync(path.join(rootDir, packagePath, 'Cargo.toml'));
      if (!isRustOnlyPackage) {
        console.warn(`Warning: No package.json found in ${packagePath}`);
      }
      continue;
    }

    // Read and parse the package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    let changed = false;

    // Handle specific catalog transitions for both devDependencies and dependencies
    for (const dep of CATALOG_DEPENDENCIES_ARRAY) {
      // Check devDependencies
      if (packageJson.devDependencies?.[dep]) {
        // Special handling for next catalog - use electron-nightly instead of electron
        if (catalogName === 'next' && dep === 'electron') {
          // Remove electron and add electron-nightly instead
          delete packageJson.devDependencies[dep];
          packageJson.devDependencies['electron-nightly'] = `catalog:${catalogName}`;
          console.log(`  Replaced electron with electron-nightly in ${packagePath}`);
        } else {
          packageJson.devDependencies[dep] = resolveCatalogRef(dep, catalogName);
        }
        changed = true;
      }

      // Check dependencies
      if (packageJson.dependencies?.[dep]) {
        // Special handling for next catalog - use electron-nightly instead of electron
        if (catalogName === 'next' && dep === 'electron') {
          // Remove electron and add electron-nightly instead
          delete packageJson.dependencies[dep];
          packageJson.dependencies['electron-nightly'] = `catalog:${catalogName}`;
          console.log(`  Replaced electron with electron-nightly in ${packagePath}`);
        } else {
          packageJson.dependencies[dep] = resolveCatalogRef(dep, catalogName);
        }
        changed = true;
      }
    }

    // Handle switching from next catalog to other catalogs
    if (catalogName !== 'next') {
      // Check devDependencies
      if (packageJson.devDependencies?.['electron-nightly']) {
        // When switching from next to any other catalog, remove electron-nightly and add electron
        delete packageJson.devDependencies['electron-nightly'];
        packageJson.devDependencies.electron = `catalog:${catalogName}`;
        console.log(`  Replaced electron-nightly with electron in ${packagePath}`);
        changed = true;
      }

      // Check dependencies
      if (packageJson.dependencies?.['electron-nightly']) {
        // When switching from next to any other catalog, remove electron-nightly and add electron
        delete packageJson.dependencies['electron-nightly'];
        packageJson.dependencies.electron = `catalog:${catalogName}`;
        console.log(`  Replaced electron-nightly with electron in ${packagePath}`);
        changed = true;
      }
    }

    if (changed) {
      // Sort dependencies alphabetically
      packageJson.dependencies = sortDependencies(packageJson.dependencies);
      packageJson.devDependencies = sortDependencies(packageJson.devDependencies);

      // Write the updated package.json
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      console.log(`✓ Updated ${packagePath} to use catalog:${catalogName}`);
    } else {
      console.log(`- No changes needed for ${packagePath}`);
    }
  }

  console.log('\nRunning pnpm install to apply the changes...');
  try {
    execSync('pnpm install', { stdio: 'inherit' });
    console.log('\n✓ Successfully switched catalog and installed dependencies');
  } catch (error) {
    console.error('\nError running pnpm install:', error);
    process.exit(1);
  }
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
