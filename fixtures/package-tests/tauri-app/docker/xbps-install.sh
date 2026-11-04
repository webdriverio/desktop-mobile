#!/bin/sh
# Installed as /usr/local/bin/xbps-install, ahead of /usr/bin on PATH, so every install in the image
# goes through it. It installs from Fastly's CDN mirror, and if a download fails or stalls, switches
# to repo-default and tries again; later installs then use repo-default too. xbps checks every
# package's signature, whichever mirror sends it.
conf_dir=/etc/xbps.d
# The mirror in use; xbps reads only *.conf files here
state="$conf_dir/.mirror"
log=$(mktemp)
status_file=$(mktemp)
trap 'rm -f "$log" "$status_file"' EXIT

use_mirror() {
  sed -i "s|https://[^/]*/|https://$1/|g" "$conf_dir"/*-repository-*.conf && echo "$1" >"$state"
}

# The time limit turns a stalled download into a failure, which then falls back
attempt() {
  { timeout 900 /usr/bin/xbps-install "$@"; echo $? >"$status_file"; } 2>&1 | tee "$log"
  return "$(cat "$status_file")"
}

if [ ! -f "$state" ]; then
  mkdir -p "$conf_dir" && cp /usr/share/xbps.d/*-repository-*.conf "$conf_dir"/ &&
    use_mirror repo-fastly.voidlinux.org || exit 1
fi

attempt "$@" && exit 0
status=$?
# Other errors, such as a missing package, would fail the same way on repo-default
if [ "$(cat "$state")" != repo-fastly.voidlinux.org ] ||
  { [ "$status" -ne 124 ] && ! grep -qi 'failed to \(fetch\|download\)' "$log"; }; then
  exit "$status"
fi
echo 'Fastly mirror failed; retrying from repo-default' >&2
use_mirror repo-default.voidlinux.org || exit 1
attempt -S "$@"
