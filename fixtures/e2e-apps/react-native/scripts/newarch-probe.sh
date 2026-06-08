#!/usr/bin/env bash
# New-architecture (Fabric/bridgeless) drivability probe — THROWAWAY (spike/rn-new-arch-probe).
#
# Runs WITHOUT Appium: installs + launches the new-arch APK, then captures ground truth at
# several time points — does Hermes register a /json/list target under Fabric (and its shape),
# does the UiAutomator2 view tree (android:id/content) ever populate, and any Fabric/Hermes
# errors in logcat.
#
# Invoked as a single `bash <file>` from the workflow because the android-emulator-runner runs
# the step's `script:` line-by-line (each line a fresh `sh -c`), so inline shell variables do
# NOT persist across lines — the first inline attempt died at `mkdir ''` for exactly that
# reason. A single bash process keeps OUT/PROBE/PKG/n alive for the whole loop.
set -u

OUT="${GITHUB_WORKSPACE}/e2e/logs/standard-react-native"
mkdir -p "$OUT"
PROBE="$OUT/newarch-probe.log"

# The emulator-runner boots the device before this runs, but adb can briefly drop its daemon
# (seen as "Unable to connect to adb daemon"); wait it back and retry the install once.
adb wait-for-device || true
adb install -r "$RN_APP_PATH" || adb install -r "$RN_APP_PATH" || true

PKG="$(adb shell pm list packages 2>/dev/null | sed 's/package://' | tr -d '\r' | grep -i reactnative | head -1)"
[ -n "$PKG" ] || PKG='com.reactnativee2eapp'
echo "app package: $PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 || true

n=1
while [ "$n" -le 8 ]; do
  {
    echo "===================== probe $n ====================="
    echo "--- adb reverse --list ---"
    adb reverse --list 2>&1 || true
    echo "--- curl /json/list ---"
    curl -s http://localhost:8081/json/list 2>&1 || echo "curl failed"
    echo ""
    echo "--- uiautomator dump (first 6000 chars) ---"
    adb shell uiautomator dump /sdcard/win.xml >/dev/null 2>&1 || true
    adb shell cat /sdcard/win.xml 2>/dev/null | head -c 6000 || true
    echo ""
    echo "--- logcat (RN/Hermes/Fabric/inspector/errors) ---"
    adb logcat -d 2>/dev/null | grep -Ei 'ReactNative|Hermes|Fabric|Bridgeless|inspector|fatal|Exception' | tail -60 || true
    echo ""
  } >> "$PROBE" 2>&1
  n=$((n + 1))
  sleep 12
done

echo "===== PROBE RESULT ====="
cat "$PROBE"
