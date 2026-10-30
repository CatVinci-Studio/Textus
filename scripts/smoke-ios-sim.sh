#!/usr/bin/env bash
# Smoke test for the iOS app in the simulator - what building it can't
# show: that it starts and stays up once its page has loaded and called
# into Rust. A command registered on iOS whose state only the desktop
# manages aborts the app here, as it does on a phone.
#
# The app starts as someone who has used it: past onboarding, so the
# window loads its plugins and its menus as it does at every later launch.
#
# Usage: scripts/smoke-ios-sim.sh <Textus.app built for the simulator>
#                                 [--screenshot <out.png>]
#   e.g. src-tauri/gen/apple/build/arm64-sim/Textus.app, from
#   npx tauri ios build --debug --target aarch64-sim --no-sign
set -euo pipefail

app=${1:?the simulator build of Textus.app}
shift
shot=""
if [ "${1:-}" = "--screenshot" ]; then shot=${2:?png path}; fi
id=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$app/Info.plist")

# The first available iPhone; booted if it isn't.
device=$(xcrun simctl list devices available -j | node -e '
  const all = Object.values(JSON.parse(require("fs").readFileSync(0)).devices).flat();
  const phone = all.find((d) => d.name.startsWith("iPhone"));
  if (!phone) process.exit(1);
  console.log(phone.udid);
')
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b >/dev/null

xcrun simctl install "$device" "$app"
data=$(xcrun simctl get_app_container "$device" "$id" data)
support="$data/Library/Application Support/$id"
mkdir -p "$support"
cat >"$support/settings.json" <<'JSON'
{"schemaVersion": 1, "settings": {"language": "en", "languageChosen": true,
 "onboardingShown": true, "levisImportOffered": true}}
JSON

marker=$(mktemp)
xcrun simctl terminate "$device" "$id" 2>/dev/null || true
xcrun simctl launch "$device" "$id" >/dev/null
sleep 20

if [ -n "$shot" ]; then
  xcrun simctl io "$device" screenshot "$shot" >/dev/null 2>&1
fi

running=$(xcrun simctl spawn "$device" launchctl list)
if [[ $running != *"UIKitApplication:$id"* ]]; then
  echo "Textus is not running 20s after launch." >&2
  sleep 5
  report=$(find "$HOME/Library/Logs/DiagnosticReports" -name 'Textus*.ips' \
    -newer "$marker" 2>/dev/null | head -n1)
  if [ -n "$report" ]; then
    echo "Crash report: $report" >&2
    # The panic's message, then the crashed thread's first frames.
    grep -o '"asi" *: *{[^}]*}' "$report" >&2 || true
    tr ',' '\n' <"$report" | grep -m40 '"symbol"' >&2 || true
  fi
  exit 1
fi
echo "Textus is running in the simulator."
