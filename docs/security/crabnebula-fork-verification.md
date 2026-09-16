# CrabNebula macOS verification for fork PRs

## Why this exists

The macOS CrabNebula E2E provider needs `CN_API_KEY`, and GitHub withholds repository secrets from
fork PRs — so on a fork PR the macOS CrabNebula leg is **skipped**, and the PR can merge green without
it ever running. This gate makes that gap explicit and puts it behind a human review, because
verifying macOS CrabNebula means running the fork's untrusted code **with the key**.

## The security model (read this first)

- **The human diff review is the real control.** The static scan arms it; nothing else replaces it.
- A keyed run exposes only `CN_API_KEY`, step-scoped to the CrabNebula step: build jobs get no
  secrets, the E2E job is passed `CN_API_KEY` alone, so `TURBO_TOKEN` and the deploy key never reach
  fork code. The key still reaches the app under test — the irreducible exposure. Keep it rotatable.
- The gate is a commit **status**, which any write-access user can set via the REST API — a process
  control among trusted maintainers (who can already reach secrets by authoring workflows), not a hard
  technical boundary. `CRABNEBULA_LABELERS` + the `authorize` job restrict the intended path; they
  don't stop a determined write-access user forging the status.
- The gate never trusts a label's presence (GitHub has no per-label permission): it is event-driven
  and success is only posted by an authorized action.
- Detection is defense-in-depth, not prevention. macOS runners can't block egress and we can't see
  CrabNebula-side key usage — assume a leak is possible.

## What runs automatically

| Workflow | Trigger | Does |
|---|---|---|
| `fork-risk-scan.yml` | any fork PR opened/updated | Supply-chain risk scan (no code executed). Detail → **Security tab** (maintainer-only); public surface is a terse `Fork Risk Scan` status with a count only. |
| `crabnebula-verify.yml` | PR opened/updated/labeled | Posts the required `CrabNebula / macOS` status; enforces the labeler allowlist; voids attestation on new pushes. |
| `crabnebula-mirror.yml` | authorized `crabnebula:run` label | Mirrors the reviewed fork head (squash-merged onto main) to a fresh per-dispatch branch and dispatches the keyed run. Runs no fork code. |
| `crabnebula-mirror-run.yml` | dispatched by the mirror | Builds and runs macOS CrabNebula with the key, reports back as `CrabNebula / macOS`, deletes the branch. |

`CrabNebula / macOS` is **success** for an internal PR, no Tauri changes, or an authorized
`crabnebula:verified` label; **pending (blocks merge)** for any unverified fork PR that touches Tauri.

## The review checklist (clear before applying `crabnebula:verified`)

The scan (Security tab) flags the surface; you make the call. For a secret-bearing run you are
vouching that nothing in the diff can steal the key:

- [ ] **Dependencies:** `pnpm-lock.yaml` changes reviewed; no new deps from non-registry (git/tarball) sources; no registry/source redirection in `.npmrc` / `.yarnrc` / `.cargo/config.toml`.
- [ ] **Lifecycle scripts:** no unexpected `preinstall`/`install`/`postinstall`/`prepare` in any `package.json`, and no fork-added `.pnpmfile.cjs` (its hooks run during `pnpm install`).
- [ ] **Rust build hooks:** `build.rs` / `Cargo.toml` `[build-dependencies]` additions inspected.
- [ ] **Workflow/action files:** `.github/workflows/**` and `action.yml` changes inspected. (The mirror pins `.github` to main so a fork's edits don't run with the key, but review them anyway.)
- [ ] **Exfiltration shapes:** no env-read → network pattern (`curl`/`fetch`/`nc` + `CN_API_KEY`/`process.env`/`std::env`), no suspicious base64/encode near secrets.
- [ ] The diff you reviewed is the **current head SHA** (a new push voids the attestation).

If anything is unclear, do not verify. The scan is a heuristic — obfuscated exfiltration can pass it.

## How to verify, then label

Review the diff against the checklist first. Both paths only count from a login in
`CRABNEBULA_LABELERS`, and a new push to the PR clears the label — so re-verify after any push.

**Automated (`crabnebula:run`) — prefer this.** Apply the label; the mirror runs macOS CrabNebula on
the reviewed head with only `CN_API_KEY` and posts the result back as `CrabNebula / macOS`. Applying
the label **is** authorizing a keyed run of the fork's code, so only apply it once the review is done.
This path has the narrowest exposure.

**Manual (`crabnebula:verified`) — only if you accept wider exposure.** For confirming macOS CrabNebula
some other way, then attesting. Prefer running the E2E **locally** (with the key, on the reviewed
checkout, no repo secrets), then apply the label. ⚠️ Do **not** verify by opening an internal PR from
the fork's code: that runs `ci.yml` with `secrets: inherit`, so the fork's build/lifecycle/test code
executes with the **full** secret set (`TURBO_TOKEN`, `DEPLOY_KEY`) — strictly more exposure than the
automated path.

## If you suspect the key leaked

Rotate immediately. The CI-only key limits blast radius but doesn't eliminate it.

1. Generate a new CrabNebula key.
2. Update the `CN_API_KEY` repository secret.
3. Revoke the old key with CrabNebula.
4. Note the PR/SHA and what triggered the suspicion.

## One-time setup (admin)

- **Branch protection (load-bearing):** add `CrabNebula / macOS` to the required checks on `main` —
  without it a fork Tauri PR merges green with no macOS CrabNebula coverage. After enabling, re-trigger
  open fork Tauri PRs (they otherwise sit at "Expected" until their next push).
- **`CRABNEBULA_LABELERS` (required):** a JSON-array repo variable of the reviewer logins — keep it to
  people who do the review, not all admins. Unset → empty → no one can attest or start a run (fail-closed).
- Create the `crabnebula:verified` and `crabnebula:run` labels, and enable Code Scanning (for the
  Security tab). `CN_API_KEY` is already a repo secret from internal CI.

## Known limitations

- **The scanner is a heuristic.** It reads only the PR's diff (never fork file contents), so
  context-dependent signals can be missed — the human review is the backstop, and completeness is
  deliberately bounded to avoid flooding the advisory.
- **Label-race.** A keyed run tests the head SHA in the `labeled` event; the mirror refuses if the head
  moved after, but a force-push in the sub-second window before the click is processed could carry an
  unreviewed SHA. Re-check the PR head after labeling.
- **Base-movement.** The mirror squashes the reviewed fork head onto *current* `main`, so the keyed run
  tests fork-code + latest main. The attestation covers the reviewed *fork* diff, not the base.
- **Workflow-only PRs.** A fork PR whose diff is entirely under `.github/**` has no application code to
  mirror; `crabnebula:run` detects this and directs you to `crabnebula:verified`. The workflow changes
  are still flagged by the fork risk scan.
