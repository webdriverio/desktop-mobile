// Reconciled from packages/tauri-service/src/logWriter.ts and
// packages/electron-service/src/logWriter.ts.
//
// Divergences resolved by taking the superset:
//   - Tauri's LogWriterContext (workerId, specName) is preserved as optional.
//   - Electron's async close() with stream-flush callback is the canonical
//     signature — Tauri's previous void-returning close() callers should be
//     awaited where possible (no caller currently relies on synchronous
//     completion).
//   - Tauri's write(message, prefixedMessage?) signature is preserved;
//     Electron callers pass a single arg unchanged.
//   - The service-name prefix in the formatted log line (previously hardcoded
//     to 'tauri-service:service:' or 'electron-service:service:') is now a
//     constructor arg, so each service tags its own lines.
//
// Backwards-compat aliases (`StandaloneLogWriter`, `getStandaloneLogWriter`,
// `isStandaloneLogWriterInitialized`) are re-exported so the existing
// electron-service imports keep working until the call sites are updated.

import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-core');

/**
 * Context for log file naming.
 */
export interface LogWriterContext {
  /** Worker ID for multi-worker mode. Suffixed onto the filename when present. */
  workerId?: string;
  /** Spec name for identification. Currently informational; not used in the filename. */
  specName?: string;
}

/**
 * Captures service logs to a timestamped file under a directory.
 *
 * Used in both WDIO test-runner mode and standalone mode by every native
 * desktop service (Tauri, Electron, Dioxus).
 */
export class LogWriter {
  private logStream?: WriteStream;
  private logDir?: string;
  private logFile?: string;
  private readonly serviceName: string;

  /**
   * @param serviceName - Short service identifier emitted in each log line
   *                      (e.g. 'tauri-service', 'electron-service'). Surfaces
   *                      in formatted output as `<iso> INFO <serviceName>:service: <message>`.
   */
  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  /**
   * Initialise the log writer. Creates the directory if it doesn't exist and
   * opens an append-mode write stream to a timestamped file.
   */
  initialize(logDir: string, context?: LogWriterContext): void {
    this.logDir = logDir;

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const contextSuffix = context?.workerId ? `-${context.workerId}` : '';
    this.logFile = join(this.logDir, `wdio${contextSuffix}-${timestamp}.log`);

    this.logStream = createWriteStream(this.logFile, { flags: 'a' });
  }

  /**
   * Write a log message. If `prefixedMessage` is supplied, it's used instead
   * of `message` (callers use this to embed an already-decorated line). If
   * the writer hasn't been initialised, falls back to stdout.
   */
  write(message: string, prefixedMessage?: string): void {
    if (!this.logStream) {
      console.log(message);
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = prefixedMessage ?? message;
    const formattedMessage = `${timestamp} INFO ${this.serviceName}:service: ${logMessage}\n`;
    this.logStream.write(formattedMessage);
  }

  /**
   * Close the underlying write stream. Resolves once the stream has flushed.
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.logStream) {
        this.logStream.end(() => {
          this.logStream = undefined;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getLogDir(): string | undefined {
    return this.logDir;
  }

  getLogFile(): string | undefined {
    return this.logFile;
  }
}

const singletons = new Map<string, LogWriter>();

/**
 * Get or create the singleton LogWriter for a given service name.
 * Each service gets its own singleton so multi-service tests don't collide.
 */
export function getLogWriter(serviceName: string): LogWriter {
  let instance = singletons.get(serviceName);
  if (!instance) {
    instance = new LogWriter(serviceName);
    singletons.set(serviceName, instance);
  }
  return instance;
}

/**
 * True when a LogWriter for `serviceName` exists and has been initialised
 * (i.e. `initialize()` has been called and a log file path is set).
 */
export function isLogWriterInitialized(serviceName: string): boolean {
  return !!singletons.get(serviceName)?.getLogFile();
}

/**
 * Close the LogWriter for a given service name and release the singleton.
 */
export async function closeLogWriter(serviceName: string): Promise<void> {
  const instance = singletons.get(serviceName);
  if (instance) {
    await instance.close();
    singletons.delete(serviceName);
    log.debug(`Log writer closed for ${serviceName}`);
  }
}

// ---- Backwards-compat aliases ----
// These keep packages/electron-service/src/logWriter.ts call sites working
// during the migration. They will be removed once all callers import the
// canonical names directly.

/**
 * @deprecated Use {@link LogWriter} with a `serviceName` argument.
 * Bound to `'electron-service'` for back-compat with the Electron call sites
 * that historically instantiated this directly.
 */
export class StandaloneLogWriter extends LogWriter {
  constructor() {
    super('electron-service');
  }
}

/** @deprecated Use {@link getLogWriter}(serviceName). */
export function getStandaloneLogWriter(): StandaloneLogWriter {
  let instance = singletons.get('electron-service');
  if (!instance || !(instance instanceof StandaloneLogWriter)) {
    // If we're replacing an initialised LogWriter, flush + close its stream
    // first so the previous WriteStream isn't orphaned and leaking an fd.
    if (instance?.getLogFile()) {
      void instance.close().catch((err) => {
        log.warn(`Failed to close orphaned LogWriter for electron-service: ${err}`);
      });
    }
    instance = new StandaloneLogWriter();
    singletons.set('electron-service', instance);
  }
  return instance as StandaloneLogWriter;
}

/** @deprecated Use {@link isLogWriterInitialized}(serviceName). */
export function isStandaloneLogWriterInitialized(): boolean {
  return isLogWriterInitialized('electron-service');
}
