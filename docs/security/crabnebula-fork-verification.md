# CrabNebula macOS verification for fork PRs

## Why this exists

The macOS CrabNebula E2E provider needs `CN_API_KEY`. GitHub does **not** expose repository
secrets to pull requests from forks, so on a fork PR the macOS CrabNebula leg is **skipped** — the
PR can otherwise merge green without that leg ever running.
Windows and Linux CrabNebula, plus the embedded and official providers, still run on forks; the
**only** uncovered surface on a fork PR is macOS CrabNebula specifically.

This gate makes that gap explicit instead of silent, and gates it behind a human review — because
verifying macOS CrabNebula means running the fork's code **with the key**, and the fork's code is
untrusted.

## The security model (read this first)

- **The human diff review is the real control.** The static scan arms it; nothing else replaces it.
- A keyed verification run exposes only `CN_API_KEY` to fork code, and only step-scoped to the
  CrabNebula test step: the build jobs are called with no secrets, and the E2E job is passed
  `CN_API_KEY` alone, so `TURBO_TOKEN` and the deploy key never reach fork code. `CN_API_KEY` still
  reaches the app under test during the CrabNebula step — the irreducible exposure. Keep it rotatable.
- The gate is a commit **status**, which any write-access user can set via the REST API. So it is a
  process control among trusted maintainers (all of whom can already reach secrets via workflow
  authoring), not a hard technical boundary. `CRABNEBULA_LABELERS` + the `authorize` job restrict the
  intended path; they don't stop a determined write-access user from forging the status.
- GitHub has **no per-label permission**, so the gate never trusts a label's presence: it is
  event-driven (see `crabnebula-verify.yml`) and success is only posted by an authorized action.
- Detection is defense-in-depth, not prevention. macOS runners can't block egress, and we have no
  visibility into CrabNebula-side key usage. Assume a leak is possible.

## What runs automatically

| Workflow | Trigger | Does |
|---|---|---|
| `fork-risk-scan.yml` | any fork PR opened/updated | General supply-chain risk scan (no code executed). Detail → **Security tab** (Code Scanning, maintainer-only). Public surface = a terse `Fork Risk Scan` status with a count only. |
| `crabnebula-verify.yml` | PR opened/updated/labeled | Posts the required `CrabNebula / macOS` status; enforces the labeler allowlist; voids attestation on new pushes. |
| `crabnebula-mirror.yml` | authorized `crabnebula:run` label | Mirrors the reviewed fork head (squash-merged onto main) to a fresh per-dispatch `crabnebula-verify/pr-<N>-<run-id>` branch and dispatches the keyed run. Runs no fork code. |
| `crabnebula-mirror-run.yml` | dispatched by the mirror | Builds and runs macOS CrabNebula with the key, reports the result back as `CrabNebula / macOS`, deletes the branch. |

`CrabNebula / macOS` states:
- **success** — internal PR, no Tauri changes, or an authorized `crabnebula:verified` label is present.
- **pending (blocks merge)** — any fork PR that touches Tauri and isn't yet verified.

Every fork Tauri PR blocks until verified — macOS CrabNebula is skipped on all of them, and a green
embedded run doesn't prove CrabNebula passes.

## The review checklist (clear before applying `crabnebula:verified`)

The scan (Security tab) flags the surface; you make the call. For a secret-bearing run you are
reviewing more than correctness — you are vouching that nothing in the diff can steal the key:

- [ ] **Dependencies:** `pnpm-lock.yaml` changes reviewed; no new deps from non-registry (git/tarball) sources; no registry/source redirection in `.npmrc` / `.yarnrc` / `.cargo/config.toml`.
- [ ] **Lifecycle scripts:** no unexpected `preinstall`/`install`/`postinstall`/`prepare` in any `package.json`, and no fork-added `.pnpmfile.cjs` (its hooks run during `pnpm install`).
- [ ] **Rust build hooks:** `build.rs` / `Cargo.toml` `[build-dependencies]` additions inspected.
- [ ] **Workflow/action files:** `.github/workflows/**` and `action.yml` changes inspected. (The mirror pins `.github` to main so a fork's edits don't run with the key, but review them anyway.)
- [ ] **Exfiltration shapes:** no env-read → network pattern (`curl`/`fetch`/`nc` + `CN_API_KEY`/`process.env`/`std::env`), no suspicious base64/encode near secrets.
- [ ] The diff you reviewed is the **current head SHA** (a new push voids the attestation).

If anything is unclear, do not verify. The scan is a heuristic — obfuscated exfiltration can pass it.

## How to verify, then label

Always review the diff against the checklist above (scan output in the Security tab) first. Then
pick a path — both only count from a login in `CRABNEBULA_LABELERS`, and a new push to the PR clears
the label, so re-verify.

**Automated (`crabnebula:run`) — prefer this.** Apply the label. `crabnebula-mirror.yml` mirrors the
reviewed head onto a fresh per-dispatch `crabnebula-verify/pr-<N>-<run-id>` branch, `crabnebula-mirror-run.yml`
runs macOS CrabNebula with **only `CN_API_KEY`** (build jobs get no secrets), and the result posts back
as `CrabNebula / macOS`.
Applying the label **is** authorizing a keyed run of the fork's code — only apply it once the diff
review is done. This path has the narrowest exposure and should be the default.

**Manual (`crabnebula:verified`) — only if you accept the wider exposure.** For confirming macOS
CrabNebula some other way, then attesting. ⚠️ Do **not** verify by opening an internal PR from the
fork's code: an internal PR runs `ci.yml` with `secrets: inherit`, so the fork's `build.rs` / lifecycle
scripts / test code execute with the **full** internal secret set (`TURBO_TOKEN`, `DEPLOY_KEY`), not
just `CN_API_KEY` — strictly more exposure than the automated path. Prefer running the CrabNebula E2E
**locally** (with the key, on the reviewed checkout) and no repo secrets, then apply `crabnebula:verified`.
(A bare `git push` of an internal branch runs no CI anyway — `ci.yml`'s `push` trigger is `main`-only.)

## If you suspect the key leaked

Rotate immediately. The CI-only key limits blast radius but does not eliminate it.

1. Generate a new CrabNebula key.
2. Update the `CN_API_KEY` repository secret.
3. Revoke the old key with CrabNebula.
4. Note the PR/SHA and what triggered the suspicion in the run.

## One-time setup (admin)

- **Branch protection:** add `CrabNebula / macOS` to the required status checks on `main`. **This is
  load-bearing** — without it, a fork Tauri PR merges green with no macOS CrabNebula coverage (the
  leg is skipped on forks), a silent gap instead of a visible red. After enabling it, **re-trigger any
  already-open fork Tauri PRs** (push, or close/reopen) — the gate posts on PR events, so PRs open at
  rollout otherwise sit at "Expected — waiting for status" until their next push.
- **Labels:** create `crabnebula:verified` and `crabnebula:run`.
- **Repo variable (required):** set `CRABNEBULA_LABELERS` to a JSON array of the reviewer logins. Keep
  it to people who actually perform the review — **not** all repo admins. There is no hardcoded
  default: until it is set the allowlist is empty, so no one can attest or start a keyed run (fail-closed).
- **Code Scanning** enabled so SARIF alerts land in the Security tab (free on public repos).
- **`CN_API_KEY`** available as a repository secret (already the case for internal CI). The reusable
  step-scopes it to the CrabNebula step, so the mirror run's build steps never see it.

## Residual risk and open follow-ups

- The automated run executes untrusted fork code with `CN_API_KEY`. The mirror splits privilege — the
  privileged step (merge + push) runs no fork code, and the keyed run sees only `CN_API_KEY` — but the
  human review remains the only thing between an external contributor and the key. The plumbing adds
  convenience, not safety.
- **Egress tripwire — deferred.** macOS runners can't block egress, so it would be observe-only, and
  it needs a step inside the shared E2E reusable plus live tuning to avoid false positives. Not worth
  half-building; track separately. Real backstops stay: the review, a step-scoped key, and rotation.
- The automated run exercises embedded + CrabNebula (official auto-skips on macOS), not CrabNebula in
  strict isolation. Embedded runs without the key, so it adds no exposure; a strict CN-only path would
  need an `only_provider` input on the reusable.
- **macOS CrabNebula is a hard-required leg** (allow-fail is Windows-only, per
  [#542](https://github.com/webdriverio/desktop-mobile/issues/542) — this is a `main` policy, not added
  here), and `require_crabnebula` keeps the keyed run from allow-failing it (an allow-failed
  verification would be vacuous). So if the macOS-26 session regression
  ([#540](https://github.com/webdriverio/desktop-mobile/issues/540)/[#541](https://github.com/webdriverio/desktop-mobile/issues/541))
  recurs even transiently, the keyed run reds and can't post success — verify with `crabnebula:verified`
  after a local run, and fix the flake upstream rather than weakening the gate.
- **Scanner is a heuristic, by design.** It reads only the PR's diff (never fork file contents — that
  is what keeps it off the untrusted-content path), so signals that need surrounding context can be
  missed: env-read + network is flagged only when *both* appear in *added* lines (a fork adding just an
  env read to a file with pre-existing egress won't trip it), and a registry crate added under a
  *pre-existing* `[build-dependencies]` header isn't flagged (the section header may be outside the
  diff). The named-secret/outbound-command rules, the review checklist's dependency/build-hook items,
  and — above all — the human diff review are the backstop. Completeness trades directly against
  flooding the advisory, so it is deliberately not chased further.
- **Label-race residual.** A keyed run tests the head SHA in the `labeled` event payload. The mirror
  refuses if the head moved after the event fires, but a force-push that lands in the sub-second window
  *before* the label click is processed could make the event itself carry an unreviewed SHA. Re-check
  the PR head after labeling; the exposure is one keyed run of unreviewed code, gated on winning that
  race against a human click. The manual `crabnebula:verified` path shares this pre-click window and has
  no automated drift guard — but it runs **no** fork code, so the exposure is only an attested-but-
  unreviewed SHA (mitigated by confirming the head per the checklist, and by a later push clearing the
  label), never key execution. That asymmetry is why only the code-running mirror guards on drift.
- The gate classifies the PR from the **Files API** list (so it never fetches fork code) rather than
  the pipeline's git-diff. For normal PRs these match; they can differ only on API truncation (>3000
  files) or rare rename/merge edge cases. Using git-diff would reintroduce the head fetch this design
  removes, so the API source is deliberate.
- **Base-movement.** The mirror squashes the reviewed fork head onto *current* `origin/main`, which may
  have advanced since the reviewer looked. The keyed run therefore tests fork-code + latest main, not
  fork-code + main-at-review-time. Since main is trusted this is intentional (verify against current
  main), but the attestation covers the reviewed *fork* diff, not the base it merged onto.
- A fork PR whose diff is entirely under `.github/**` (pinned to main) or already in main has no fork
  application code to mirror. `crabnebula:run` detects the empty result and posts a "workflow-only —
  nothing to exercise" status directing you to `crabnebula:verified`, since the keyed run can't test a
  change to the very machinery it pins to main. The workflow changes are still flagged by the fork risk
  scan for review.
