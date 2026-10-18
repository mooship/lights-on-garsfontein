#!/bin/sh
# Turns a MacBook on its charger into the heartbeat sensor. See "Sensor" in the README.
#
#   sh scripts/mac-sensor.sh install https://YOUR_DOMAIN
#   sh scripts/mac-sensor.sh uninstall
#
# It posts only while the Mac draws AC power, so falling back to the battery silences it and the
# Worker opens an outage. caffeinate -s keeps the Mac awake on AC power only, so it sleeps as
# usual on the battery.
set -eu

LABEL=local.lights-on.heartbeat
KEYCHAIN_SERVICE=lights-on-heartbeat
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# launchd cannot read scripts in ~/Documents or ~/Desktop (privacy protection), where a clone
# often lives, so install copies this file somewhere it can.
INSTALLED="$HOME/Library/Application Support/lights-on/mac-sensor.sh"
LOG="$HOME/Library/Logs/lights-on-heartbeat.log"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    url=${2:-}
    case "$url" in
      https://*) ;;
      *) echo "usage: $0 install https://YOUR_DOMAIN" >&2; exit 64 ;;
    esac
    echo "Paste HEARTBEAT_TOKEN when asked; it is kept in your login keychain."
    security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" -w
    mkdir -p "$(dirname "$INSTALLED")" "$(dirname "$PLIST")"
    cp "$0" "$INSTALLED"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>/bin/sh</string>
    <string>$INSTALLED</string>
    <string>run</string>
    <string>${url%/}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # not loaded yet
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed. Errors go to $LOG."
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # already stopped
    rm -f "$PLIST" "$INSTALLED"
    security delete-generic-password -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true # already gone
    echo "Uninstalled."
    ;;
  run)
    while :; do
      if pmset -g batt | grep -q "'AC Power'"; then
        token=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w)
        curl -fsS -m 20 -X POST -H "Authorization: Bearer $token" "$2/api/heartbeat" >/dev/null ||
          true # a missed beat is retried next minute; curl has logged why
      fi
      sleep 60
    done
    ;;
  *)
    echo "usage: $0 install https://YOUR_DOMAIN | uninstall" >&2
    exit 64
    ;;
esac
