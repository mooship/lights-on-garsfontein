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
SOURCE=https://raw.githubusercontent.com/mooship/lights-on-garsfontein/main/scripts/mac-sensor.sh
# Short enough that a request already running at SIGTERM, plus pause_for_restart's own, end within
# the 20 seconds launchd waits before SIGKILL.
CURL_TIMEOUT=10
# The loop sleeps a minute and curl may take CURL_TIMEOUT more. A longer gap means the Mac slept or
# the agent was not running, and a power cut could have passed unseen.
MAX_TICK_GAP=150
# How long a stop on the charger (a restart or an update) pauses the Worker for, so the time the
# Mac takes to come back is not logged as an outage. The next run's first heartbeat ends it.
RESTART_PAUSE_SECONDS=900
LOG="$HOME/Library/Logs/lights-on-heartbeat.log"
LOG_MAX_LINES=1000
# Holds the time of the last accepted heartbeat; `status` shows an error only if the log is newer.
LAST_BEAT_FILE="$HOME_DIR/last-heartbeat"
TIME_FORMAT='+%a %d %b %H:%M'
DOMAIN="gui/$(id -u)"

usage() {
  cat >&2 <<EOF
usage: lights-on <command>

  install URL          start reporting to URL (asks for HEARTBEAT_TOKEN)
  pause DURATION       stop reporting, e.g. 30m, 2h or 3d, without logging an outage
  resume               report again now
  status               show what the sensor is doing
  update               install the latest version, keeping the URL and token
  uninstall            stop and remove everything
EOF
  exit 64
}

# Posts to the Worker. On failure, including an HTTP error, writes curl's message with the time to
# stderr (the log, under launchd), so `status` can tell an old error from a current one.
post() {
  if ! err=$(curl -fsS -m "$CURL_TIMEOUT" -X POST -H "@$AUTH_FILE" "$@" 2>&1 >/dev/null); then
    echo "$(date "$TIME_FORMAT") $err" >&2
    return 1
  fi
}

# launchd holds the log open for appending, so it is cut down in place rather than replaced.
trim_log() {
  [ -f "$LOG" ] && [ "$(wc -l <"$LOG")" -gt "$LOG_MAX_LINES" ] || return 0
  kept=$(tail -n "$LOG_MAX_LINES" "$LOG")
  printf '%s\n' "$kept" >"$LOG"
}

on_ac_power() { pmset -g batt | grep -q "'AC Power'"; }

# The pause's end in epoch seconds, or nothing when not paused (an expired pause is cleared).
paused_until() {
  [ -f "$PAUSE_FILE" ] || return 0
  end=$(cat "$PAUSE_FILE")
  if [ "$end" -gt "$(date +%s)" ]; then echo "$end"; else rm -f "$PAUSE_FILE"; fi
}

iso_utc() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }

# Sets the Worker's pause to $1 (a quoted time, or null to end it); further arguments go to curl.
send_pause() {
  pause_end=$1
  shift
  post "$@" -H 'Content-Type: application/json' -d "{\"until\":$pause_end}" "$(cat "$URL_FILE")/api/heartbeat/pause"
}

# launchd sends SIGTERM at a restart, shutdown or logout, and when `update` or `uninstall` stops the
# agent. On the charger the power is on, so the silence until the Mac is back is not an outage.
# A pause from `lights-on pause` is left alone: it already covers the silence, and may be longer.
pause_for_restart() {
  if [ -z "$(paused_until)" ] && on_ac_power; then
    # With CURL_TIMEOUT, inside the 20 seconds launchd waits. Best effort: the network may be gone.
    send_pause "\"$(iso_utc $(($(date +%s) + RESTART_PAUSE_SECONDS)))\"" -m 5 ||
      true # post has logged why
  fi
  exit 0
}

# On battery the Mac may sleep, and by default it stays asleep when the charger returns, so after an
# outage nothing would report until someone woke it. acwake wakes it when the power source changes.
# Skipped where pmset lacks it, and when already on, so an update does not ask for a password.
enable_acwake() {
  pmset -g cap | grep -qw acwake || return 0
  pmset -g | grep -Eq '^ *acwake +1' && return 0
  echo "Setting the Mac to wake when the charger is connected (asks for your Mac password)."
  sudo pmset -a acwake 1
}

# Installs this file as the agent and (re)starts it.
start_agent() {
  # Stopped before the copy: sh reads a script as it runs, so overwriting it mid-loop breaks it.
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # not loaded yet
  mkdir -p "$HOME_DIR" "$(dirname "$PLIST")"
  [ "$0" -ef "$INSTALLED" ] || cp "$0" "$INSTALLED"
  chmod +x "$INSTALLED"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
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
}

case "${1:-}" in
  install)
    url=${2:-}
    case "$url" in
      https://*) url=${url%/} ;;
      *) usage ;;
    esac
    printf 'Paste HEARTBEAT_TOKEN (hidden), then press Return: '
    # Ctrl-C at the prompt would otherwise leave the terminal not showing what is typed.
    trap 'stty echo </dev/tty; exit 130' INT TERM HUP
    stty -echo </dev/tty
    read -r token </dev/tty
    stty echo </dev/tty
    trap - INT TERM HUP
    echo
    [ -n "$token" ] || usage
    mkdir -p "$HOME_DIR"
    echo "$url" >"$URL_FILE"
    (umask 077 && printf 'Authorization: Bearer %s\n' "$token" >"$AUTH_FILE")
    # Checked now, so a wrong URL or token fails here rather than quietly every minute. Ending any
    # pause claims nothing about the power, as a heartbeat sent from the battery would.
    if ! send_pause null; then
      echo "The site refused the token or could not be reached (see above). Nothing was started." >&2
      exit 1
    fi
    start_agent
    echo "Adding the lights-on command to $(dirname "$COMMAND") (asks for your Mac password)."
    sudo mkdir -p "$(dirname "$COMMAND")"
    sudo ln -sf "$INSTALLED" "$COMMAND"
    enable_acwake
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
    send_pause "\"$(iso_utc "$end")\""
    echo "$end" >"$PAUSE_FILE"
    echo "Paused until $(date -r "$end" "$TIME_FORMAT"). Run 'lights-on resume' when home."
    ;;
  resume)
    send_pause null
    rm -f "$PAUSE_FILE"
    if on_ac_power; then
      post "$(cat "$URL_FILE")/api/heartbeat"
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
      echo "Paused until $(date -r "$end" "$TIME_FORMAT")."
    elif on_ac_power; then
      echo "Reporting to $(cat "$URL_FILE") every minute (on the charger)."
    else
      echo "Not reporting: on battery, so the site will record an outage."
    fi
    if [ -f "$LAST_BEAT_FILE" ]; then
      echo "Last heartbeat accepted: $(date -r "$(cat "$LAST_BEAT_FILE")" "$TIME_FORMAT")."
    fi
    if [ -s "$LOG" ] && { [ ! -f "$LAST_BEAT_FILE" ] || [ "$LOG" -nt "$LAST_BEAT_FILE" ]; }; then
      echo "Last error: $(tail -n 1 "$LOG")"
    fi
    ;;
  update)
    if [ ! -f "$URL_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
      echo "Not installed. Install with: lights-on install URL"
      exit 1
    fi
    if [ "$0" -ef "$INSTALLED" ]; then
      # The new version installs itself, so its own update steps are the ones that run. Not exec, so
      # the trap can remove the download: sh has parsed this whole case statement, and exits below
      # before it would read on into this file, which the new version overwrites.
      latest=$(mktemp)
      trap 'rm -f "$latest"' EXIT
      curl -fsSL -m 60 -o "$latest" "$SOURCE"
      sh "$latest" update
      exit
    fi
    start_agent
    [ -L "$COMMAND" ] || sudo ln -sf "$INSTALLED" "$COMMAND"
    enable_acwake
    echo "Updated and reporting again. Try: lights-on status"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true # already stopped
    # Stopping the agent paused the Worker as for a restart, and nothing will report to end it.
    if [ -f "$URL_FILE" ]; then send_pause null || true; fi # post has said why
    rm -f "$PLIST"
    rm -rf "$HOME_DIR"
    if [ -L "$COMMAND" ]; then sudo rm -f "$COMMAND"; fi
    echo "Uninstalled."
    ;;
  run)
    # This shell is the launchd job, so SIGTERM reaches the trap rather than a wrapper.
    caffeinate -s -w $$ &
    trap pause_for_restart TERM
    # When the current unbroken spell on AC power began; empty on battery. Sent as poweredFor, so a
    # heartbeat after the Wi-Fi drops and returns shows the power stayed on.
    powered_since=
    last_tick=0
    # Set while a pause_for_restart from the previous run may still be on the Worker.
    restart_pause=1
    while :; do
      now=$(date +%s)
      if ! on_ac_power; then
        powered_since=
      elif [ -z "$powered_since" ] || [ $((now - last_tick)) -gt "$MAX_TICK_GAP" ]; then
        powered_since=$now
      fi
      last_tick=$now
      if [ -z "$(paused_until)" ] && [ -n "$powered_since" ]; then
        if [ -n "$restart_pause" ] && send_pause null; then restart_pause=; fi
        # A missed beat is retried next minute; post has logged why.
        if post -H 'Content-Type: application/json' -d "{\"poweredFor\":$((now - powered_since))}" \
          "$(cat "$URL_FILE")/api/heartbeat"; then
          date +%s >"$LAST_BEAT_FILE"
          trim_log
        fi
      fi
      # In the background, since sh runs a trap only once a foreground command has finished.
      sleep 60 &
      wait $!
    done
    ;;
  *) usage ;;
esac
