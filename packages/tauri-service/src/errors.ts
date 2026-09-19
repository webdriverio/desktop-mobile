import { SevereServiceError } from 'webdriverio';

export enum ErrorCode {
  DRIVER_NOT_FOUND = 'DRIVER_NOT_FOUND',
  DRIVER_INSTALL_FAILED = 'DRIVER_INSTALL_FAILED',
  PORT_ALLOCATION_FAILED = 'PORT_ALLOCATION_FAILED',
  BINARY_NOT_FOUND = 'BINARY_NOT_FOUND',
  BACKEND_START_FAILED = 'BACKEND_START_FAILED',
  BACKEND_STOP_FAILED = 'BACKEND_STOP_FAILED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  PLATFORM_UNSUPPORTED = 'PLATFORM_UNSUPPORTED',
}

export class TauriServiceError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TauriServiceError';
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  static fromCode(
    code: ErrorCode,
    message: string,
    cause?: Error,
    context?: Record<string, unknown>,
  ): TauriServiceError {
    return new TauriServiceError(message, code, cause, context);
  }
}

export class DriverError extends TauriServiceError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, ErrorCode.DRIVER_NOT_FOUND, cause, context);
    this.name = 'DriverError';
  }
}

export class BinaryNotFoundError extends TauriServiceError {
  constructor(binaryName: string, cause?: Error, context?: Record<string, unknown>) {
    super(`${binaryName} not found`, ErrorCode.BINARY_NOT_FOUND, cause, { binaryName, ...context });
    this.name = 'BinaryNotFoundError';
  }
}

export class PortAllocationError extends TauriServiceError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, ErrorCode.PORT_ALLOCATION_FAILED, cause, context);
    this.name = 'PortAllocationError';
  }
}

export class BackendError extends TauriServiceError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, ErrorCode.BACKEND_START_FAILED, cause, context);
    this.name = 'BackendError';
  }
}

export function isTauriServiceError(error: unknown): error is TauriServiceError {
  return error instanceof TauriServiceError;
}

export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isTauriServiceError(error) && error.code === code;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Tauri WebDriver lifecycle aborted', { cause: signal.reason });
  }
}

export function severeServiceError(message: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new SevereServiceError(`${message}: ${detail}`);
  // SevereServiceError does not forward ErrorOptions to Error.
  Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true });
  return error;
}
