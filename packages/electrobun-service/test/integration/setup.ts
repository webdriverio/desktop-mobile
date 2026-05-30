// Shared setup for @wdio/electrobun-service integration tests.
//
// Currently a no-op — integration tests are added once the launcher actually
// spawns the Electrobun binary (MVP PR onwards). The file exists so the
// `setupFiles: ['test/integration/setup.ts']` reference in
// vitest.integration.config.ts resolves cleanly before there are specs to run.
