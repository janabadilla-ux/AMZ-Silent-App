#!/bin/bash
# AllStars Tracker — macOS Silent Installer
# Usage: ./install-mac.sh SUPABASE_URL SUPABASE_ANON_KEY PORTAL_URL
# Example: ./install-mac.sh "https://xxx.supabase.co" "eyJhb..." "https://app.hireallstars.com"

set -e

SUPABASE_URL="${1:?ERROR: SUPABASE_URL argument is required}"
SUPABASE_ANON_KEY="${2:?ERROR: SUPABASE_ANON_KEY argument is required}"
PORTAL_URL="${3:-https://app.hireallstars.com}"

DMG_URL="https://YOUR_S3_BUCKET.s3.amazonaws.com/AllStars-Tracker.dmg"
TMP_DMG="/tmp/allstars-tracker-$RANDOM.dmg"
APP_NAME="AllStars Tracker"
APP_DEST="/Applications/${APP_NAME}.app"
CONFIG_DIR="${HOME}/Library/Application Support/allstars-tracker"

echo "Downloading AllStars Tracker..."
curl -fsSL "${DMG_URL}" -o "${TMP_DMG}"

echo "Mounting disk image..."
MOUNT_POINT=$(hdiutil attach -nobrowse -quiet "${TMP_DMG}" | grep -E 'Apple_HFS|APFS' | awk '{print $NF}')

echo "Installing app..."
if [ -d "${APP_DEST}" ]; then
  rm -rf "${APP_DEST}"
fi
cp -R "${MOUNT_POINT}/${APP_NAME}.app" "${APP_DEST}"

hdiutil detach "${MOUNT_POINT}" -quiet
rm -f "${TMP_DMG}"

echo "Writing config..."
mkdir -p "${CONFIG_DIR}"
cat > "${CONFIG_DIR}/config.json" << CONFIG
{
  "supabaseUrl": "${SUPABASE_URL}",
  "supabaseAnonKey": "${SUPABASE_ANON_KEY}",
  "portalUrl": "${PORTAL_URL}"
}
CONFIG

echo "Adding to Login Items..."
osascript << APPLESCRIPT
tell application "System Events"
  if not (exists login item "${APP_NAME}") then
    make new login item at end with properties {path:"${APP_DEST}", hidden:true}
  end if
end tell
APPLESCRIPT

echo "Launching app..."
open -g "${APP_DEST}" 2>/dev/null || true

echo "AllStars Tracker installed successfully."
echo "NOTE: Grant Accessibility access in System Preferences > Privacy & Security > Accessibility"
