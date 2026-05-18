// Electron re-export shim around @wdio/native-core/logWriter.
//
// The actual implementation moved to @wdio/native-core. This file preserves
// the Electron-specific `StandaloneLogWriter` / `getStandaloneLogWriter` /
// `isStandaloneLogWriterInitialized` names so existing Electron call sites
// don't have to change. Core ships these as deprecated aliases bound to the
// `'electron-service'` service name.

export {
  getStandaloneLogWriter,
  isStandaloneLogWriterInitialized,
  StandaloneLogWriter,
} from '@wdio/native-core';
