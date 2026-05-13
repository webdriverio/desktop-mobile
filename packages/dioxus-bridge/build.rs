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
  println!("cargo:rerun-if-changed=build.rs");
}
