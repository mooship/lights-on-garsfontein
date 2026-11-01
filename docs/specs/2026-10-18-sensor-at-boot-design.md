# Start the Mac sensor at boot: draft design

18 October 2026. **Draft, not approved.** It needs the operator's answers to the open questions below before anything is built. Claude wrote it while the operator was away and taking no questions.

## Intent

The Mac sensor (`scripts/mac-sensor.sh`) runs as a launch **agent**, so it reports only while the operator is logged in. A restart, from a macOS update or from a battery that ran flat in a long outage, leaves the Mac at the login screen, and the sensor stays silent. The site shows OFF and records a false outage until someone logs in. Starting the sensor at boot would close that gap.

## Why this is not built yet

- **FileVault decides whether it can help at all.** With FileVault on, a restarted Mac waits for a password before the data volume unlocks, and nothing installed in `/Library` runs until then, the Wi-Fi included. Starting at boot gains nothing in that case. Without FileVault, a launch **daemon** in `/Library/LaunchDaemons` would run at the login screen.
- **It changes the live sensor's trust model.** A daemon runs as root, and the token file and script would move out of the operator's home folder into root-owned locations. `lights-on update` would need a migration path from the agent, and a mistake there silences the live sensor.
- **It cannot be tested here.** There is no macOS runner. The `run` loop and `acwake` were tested with stubs only.
- **Wake after a flat battery is separate.** Even as a daemon, the Mac first has to power on when the charger returns. `acwake` (#16) covers a sleeping Mac, not one that is off.

## Open questions for the operator

1. Is FileVault on (`fdesetup status`)? If it is, stop here: this is not worth building.
2. After a flat battery, does the Mac power on by itself when the charger is connected, or only when the lid is opened or the power button pressed?
3. Is a root-owned daemon, holding the heartbeat token in `/Library`, acceptable on this Mac?

## Sketch, if the answers allow it

- `lights-on install` and `update` gain a daemon mode that installs `/Library/LaunchDaemons/local.lights-on.heartbeat.plist` (asks for the password once), with the script and token in a root-only directory such as `/Library/Application Support/lights-on/` (mode 700).
- `update` moves an existing agent install to the daemon: it stops the agent, copies the URL and token across, and removes the agent's plist and files.
- `caffeinate -s`, the AC check and the `poweredFor` loop stay as they are. `pmset` and `curl` work the same as root.
- `status`, `pause`, `resume` and `uninstall` act on the daemon, using `sudo` where they must.
