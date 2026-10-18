#!/bin/sh
# Turns a MacBook on its charger into the heartbeat sensor, as the `lights-on` command. See
# "Sensor" in the README.
#
# It posts only while the Mac draws AC power, so falling back to the battery silences it and the
# Worker opens an outage. caffeinate -s keeps the Mac awake on AC power only, so it sleeps as
# usual on the battery.
set -eu

LABEL=local.lights-on.heartbeat
COMMAND=/usr/local/bin/lights-on
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# launchd cannot read scripts in ~/Documents or ~/Desktop (privacy protection), where a clone
# often lives, so install copies this file somewhere it can.
HOME_DIR="$HOME/Library/Application Support/lights-on"
INSTALLED="$HOME_DIR/lights-on.sh"
URL_FILE="$HOME_DIR/url"
# The token never goes on a command line, where `ps` would show it to every user: curl reads the
# header from this file, which only this account can read.
AUTH_FILE="$HOME_DIR/auth-header"
# Holds the pause's end in epoch seconds; the Worker holds its own copy (/api/heartbeat/pause).
PAUSE_FILE="$HOME_DIR/paused-until"
LOG="$HOME/Library/Logs/lights-on-heartbeat.log"
DOMAIN="gui/$(id -u)"

usage() {
  cat >&2 <<EOF
usage: lights-on <command>

  install URL          start reporting to URL (asks for HEARTBEAT_TOKEN)
  pause DURATION       stop reporting, e.g. 30m, 2h or 3d, without logging an outage
  resume               report again now
  status               show what the sensor is doing
  uninstall            stop and remove everything
EOF
  exit 64
}

# Posts to the Worker; prints the response body, fails on an HTTP error.
post() {
  curl -fsS -m 20 -X POST -H "@$AUTH_FILE" "$@"
}

on_ac_power() { pmset -g batt | grep -q "'AC Power'"; }

# The pause's end in epoch seconds, or nothing when not paused (an expired pause is cleared).
paused_until() {
  [ -f "$PAUSE_FILE" ] || return 0
  end=$(cat "$PAUSE_FILE")
  if [ "$end" -gt "$(date +%s)" ]; then echo "$end"; else rm -f "$PAUSE_FILE"; fi
}

send_pause() {
  post -H 'Content-Type: application/json' -d "{\"until\":$1}" "$(cat "$URL_FILE")/api/heartbeat/pause" >/dev/null
}

case "${1:-}" in
  install)
    url=${2:-}
    case "$url" in
      https://*) url=${url%/} ;;
      *) usage ;;
    esac
    printf 'Paste HEARTBEAT_TOKEN (hidden), then press Return: '
    stty -echo </dev/tty
    read -r token </dev/tty
    stty echo </dev/tty
    echo
    [ -n "$token" ] || usage
    # Stopped before the copy: sh reads a script as it runs, so overwriting it mid-loop breaks it.
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # not loaded yet
    mkdir -p "$HOME_DIR" "$(dirname "$PLIST")"
    [ "$0" -ef "$INSTALLED" ] || cp "$0" "$INSTALLED"
    chmod +x "$INSTALLED"
    echo "$url" >"$URL_FILE"
    (umask 077 && printf 'Authorization: Bearer %s\n' "$token" >"$AUTH_FILE")
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
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Adding the lights-on command to $(dirname "$COMMAND") (asks for your Mac password)."
    sudo mkdir -p "$(dirname "$COMMAND")"
    sudo ln -sf "$INSTALLED" "$COMMAND"
    echo "Installed. Try: lights-on status"
    ;;
  pause)
    duration=${2:-}
    count=${duration%?}
    case "$count" in '' | *[!0-9]*) usage ;; esac
    case "$duration" in
      *m) seconds=$((count * 60)) ;;
      *h) seconds=$((count * 3600)) ;;
      *d) seconds=$((count * 86400)) ;;
      *) usage ;;
    esac
    end=$(($(date +%s) + seconds))
    # The Worker first, so a failed request leaves the sensor reporting rather than silent.
    send_pause "\"$(date -u -r "$end" +%Y-%m-%dT%H:%M:%SZ)\""
    echo "$end" >"$PAUSE_FILE"
    echo "Paused until $(date -r "$end" '+%a %d %b %H:%M'). Run 'lights-on resume' when home."
    ;;
  resume)
    send_pause null
    rm -f "$PAUSE_FILE"
    if on_ac_power; then
      post "$(cat "$URL_FILE")/api/heartbeat" >/dev/null
      echo "Resumed and reporting."
    else
      echo "Resumed. Not reporting until the Mac is on its charger."
    fi
    ;;
  status)
    if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "Not running. Install with: lights-on install URL"
      exit 1
    fi
    end=$(paused_until)
    if [ -n "$end" ]; then
      echo "Paused until $(date -r "$end" '+%a %d %b %H:%M')."
    elif on_ac_power; then
      echo "Reporting to $(cat "$URL_FILE") every minute (on the charger)."
    else
      echo "Not reporting: on battery, so the site will record an outage."
    fi
    if [ -s "$LOG" ]; then
      echo "Last logged error: $(tail -n 1 "$LOG")"
    fi
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # already stopped
    rm -f "$PLIST"
    rm -rf "$HOME_DIR"
    if [ -L "$COMMAND" ]; then sudo rm -f "$COMMAND"; fi
    echo "Uninstalled."
    ;;
  run)
    while :; do
      if [ -z "$(paused_until)" ] && on_ac_power; then
        post "$(cat "$URL_FILE")/api/heartbeat" >/dev/null ||
          true # a missed beat is retried next minute; curl has logged why
      fi
      sleep 60
    done
    ;;
  *) usage ;;
esac
