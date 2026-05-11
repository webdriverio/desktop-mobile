// Tauri-flavoured wrappers around @wdio/native-core/logWriter.
//
// The actual implementation moved to @wdio/native-core. This file preserves
// the zero-arg signatures Tauri callers have been using (`getLogWriter()`,
// `closeLogWriter()`, etc.) so call sites don't have to thread a service
// name. The wrapper file can be deleted later once those call sites import
// from native-core directly.

import {
  closeLogWriter as coreCloseLogWriter,
  getLogWriter as coreGetLogWriter,
  isLogWriterInitialized as coreIsLogWriterInitialized,
  type LogWriter,
  type LogWriterContext,
} from '@wdio/native-core';

export type { LogWriter, LogWriterContext };

const SERVICE_NAME = 'tauri-service';

export function getLogWriter(): LogWriter {
  return coreGetLogWriter(SERVICE_NAME);
}

export function isLogWriterInitialized(): boolean {
  return coreIsLogWriterInitialized(SERVICE_NAME);
}

export async function closeLogWriter(): Promise<void> {
  return coreCloseLogWriter(SERVICE_NAME);
}
