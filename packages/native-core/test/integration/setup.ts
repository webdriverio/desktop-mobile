// Shared setup for @wdio/native-core integration tests.
//
// Currently a no-op — integration tests are added as drivers/launchers
// from this package are extended in subsequent PRs. The file exists so the
// `setupFiles: ['test/integration/setup.ts']` reference in
// vitest.integration.config.ts resolves cleanly even before there are
// integration specs to run.
