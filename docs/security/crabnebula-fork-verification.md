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

- The key is an account-level CrabNebula credential. In the E2E job it is a plain env var, so any
  code that runs in that job — the app under test, its Rust `build.rs`, `pnpm` lifecycle scripts,
  and every transitive dependency — can read and exfiltrate it. A fork PR controls all of that.
- **The human diff review is the real control.** The static scan arms it; nothing else replaces it.
- GitHub has **no per-label permission** — any repo admin can apply any label. So the label's
  presence is not a trust boundary. The boundary is enforced in `crabnebula-verify.yml`: only a
  login in `CRABNEBULA_LABELERS` can make a sensitive label stick; anyone else's is removed + logged.
- Detection is defense-in-depth, not prevention. macOS runners can't block egress, and we have no
  visibility into CrabNebula-side key usage. Assume a leak is possible and keep the key rotatable.

## What runs automatically

| Workflow | Trigger | Does |
|---|---|---|
| `crabnebula-fork-scan.yml` | fork PR opened/updated | Static risk scan (no code executed). Detail → **Security tab** (Code Scanning, maintainer-only). Public surface = a terse `Fork Risk Scan` status with a count only. |
| `crabnebula-verify.yml` | PR opened/updated/labeled | Posts the required `CrabNebula / macOS` status; enforces the labeler allowlist; voids attestation on new pushes. |

`CrabNebula / macOS` states:
- **success** — internal PR, or no Tauri changes, or an authorized `crabnebula-verified` label is present.
- **pending (blocks merge)** — fork PR touching the CrabNebula path, not yet verified.
- **success with a note** — fork PR touching Tauri but not the CrabNebula path (soft tier; embedded/official/Linux covered it).

## The review checklist (clear before applying `crabnebula-verified`)

The scan (Security tab) flags the surface; you make the call. For a secret-bearing run you are
reviewing more than correctness — you are vouching that nothing in the diff can steal the key:

- [ ] **Dependencies:** `pnpm-lock.yaml` changes reviewed; no new deps from non-registry (git/tarball) sources.
- [ ] **Lifecycle scripts:** no unexpected `preinstall`/`install`/`postinstall`/`prepare` in any `package.json`.
- [ ] **Rust build hooks:** `build.rs` / `Cargo.toml` `[build-dependencies]` additions inspected.
- [ ] **Exfiltration shapes:** no env-read → network pattern (`curl`/`fetch`/`nc` + `CN_API_KEY`/`process.env`/`std::env`), no suspicious base64/encode near secrets.
- [ ] The diff you reviewed is the **current head SHA** (a new push voids the attestation).

If anything is unclear, do not verify. The scan is a heuristic — obfuscated exfiltration can pass it.

## How to verify, then label

1. Review the diff against the checklist above (scan output in the Security tab).
2. Run macOS CrabNebula against the **exact reviewed code** — pull the PR into an internal branch
   (where `CN_API_KEY` is available) and let CI run it:
   ```bash
   git fetch origin pull/<PR>/head:verify-<PR>
   git switch verify-<PR>
   git push origin verify-<PR>      # internal branch → CrabNebula runs with the key
   ```
3. When it passes, apply the **`crabnebula-verified`** label to the fork PR. The gate goes green.
   (Only logins in `CRABNEBULA_LABELERS` count; a new push to the PR clears the label — re-verify.)

## If you suspect the key leaked

Rotate immediately. The CI-only key limits blast radius but does not eliminate it.

1. Generate a new CrabNebula key.
2. Update the `CN_API_KEY` repository secret.
3. Revoke the old key with CrabNebula.
4. Note the PR/SHA and what triggered the suspicion in the run.

## One-time setup (admin)

- **Branch protection:** add `CrabNebula / macOS` to the required status checks on `main`.
- **Labels:** create `crabnebula-verified` (and, for Phase 2, `crabnebula:run`).
- **Repo variable:** set `CRABNEBULA_LABELERS` to a JSON array of the reviewer logins (default: `["goosewobbler"]`).
  Keep it to people who actually perform the review — **not** all repo admins.
- **Code Scanning** enabled so SARIF alerts land in the Security tab (free on public repos).

## Phase 2 (planned, not in this change)

A `crabnebula:run` label (allowlist-gated, SHA-pinned) that mirrors the reviewed fork head to an
internal `crabnebula-verify/pr-<N>` branch, runs **only** the macOS CrabNebula leg with a
**step-scoped** key, adds a best-effort egress tripwire (macOS can't block, only observe), and
reports the result back to the PR as `CrabNebula / macOS`. This automates step 2 above; it does not
reduce the exposure, so it stays gated behind the same human review.
