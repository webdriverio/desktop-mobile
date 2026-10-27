import { SevereServiceError } from 'webdriverio';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Protocol/CDP layers often reject with a plain `{ message }` object.
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(error);
}

/**
 * A `SevereServiceError` with the cause's message. It keeps `cause`, which `SevereServiceError`
 * itself drops.
 */
export function severeServiceError(cause: unknown): Error;
/**
 * A `SevereServiceError` whose message is `message`, a colon and the cause's message. It keeps
 * `cause`, which `SevereServiceError` itself drops.
 */
export function severeServiceError(message: string, cause: unknown): Error;
export function severeServiceError(...args: [unknown] | [string, unknown]): Error {
  const [message, cause] = args.length === 1 ? [undefined, args[0]] : args;
  const detail = errorMessage(cause);
  const error = new SevereServiceError(message ? `${message}: ${detail}` : detail);
  Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true });
  return error;
}
