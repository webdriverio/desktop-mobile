# AGENTS.md

Guidance for coding agents working in this repo: the commands to run, the checks a change needs, and the rules the linters don't enforce. [README.md](./README.md) lists the services, and [ROADMAP.md](./ROADMAP.md) has what's next.

## Commands

- **One package:** `pnpm --filter <package> test` (unit tests), `test:integration`, `typecheck` or `build`. These skip Turborepo, so they run against your workspace dependencies' built `dist/`, which may be stale. Build those first with `pnpm turbo run build --filter=<package>^...`.
- **All packages:** `pnpm turbo run typecheck test --filter=./packages/*` is what the pre-push hook runs, and `pnpm build` builds every package. Turborepo caches both; add `--force` to rerun a cached pass. Don't run the root `pnpm test`: it also runs the E2E matrix and every package-test app.
- **Lint:** `pnpm lint` runs Biome and ESLint over the whole repo. It doesn't run through Turborepo, so don't pass it `--force`. A package's own `lint` script is Biome only and misses rules such as `vitest/valid-expect`. To check just what you changed, run `pnpm exec biome check <files>` and `pnpm exec eslint <files>`, as the commit hook does.
- **E2E** (`e2e/`, the `pnpm e2e*` scripts) needs the fixture app in `fixtures/e2e-apps/` built first, and it's slow. CI runs it for the services a PR touches; locally, run the tests of the packages you changed. See [docs/e2e-testing.md](./docs/e2e-testing.md).
- **Rust crates** (packages with a `Cargo.toml`): from the crate's directory, `cargo test` and `cargo clippy --all-targets -- -D warnings`. CI fails on clippy warnings.

## Before you push

Husky runs Biome and ESLint on staged files when you commit, and `typecheck` and `test` for every package when you push. If you skip the hooks, run those checks yourself for what you changed. New logic needs unit tests.

## Gotchas

- Neither the Dioxus nor the Tauri crates are rustfmt-clean yet, so `cargo fmt` rewrites code you didn't touch. Don't run it over a whole crate; format only the code you change.
- Every crate and Rust fixture commits its `Cargo.lock`. Commit it with any dependency change, and give a new crate one.
- The package tests install `fixtures/package-tests/*` in isolation, where `catalog:` doesn't resolve, so those fixtures use explicit versions, never `catalog:`.
- The package-test fixtures pin `@electron-forge/*` and `electron-builder` to exact versions. Bump those in their own PR.
- `packages/dioxus-bridge/dist-js/index.js` is a committed build of `guest-js/`. After editing `guest-js/`, run `pnpm --filter @wdio/dioxus-bridge build` and commit the result.
- releasekit versions and releases the packages from conventional commits on `main`, so don't edit versions or changelogs by hand. A breaking change (a `!` after the commit type, or a `BREAKING CHANGE:` footer) merged to `main` makes that package's next release a major, so breaking PRs stay open until a major is planned. The exceptions are 0.x packages, where it makes a minor, and `-next` prereleases, where it only advances the prerelease number.

## How the services fit together

- Each service has a launcher (`launcher.ts`) and a worker (`service.ts`), which WDIO runs in separate processes. The launcher finds binaries, allocates ports, starts drivers and edits capabilities. It has no `browser`, and throws `SevereServiceError` to stop the run. The worker adds the `browser.<framework>` API and manages mocks.
- A mock has two halves: an inner mock in the app, from `@wdio/native-spy`, and an outer, Vitest-compatible mock in the test process. Call data is serialized to JSON and syncs one way, from inner to outer. See [docs/architecture/mock-architecture.md](./docs/architecture/mock-architecture.md).
- The services share one API surface, so a feature added to one service takes the same shape as in the others. That includes multiremote, except on React Native and Flutter (not shipped yet, [#446](https://github.com/webdriverio/desktop-mobile/issues/446)) and on Electrobun's macOS CEF path (blocked upstream). [features.md](./.claude/skills/add-native-service/features.md) has the standard.
- To add a service, follow the [add-native-service skill](./.claude/skills/add-native-service/SKILL.md).
- [docs/architecture/](./docs/architecture/README.md) has a file per shared pattern, such as port allocation, driver lifecycle and cross-platform processes. [docs/adr/](./docs/adr/) records decisions.

## Code conventions the linters don't check

- Operations that can fail return a `Result<T, E>`: check `.ok`, then read `.value` or `.error`. There's no `.success` or `.data`.
- Prefer `undefined` to `null`.
- Avoid `any`. Biome only warns about it.

### Comments

Default to none. Write one only when the *why* is non-obvious: a hidden constraint, a workaround, behavior that would surprise a reader. Don't restate the code, and don't cite details that drift silently (versions, stack traces, "this used to do X"). Do link an issue or PR whose resolution would change the code: `// Workaround for forge/forge#4219; drop once a fix lands`. JSDoc only where a public API needs it.
