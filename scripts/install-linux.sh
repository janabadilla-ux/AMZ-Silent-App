#!/bin/bash
# AllStars Tracker — Linux Silent Installer
# Usage: ./install-linux.sh SUPABASE_URL SUPABASE_ANON_KEY PORTAL_URL

set -e

SUPABASE_URL="${1:?ERROR: SUPABASE_URL argument is required}"
SUPABASE_ANON_KEY="${2:?ERROR: SUPABASE_ANON_KEY argument is required}"
PORTAL_URL="${3:-https://app.hireallstars.com}"

APPIMAGE_URL="https://YOUR_S3_BUCKET.s3.amazonaws.com/AllStars-Tracker.AppImage"
INSTALL_DIR="${HOME}/.local/share/allstars-tracker"
CONFIG_DIR="${HOME}/.config/allstars-tracker"
AUTOSTART_DIR="${HOME}/.config/autostart"
APPIMAGE_PATH="${INSTALL_DIR}/AllStars-Tracker.AppImage"

echo "Downloading AllStars Tracker..."
mkdir -p "${INSTALL_DIR}"
wget -q --show-progress -O "${APPIMAGE_PATH}" "${APPIMAGE_URL}"
chmod +x "${APPIMAGE_PATH}"

echo "Writing config..."
mkdir -p "${CONFIG_DIR}"
cat > "${CONFIG_DIR}/config.json" << CONFIG
{
  "supabaseUrl": "${SUPABASE_URL}",
  "supabaseAnonKey": "${SUPABASE_ANON_KEY}",
  "portalUrl": "${PORTAL_URL}"
}
CONFIG

echo "Creating autostart entry..."
mkdir -p "${AUTOSTART_DIR}"
cat > "${AUTOSTART_DIR}/allstars-tracker.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=AllStars Tracker
Exec=${APPIMAGE_PATH} --no-sandbox
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
Comment=AllStars productivity tracker
DESKTOP

echo "Launching app..."
nohup "${APPIMAGE_PATH}" --no-sandbox > /dev/null 2>&1 &

echo "AllStars Tracker installed and started."
