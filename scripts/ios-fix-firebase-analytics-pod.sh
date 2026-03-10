#!/usr/bin/env bash
set -euo pipefail

PODFILE="ios/App/Podfile"
TARGET_LINE="pod 'CapacitorFirebaseAnalytics', :path => '../../node_modules/@capacitor-firebase/analytics', :subspecs => ['Analytics']"

if [[ ! -f "$PODFILE" ]]; then
  echo "[ios-fix] Podfile introuvable: $PODFILE"
  exit 1
fi

# Normalize any existing CapacitorFirebaseAnalytics pod line to include Analytics subspec
if grep -q "pod 'CapacitorFirebaseAnalytics'" "$PODFILE"; then
  sed -i '' "s|pod 'CapacitorFirebaseAnalytics'.*|  $TARGET_LINE|g" "$PODFILE"
else
  # If missing for any reason, insert inside capacitor_pods block after CapacitorCordova line
  awk -v line="  $TARGET_LINE" '
    /pod '\''CapacitorCordova'\''/ { print; print line; next }
    { print }
  ' "$PODFILE" > "$PODFILE.tmp"
  mv "$PODFILE.tmp" "$PODFILE"
fi

echo "[ios-fix] Podfile FirebaseAnalytics subspec OK."

