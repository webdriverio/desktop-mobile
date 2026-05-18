// Shared setup for @wdio/dioxus-service integration tests.
//
// Currently a no-op — integration tests are added once the launcher
// actually spawns subprocesses (post-PR3, when the 'external' and
// 'embedded' providers come online). The file exists so the
// `setupFiles: ['test/integration/setup.ts']` reference in
// vitest.integration.config.ts resolves cleanly even before there are
// integration specs to run.
