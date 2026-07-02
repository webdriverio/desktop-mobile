import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { OutputOptions, RollupOptions } from 'rollup';
import { rollup } from 'rollup';
import type { CodeReplacePluginOption } from '../plugins.js';
import type { InjectDependencyPluginOptions } from '../utils.js';
import type { Logger } from './logger.js';
import type {
  CompilerOptions,
  ConfigSpec,
  GeneratedRollupConfig,
  RollupLogMessage,
  TypeScriptPluginOptions,
} from './types.js';

/**
 * Derive the common source directory of a build's entry points. TypeScript 6.0 (TS5011) requires an
 * explicit `rootDir` once `outDir` is set; using the entries' common parent reproduces the output
 * layout TypeScript inferred implicitly before 6.0 (and works for consumer packages whose own
 * tsconfig omits `rootDir`).
 */
function commonSourceDir(input: string | Record<string, string>, targetCwd: string): string {
  const entries = typeof input === 'string' ? [input] : Object.values(input);
  const segmentLists = entries.map((entry) => dirname(resolve(targetCwd, entry)).split(sep));
  const common = segmentLists[0]?.slice() ?? [];
  for (const segments of segmentLists.slice(1)) {
    let i = 0;
    while (i < common.length && i < segments.length && common[i] === segments[i]) {
      i++;
    }
    common.length = i;
  }
  return common.join(sep) || targetCwd;
}

export class RollupExecutor {
  constructor(private logger: Logger) {}

  /**
   * Execute rollup build using programmatic API with generated config
   */
  async executeBuild(
    generatedConfig: GeneratedRollupConfig,
    targetCwd: string,
    verbose: boolean = false,
  ): Promise<void> {
    this.logger.section('🔨 Executing rollup build...');
    this.logger.extraDetail(`Target directory: ${targetCwd}`);
    this.logger.extraDetail(`Configurations: ${generatedConfig.configs.length}`);

    try {
      // Build each configuration (ESM and CJS)
      for (const configSpec of generatedConfig.configs) {
        await this.buildSingleConfig(configSpec, targetCwd, verbose);
      }

      this.logger.detail('✅ Build completed successfully');
    } catch (error) {
      throw new Error(`Rollup build failed: ${(error as Error).message}`);
    }
  }

  /**
   * Build a single rollup configuration (ESM or CJS)
   */
  private async buildSingleConfig(configSpec: ConfigSpec, targetCwd: string, verbose: boolean): Promise<void> {
    const { format } = configSpec;
    this.logger.detail(`📦 Building ${format.toUpperCase()} bundle...`);

    // Convert our config spec to actual rollup config
    const rollupConfig: RollupOptions = await this.createRollupConfig(configSpec, targetCwd);

    if (verbose) {
      this.logger.extraDetail(`Input: ${JSON.stringify(rollupConfig.input)}`);
      this.logger.extraDetail(`Output dir: ${(rollupConfig.output as OutputOptions).dir}`);
    }

    // Create bundle
    const bundle = await rollup(rollupConfig);

    try {
      // Write bundle
      await bundle.write(rollupConfig.output as OutputOptions);
      this.logger.extraDetail(`✅ ${format.toUpperCase()} bundle written`);
    } finally {
      // Always close bundle
      await bundle.close();
    }
  }

  /**
   * Convert our config spec to actual rollup configuration
   */
  private async createRollupConfig(configSpec: ConfigSpec, targetCwd: string): Promise<RollupOptions> {
    const typescriptPlugin = (await import('@rollup/plugin-typescript')).default;
    const { nodeExternals } = await import('rollup-plugin-node-externals');
    const { nodeResolve } = await import('@rollup/plugin-node-resolve');

    // Resolve input paths relative to target directory
    const input =
      typeof configSpec.input === 'string'
        ? resolve(targetCwd, configSpec.input)
        : Object.fromEntries(
            Object.entries(configSpec.input as Record<string, string>).map(([key, path]) => [
              key,
              resolve(targetCwd, path),
            ]),
          );

    // Build plugins array
    const plugins: unknown[] = [];

    // Add plugins based on our config spec
    for (const pluginSpec of configSpec.plugins) {
      if (pluginSpec.name === 'typescript') {
        // Import TypeScript compiler from our bundler's node_modules
        const typescript = await import('typescript');

        // Check if tsconfig.json exists to determine if we should add declaration options
        const tsconfigPath = resolve(targetCwd, 'tsconfig.json');
        const hasTsconfig = existsSync(tsconfigPath);

        const compilerOptions: CompilerOptions = {
          noEmitOnError: false,
          outDir: resolve(targetCwd, configSpec.output.dir),
          rootDir: commonSourceDir(configSpec.input, targetCwd),
          module: 'ESNext',
          moduleResolution: 'Bundler',
          skipLibCheck: true,
          target: 'ES2022',
        };

        if (hasTsconfig) {
          compilerOptions.declaration = true;
          compilerOptions.declarationMap = true;
        }

        const typescriptOptions: TypeScriptPluginOptions = {
          compilerOptions,
          typescript: typescript.default, // Pass the TypeScript compiler explicitly
          include: ['**/*.ts', '**/*.tsx'],
          // Keep the bundler's own config files out of the build program; they live at the package
          // root and would otherwise push the common source dir above rootDir (TS6059 under TS 6).
          exclude: ['node_modules', '**/*.d.ts', '**/wdio-bundler.config.*', '**/rollup.config.*'],
        };

        // If no tsconfig.json exists, disable tsconfig to avoid TypeScript plugin issues
        if (!hasTsconfig) {
          typescriptOptions.tsconfig = false;
        }

        plugins.push(typescriptPlugin(typescriptOptions as Parameters<typeof typescriptPlugin>[0]));
      } else if (pluginSpec.name === 'node-externals') {
        plugins.push(nodeExternals((pluginSpec.options || {}) as Parameters<typeof nodeExternals>[0]));
      } else if (pluginSpec.name === 'node-resolve') {
        plugins.push(nodeResolve());
      } else if (pluginSpec.name === 'inject-dependency') {
        // Import the inject dependency plugin from our bundler
        const { injectDependencyPlugin } = await import('../plugins.js');
        plugins.push(
          injectDependencyPlugin(pluginSpec.options as InjectDependencyPluginOptions | InjectDependencyPluginOptions[]),
        );
      } else if (pluginSpec.name === 'code-replace') {
        // Import the code replace plugin from our bundler
        const { codeReplacePlugin } = await import('../plugins.js');
        plugins.push(codeReplacePlugin(pluginSpec.options as CodeReplacePluginOption | CodeReplacePluginOption[]));
      } else if (pluginSpec.name === 'warn-to-error') {
        plugins.push({
          name: 'warn-to-error',
          onLog(level: string, log: RollupLogMessage) {
            if (level === 'warn') {
              // Type assertion for the rollup plugin context
              (this as { error: (message: RollupLogMessage) => never }).error(log);
            }
          },
        });
      }
    }

    return {
      input,
      output: {
        format: configSpec.output.format,
        dir: resolve(targetCwd, configSpec.output.dir),
        sourcemap: configSpec.output.sourcemap,
        exports: 'named', // Always use named exports to avoid mixed export warnings
        dynamicImportInCjs: configSpec.output.dynamicImportInCjs,
        plugins:
          configSpec.output.plugins?.map((plugin) => {
            if (plugin.name === 'emit-package-json' && plugin.code) {
              const createPlugin = new Function(`return ${plugin.code}`)();
              return createPlugin;
            } else if (plugin.name === 'emit-package-json') {
              return {
                name: 'emit-package-json',
                generateBundle: () => {
                  (
                    this as unknown as {
                      emitFile: (options: { type: 'asset'; fileName: string; source: string }) => void;
                    }
                  ).emitFile({
                    type: 'asset' as const,
                    fileName: 'package.json',
                    source: configSpec.output.format === 'esm' ? '{ "type": "module" }' : '{ "type": "commonjs" }',
                  });
                },
              };
            }
            return {
              name: plugin.name,
              generateBundle() {
                (
                  this as unknown as {
                    emitFile: (options: { type: 'asset'; fileName: string; source: string }) => void;
                  }
                ).emitFile({
                  type: 'asset' as const,
                  fileName: 'package.json',
                  source: '',
                });
              },
            };
          }) || [],
      },
      plugins: plugins as RollupOptions['plugins'],
    };
  }
}
