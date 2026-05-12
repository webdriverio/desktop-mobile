import path from 'node:path';
import { z } from 'zod';
import { getE2EAppDirName } from '../lib/utils.js';

/**
 * Environment variable schema for E2E tests
 * Provides type safety and validation for all test configuration
 */
export const EnvSchema = z.object({
  // Core test configuration
  FRAMEWORK: z.enum(['electron', 'tauri', 'dioxus']).default('electron'),
  APP: z.enum(['builder', 'forge', 'script', 'basic']).default('builder'),
  MODULE_TYPE: z.enum(['cjs', 'esm']).optional().default('esm'),
  TEST_TYPE: z.enum(['standard', 'window', 'multiremote', 'standalone', 'deeplink']).default('standard'),
  BINARY: z.enum(['true', 'false']).default('true'),

  // Driver provider for Tauri (official, crabnebula, embedded)
  DRIVER_PROVIDER: z.enum(['official', 'crabnebula', 'embedded']).optional(),

  // Special modes
  MAC_UNIVERSAL: z.enum(['true', 'false']).default('false'),
  ENABLE_SPLASH_WINDOW: z.enum(['true', 'false']).optional(),

  // Test execution
  // Accepts string or number; coerces to a positive integer
  CONCURRENCY: z.coerce.number().int().min(1).default(1),
  WDIO_VERBOSE: z.enum(['true', 'false']).optional(),
  WDIO_MATRIX_DEBUG: z.enum(['true', 'false']).optional(),

  // App directory override (for testing)
  APP_DIR: z.string().optional(),
});

export type TestEnvironment = z.infer<typeof EnvSchema>;

/**
 * Validate and parse environment variables
 */
export function validateEnvironment(env: Record<string, string | undefined> = process.env): TestEnvironment {
  try {
    return EnvSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');

      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    throw error;
  }
}

/**
 * Type-safe environment context with computed properties
 */
export class EnvironmentContext {
  constructor(public readonly env: TestEnvironment) {}

  get framework(): 'electron' | 'tauri' | 'dioxus' {
    return this.env.FRAMEWORK;
  }

  get app(): 'builder' | 'forge' | 'script' | 'basic' {
    return this.env.APP;
  }

  get platform(): 'builder' | 'forge' | 'script' {
    // Platform is Electron-specific; for Tauri, 'basic' maps to 'builder' conceptually
    // but this getter is only used for Electron apps in isScript check
    return this.env.APP as 'builder' | 'forge' | 'script';
  }

  get moduleType(): 'cjs' | 'esm' {
    return this.env.MODULE_TYPE ?? 'esm';
  }

  get testType(): 'standard' | 'window' | 'multiremote' | 'standalone' | 'deeplink' {
    return this.env.TEST_TYPE;
  }

  get isBinary(): boolean {
    return this.env.BINARY === 'true';
  }

  get isScript(): boolean {
    return this.platform === 'script' || !this.isBinary;
  }

  get isMacUniversal(): boolean {
    return this.env.MAC_UNIVERSAL === 'true';
  }

  get isMultiremote(): boolean {
    return this.testType === 'multiremote';
  }

  get isSplashEnabled(): boolean {
    return this.env.ENABLE_SPLASH_WINDOW === 'true';
  }

  get driverProvider(): 'official' | 'crabnebula' | 'embedded' | undefined {
    return this.env.DRIVER_PROVIDER;
  }

  get concurrency(): number {
    return this.env.CONCURRENCY;
  }

  /**
   * Get the app directory name for this environment
   */
  get appDirName(): string {
    return getE2EAppDirName(this.framework, this.app, this.isScript);
  }

  /**
   * Get the full app directory path
   */
  get appDirPath(): string {
    const fixturesDir = 'e2e-apps';
    const appDirName = getE2EAppDirName(this.framework, this.app, this.isScript);
    return path.join(process.cwd(), '..', 'fixtures', fixturesDir, appDirName);
  }

  /**
   * Validate environment compatibility
   */
  validateCompatibility(): void {
    // Framework-specific validation
    if (this.framework === 'tauri') {
      if (!['basic'].includes(this.app)) {
        throw new Error(`Tauri framework only supports 'basic' app, got: ${this.app}`);
      }
    } else if (this.framework === 'dioxus') {
      if (!['basic'].includes(this.app)) {
        throw new Error(`Dioxus framework only supports 'basic' app, got: ${this.app}`);
      }
    } else if (this.framework === 'electron') {
      if (!['builder', 'forge', 'script'].includes(this.app)) {
        throw new Error(`Electron framework only supports 'builder', 'forge', and 'script' apps, got: ${this.app}`);
      }
    }

    // Mac Universal mode validation (Electron only)
    if (this.isMacUniversal) {
      if (this.framework !== 'electron') {
        throw new Error('MAC_UNIVERSAL mode only supports Electron framework');
      }
      if (!['builder', 'forge'].includes(this.app)) {
        throw new Error(`MAC_UNIVERSAL mode only supports builder and forge apps, got: ${this.app}`);
      }
      if (!this.isBinary) {
        throw new Error('MAC_UNIVERSAL mode requires binary mode (BINARY=true)');
      }
    }

    // Script validation (Electron only)
    if (this.framework === 'electron' && this.app === 'script' && this.isBinary) {
      throw new Error('script app cannot be used with binary mode');
    }

    // Test type validation
    if (this.testType === 'window' && !this.isSplashEnabled) {
      console.warn('Window tests typically require ENABLE_SPLASH_WINDOW=true for full functionality');
    }
  }

  /**
   * Create child environment for test execution
   */
  createChildEnvironment(overrides: Partial<TestEnvironment> = {}): Record<string, string> {
    const merged = { ...this.env, ...overrides };

    return {
      FRAMEWORK: merged.FRAMEWORK,
      APP: merged.APP,
      TEST_TYPE: merged.TEST_TYPE,
      BINARY: merged.BINARY,
      APP_DIR: merged.APP_DIR || '',
      ...(merged.DRIVER_PROVIDER && { DRIVER_PROVIDER: merged.DRIVER_PROVIDER }),
      ...(merged.MAC_UNIVERSAL === 'true' && { MAC_UNIVERSAL: 'true' }),
      ...(merged.ENABLE_SPLASH_WINDOW === 'true' && { ENABLE_SPLASH_WINDOW: 'true' }),
      ...(merged.WDIO_VERBOSE === 'true' && { WDIO_VERBOSE: 'true' }),
      ...(merged.WDIO_MATRIX_DEBUG === 'true' && { WDIO_MATRIX_DEBUG: 'true' }),
    };
  }

  /**
   * Get human-readable description of this environment
   */
  toString(): string {
    const parts = [this.framework, this.app, this.testType, this.isBinary ? 'binary' : 'script'];

    if (this.driverProvider) parts.push(`provider-${this.driverProvider}`);
    if (this.isMacUniversal) parts.push('mac-universal');
    if (this.isSplashEnabled) parts.push('splash');

    return parts.join('-');
  }
}

/**
 * Create and validate environment context
 */
export function createEnvironmentContext(env?: Record<string, string | undefined>): EnvironmentContext {
  const validatedEnv = validateEnvironment(env);
  const context = new EnvironmentContext(validatedEnv);
  context.validateCompatibility();
  return context;
}
