// Build-time helper: copy the committed guest-js bundle into OUT_DIR so lib.rs
// can embed it via include_str!. The bundle (dist-js/index.js) is committed to
// git specifically so downstream git/crates.io consumers receive it; if it is
// missing we fail the build loudly rather than embedding a silent no-op (see
// the panic below for why).

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
  let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR is set by cargo");
  let out_path = PathBuf::from(&out_dir).join("guest_js_bundle.js");

  // The guest-js bundle, written by `pnpm --filter @wdio/dioxus-bridge build`
  // and committed to git so that git/crates.io consumers receive it.
  let bundle_path = PathBuf::from("dist-js/index.js");

  // The bundle is committed to git (and shipped to npm via `files`), so a
  // normal checkout always has it. If it's genuinely absent, embedding a no-op
  // placeholder would yield a binary that *looks* healthy — the app renders —
  // but every bridge round-trip silently times out at runtime with no error
  // anywhere. That's invisible to a consumer because cargo suppresses
  // build-script `cargo:warning` output for non-path (git / crates.io)
  // dependencies. So fail the build loudly instead of shipping a
  // silently-broken bridge.
  let bundle = fs::read_to_string(&bundle_path).unwrap_or_else(|_| {
    panic!(
      "@wdio/dioxus-bridge guest-js bundle not found at `dist-js/index.js`. This file is \
       committed to git so that downstream git/crates.io consumers receive it. If you are \
       building from a workspace checkout, run `pnpm --filter @wdio/dioxus-bridge build` first. \
       Without the bundle the bridge injects nothing and every round-trip times out silently at \
       runtime."
    )
  });

  fs::write(&out_path, bundle).expect("write OUT_DIR/guest_js_bundle.js");

  println!("cargo:rerun-if-changed=dist-js/index.js");
  println!("cargo:rerun-if-changed=guest-js/index.ts");
  println!("cargo:rerun-if-changed=package.json");
  println!("cargo:rerun-if-changed=build.rs");

  // Assert npm-bridge and crate versions are in lockstep on their core
  // version (the part before any `-pre.suffix`). npm uses `-next.N` while
  // crates.io uses `-rc.N`, so a literal string match isn't appropriate —
  // we enforce X.Y.Z agreement and let pre-release suffixes diverge per
  // registry convention. Surface a cargo:warning when package.json can't
  // be read so the skip is visible rather than silent.
  match fs::read_to_string("package.json") {
    Ok(npm_pkg) => {
      let crate_version = env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION is set by cargo");
      let npm_version = extract_npm_version(&npm_pkg).unwrap_or_else(|| {
        panic!("could not find a `version` field in packages/dioxus-bridge/package.json")
      });
      let crate_core = core_version(&crate_version);
      let npm_core = core_version(&npm_version);
      if crate_core != npm_core {
        panic!(
          "version mismatch between Cargo.toml ({crate_version}) and package.json ({npm_version}) — \
           core versions must agree (got `{crate_core}` vs `{npm_core}`). Bump both together \
           before releasing.",
        );
      }
    }
    Err(e) => {
      println!(
        "cargo:warning=packages/dioxus-bridge/package.json not readable ({e}); \
         npm↔crate version-sync check skipped.",
      );
    }
  }
}

/// Naive JSON scan that pulls the top-level `version` string. Avoids adding
/// serde_json as a build-dep just for one field.
fn extract_npm_version(pkg: &str) -> Option<String> {
  let key = "\"version\"";
  let i = pkg.find(key)?;
  let after_key = &pkg[i + key.len()..];
  let colon = after_key.find(':')?;
  let after_colon = &after_key[colon + 1..];
  let open_quote = after_colon.find('"')?;
  let rest = &after_colon[open_quote + 1..];
  let close_quote = rest.find('"')?;
  Some(rest[..close_quote].to_string())
}

/// Return the core `X.Y.Z` from a SemVer string, dropping any pre-release suffix.
fn core_version(v: &str) -> &str {
  v.split('-').next().unwrap_or(v)
}
