// Build-time helper: copy the bundled guest-js into OUT_DIR so lib.rs can
// embed it via include_str!. If the bundle hasn't been built yet (e.g.
// `cargo check` runs before `pnpm build:js`), emit a no-op placeholder so
// the crate still compiles — the bridge just won't inject anything until
// the bundle is rebuilt.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
  let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR is set by cargo");
  let out_path = PathBuf::from(&out_dir).join("guest_js_bundle.js");

  // Try the npm-package output path first (dist-js/index.js, written by
  // `pnpm --filter @wdio/dioxus-bridge build`). Fall back to the legacy
  // guest-js/dist-js path for backwards-compat with any existing local
  // builds, then emit a no-op placeholder so the crate still compiles
  // when neither has been built yet.
  let candidates = [
    PathBuf::from("dist-js/index.js"),
    PathBuf::from("guest-js/dist-js/index.js"),
  ];

  let bundle = candidates
    .iter()
    .find(|p| p.exists())
    .map(|p| fs::read_to_string(p).expect("read guest-js bundle"))
    .unwrap_or_else(|| {
      String::from("/* @wdio/dioxus-bridge guest-js not built yet; run `pnpm --filter @wdio/dioxus-bridge build` */")
    });

  fs::write(&out_path, bundle).expect("write OUT_DIR/guest_js_bundle.js");

  println!("cargo:rerun-if-changed=dist-js/index.js");
  println!("cargo:rerun-if-changed=guest-js/dist-js/index.js");
  println!("cargo:rerun-if-changed=guest-js/index.ts");
  println!("cargo:rerun-if-changed=package.json");
  println!("cargo:rerun-if-changed=build.rs");

  // Assert npm-bridge and crate versions are in lockstep on their core
  // version (the part before any `-pre.suffix`). npm uses `-next.N` while
  // crates.io uses `-rc.N`, so a literal string match isn't appropriate —
  // we enforce X.Y.Z agreement and let pre-release suffixes diverge per
  // registry convention.
  if let Ok(npm_pkg) = fs::read_to_string("package.json") {
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
