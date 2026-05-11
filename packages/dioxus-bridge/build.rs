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

  let src = PathBuf::from("guest-js/dist-js/index.js");

  let bundle = if src.exists() {
    fs::read_to_string(&src).expect("read guest-js bundle")
  } else {
    String::from("/* @wdio/dioxus-bridge guest-js not built yet; run `pnpm --filter @wdio/dioxus-bridge build` */")
  };

  fs::write(&out_path, bundle).expect("write OUT_DIR/guest_js_bundle.js");

  println!("cargo:rerun-if-changed=guest-js/dist-js/index.js");
  println!("cargo:rerun-if-changed=guest-js/index.ts");
  println!("cargo:rerun-if-changed=build.rs");
}
