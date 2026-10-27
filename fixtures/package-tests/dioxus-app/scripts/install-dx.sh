#!/usr/bin/env bash
# Installs the dx matching the dioxus version in Cargo.lock: with cargo-binstall when
# it's on PATH, as in CI, or by compiling dx with cargo install.
set -euo pipefail

cd "$(dirname "$0")/.."

dioxus_version=$(awk -F'"' '/^name = "dioxus"/ { getline; print $2; exit }' Cargo.lock)
if [ -z "$dioxus_version" ]; then
  echo 'ERROR: could not read the dioxus version from Cargo.lock.' >&2
  exit 1
fi

if command -v cargo-binstall >/dev/null 2>&1; then
  cargo binstall dioxus-cli --version "$dioxus_version" --no-confirm
else
  cargo install dioxus-cli --version "$dioxus_version" --locked
fi
