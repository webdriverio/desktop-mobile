import type { ChildProcess } from 'node:child_process';

/** Sends `signal` and resolves whether the process exited within `timeoutMs`. */
export function signalAndWaitForExit(child: ChildProcess, signal: NodeJS.Signals, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref();
    // Register before kill: a child can exit as soon as the signal is sent.
    child.once('exit', onExit);
    child.once('error', onError);
    try {
      child.kill(signal);
      if (child.exitCode !== null || child.signalCode !== null) onExit();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
