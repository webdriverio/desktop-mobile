# AGENTS.md

Guidance for coding agents working in this repo: the commands to run, the checks a change needs, and the rules the linters don't enforce. [README.md](./README.md) lists the services, and [ROADMAP.md](./ROADMAP.md) has what's next.

## Commands

- **One package:** `pnpm --filter <package> test` (unit tests), `test:integration`, `typecheck` or `build`. These run Vitest and tsc directly.
- **Whole repo:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`. These run through Turborepo, which caches results; add `--force` to rerun a cached pass.
- **ESLint only runs from the root.** A package's `lint` script is Biome only, so it misses rules such as `vitest/valid-expect`. Run `pnpm exec eslint <files>` on what you changed.
- **E2E** (`e2e/`, the `pnpm e2e*` scripts) needs the fixture app in `fixtures/e2e-apps/` built first, and it's slow. CI runs it for the services a PR touches; locally, run the tests of the packages you changed. See [docs/e2e-testing.md](./docs/e2e-testing.md).
- **Rust crates** (packages with a `Cargo.toml`): from the crate's directory, `cargo test --locked` and `cargo clippy --all-targets -- -D warnings`. CI fails on clippy warnings.

## Before you push

Husky runs Biome and ESLint on staged files when you commit, and `typecheck` and `test` for every package when you push. If you skip the hooks, run those checks yourself for what you changed. New logic needs unit tests; the coverage target is 80%.

## Gotchas

- The Dioxus crates use 2-space indentation but have no rustfmt config, so `cargo fmt` reformats whole files there. Don't run it on them. The Tauri crates follow rustfmt's defaults.
- Every crate and Rust fixture commits its `Cargo.lock`. Commit it with any dependency change, and give a new crate one.
- `fixtures/package-tests/*` install in isolation, so they use explicit versions, never `catalog:`. Only `fixtures/e2e-apps/*` and `e2e/` use the pnpm catalogs.
- The package-test fixtures pin `@electron-forge/*` and `electron-builder` to exact versions. Bump those in their own PR.
- `packages/dioxus-bridge/dist-js/index.js` is a committed build of `guest-js/`. After editing `guest-js/`, run `pnpm --filter @wdio/dioxus-bridge build` and commit the result.
- releasekit versions and releases the packages from conventional commits on `main`, so don't edit versions or changelogs by hand. A breaking change (a `!` after the commit type, or a `BREAKING CHANGE:` footer) merged to `main` makes that package's next release a major, so breaking PRs stay open until a major is planned.

## How the services fit together

- Each service has a launcher (`launcher.ts`) and a worker (`service.ts`), which WDIO runs in separate processes. The launcher finds binaries, allocates ports, starts drivers and edits capabilities. It has no `browser`, and throws `SevereServiceError` to stop the run. The worker adds the `browser.<framework>` API and manages mocks.
- A mock has two halves: an inner mock in the app, from `@wdio/native-spy`, and an outer, Vitest-compatible mock in the test process. Call data is serialized to JSON and syncs one way, from inner to outer. See [docs/architecture/mock-architecture.md](./docs/architecture/mock-architecture.md).
- The services share one API surface, multiremote included, so a feature added to one service takes the same shape as in the others. [features.md](./.claude/skills/add-native-service/features.md) has the standard.
- To add a service, follow the [add-native-service skill](./.claude/skills/add-native-service/SKILL.md).
- [docs/architecture/](./docs/architecture/README.md) has a file per shared pattern, such as port allocation, driver lifecycle and cross-platform processes. [docs/adr/](./docs/adr/) records decisions.

## Code conventions the linters don't check

- Log with `createLogger` from `@wdio/native-utils`, not `console`.
- Operations that can fail return a `Result<T, E>`: check `.ok`, then read `.value` or `.error`. There's no `.success` or `.data`.
- Prefer `undefined` to `null`.
- No barrel files (an `index.ts` that only re-exports), except a package's root `index.ts`.

### Comments

- Default to writing no comments. Add one only when the **why** is
  non-obvious — a hidden constraint, a subtle invariant, a workaround for a
  specific bug, behavior that would surprise a reader. If removing the
  comment wouldn't confuse a future reader, don't write it.
- Don't restate what the code already says. A descriptive variable or
  function name removes the need for a comment that describes the same
  thing in prose.
- Don't couple comments to details that drift without signal — specific
  version numbers, transient stack traces, "this used to do X". These rot
  silently as the environment changes. Keep the rationale, drop the
  citation: `// Forge silently broke packaging in a patch release` rather
  than `// Forge 7.11.2 silently broke packaging`.
- **Do** link load-bearing tracking refs — an issue or PR whose resolution
  removes or rewrites the commented code. These are the opposite of drift:
  they're an active signal to update. `// Workaround for forge/forge#4219;
  drop once a fix lands` is useful even years later.
- JSDoc for public APIs only when necessary.
