import { execFile } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_PATH, HEARTBEAT_PAUSE_PATH } from '../../shared/paths';

const SCRIPT = join(import.meta.dirname, '../../scripts/mac-sensor.sh');
const RESTART_PAUSE_SECONDS = Number(/^RESTART_PAUSE_SECONDS=(\d+)$/m.exec(readFileSync(SCRIPT, 'utf8'))?.[1]);
/** How long launchd waits after SIGTERM before SIGKILL (ExitTimeOut's default). */
const LAUNCHD_EXIT_TIMEOUT_SECONDS = 20;
const URL = 'https://garsfontein.example';
/** How long one script run may take; spawning shells is slow on Windows when the suite runs in parallel. */
const RUN_TIMEOUT_MS = 10_000;
// A test runs up to three scripts, each allowed RUN_TIMEOUT_MS.
vi.setConfig({ testTimeout: 3 * RUN_TIMEOUT_MS });
/** The message the curl stub prints when told to fail. */
const CURL_ERROR = 'curl: (22) The requested URL returned error: 401';

/**
 * A home with the sensor installed and macOS's tools stubbed: each stub records its call in `calls`.
 * The curl stub fails when `failCurl` is set, and saves a copy of the script for `-o`. The launchctl
 * stub keeps a stopped agent listed for `stoppingChecks` more prints, and refuses to bootstrap it
 * until then, as launchd does while the old run is still exiting.
 */
function sandbox({ onAc = true, paused = false, failCurl = false, installed = true, stoppingChecks = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lights-on-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  const tmp = join(dir, 'tmp');
  const appDir = join(home, 'Library/Application Support/lights-on');
  const log = join(home, 'Library/Logs/lights-on-heartbeat.log');
  const calls = join(dir, 'calls');
  for (const d of [bin, tmp, appDir, join(home, 'Library/Logs')]) mkdirSync(d, { recursive: true });
  if (installed) {
    writeFileSync(join(appDir, 'url'), `${URL}\n`);
    writeFileSync(join(appDir, 'auth-header'), 'Authorization: Bearer test\n');
  }
  if (paused) writeFileSync(join(appDir, 'paused-until'), `${Math.floor(Date.now() / 1000) + 3600}\n`);
  const stub = (name: string, body = '') => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >>"$CALLS"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('pmset', `echo "Now drawing from '${onAc ? 'AC Power' : 'Battery Power'}'"`);
  stub(
    'curl',
    failCurl
      ? `echo '${CURL_ERROR}' >&2; exit 22`
      : 'while [ $# -gt 0 ]; do [ "$1" = -o ] && cp "$SCRIPT" "$2"; shift; done',
  );
  stub('caffeinate');
  if (installed) writeFileSync(`${calls}.loaded`, '');
  stub(
    'launchctl',
    `stopping=$(cat "$CALLS.stopping" 2>/dev/null || echo 0)
case "$1" in
  bootout) [ -f "$CALLS.loaded" ] || exit 3; rm "$CALLS.loaded"; echo ${stoppingChecks} >"$CALLS.stopping" ;;
  print)
    if [ "$stopping" -gt 0 ]; then echo $((stopping - 1)) >"$CALLS.stopping"; else [ -f "$CALLS.loaded" ] || exit 113; fi ;;
  bootstrap)
    if [ "$stopping" -gt 0 ] || [ -f "$CALLS.loaded" ]; then echo 'Bootstrap failed: 5: Input/output error' >&2; exit 5; fi
    : >"$CALLS.loaded" ;;
esac`,
  );
  stub('sudo');
  // terminateRun signals the run loop during its minute's sleep; start_agent's one-second polls
  // need no real wait.
  stub('sleep', '[ "$1" = 1 ] || exec /usr/bin/sleep "$@"');
  // BSD date's -r takes epoch seconds; GNU date's takes a file.
  stub(
    'date',
    `n=$#
for a in "$@"; do
  if [ "$a" = -r ]; then a=-d; epoch=1; elif [ -n "\${epoch:-}" ]; then a="@$a"; epoch=; fi
  set -- "$@" "$a"
done
shift $n
exec /usr/bin/date "$@"`,
  );
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, SCRIPT, CALLS: calls };
  const run = async (script: string) =>
    (await promisify(execFile)('sh', ['-c', script], { env, timeout: RUN_TIMEOUT_MS })).stdout;
  const recorded = () => readFileSync(calls, { encoding: 'utf8', flag: 'a+' }).trim().split('\n').filter(Boolean);
  const curl = () => recorded().filter((l) => l.startsWith('curl '));
  return { appDir, log, tmp, run, recorded, curl };
}

/**
 * Starts `lights-on run`, sends it SIGTERM (as launchd does at a restart) once it is waiting out its
 * first minute, and returns the shell's pid and what it wrote to stderr (launchd's log). The signal
 * comes from sh, not Node, so it is a real signal on Windows too.
 */
async function terminateRun(box: ReturnType<typeof sandbox>) {
  const stderr = join(box.tmp, 'stderr');
  const pid = await box.run(`
    sh "$SCRIPT" run >/dev/null 2>"${stderr}" & pid=$!
    until grep -q '^sleep' "$CALLS" 2>/dev/null; do /usr/bin/sleep 0.1; done
    kill -TERM $pid
    wait $pid
    echo $pid`);
  return { pid: pid.trim(), stderr: readFileSync(stderr, 'utf8') };
}

/** The timeout curl applies: the last -m wins. */
const timeoutOf = (call: string) => Number([...call.matchAll(/ -m (\d+)/g)].at(-1)?.[1]);

describe('lights-on run', () => {
  it('keeps the Mac awake for as long as its own shell runs', async () => {
    const box = sandbox();
    const { pid } = await terminateRun(box);
    expect(box.recorded()).toContain(`caffeinate -s -w ${pid}`);
  });

  it('ends a pause left by a restart with its first heartbeat', async () => {
    const box = sandbox();
    await terminateRun(box);
    expect(box.curl()[0]).toContain(`-d {"until":null} ${URL}${HEARTBEAT_PAUSE_PATH}`);
    expect(box.curl()[1]).toContain(`-d {"poweredFor":0} ${URL}${HEARTBEAT_PATH}`);
  });

  it('pauses the Worker long enough to restart when stopped on the charger', async () => {
    const box = sandbox();
    const stoppedAt = Date.now();
    await terminateRun(box);
    const curl = box.curl();
    expect(curl).toHaveLength(3);
    const until = /-d \{"until":"([^"]+)"\} (\S+)$/.exec(curl[2] ?? '');
    expect(until?.[2]).toBe(`${URL}${HEARTBEAT_PAUSE_PATH}`);
    const pausedFor = Date.parse(until?.[1] ?? '') - stoppedAt;
    expect(pausedFor).toBeGreaterThan((RESTART_PAUSE_SECONDS - 5) * 1000);
    expect(pausedFor).toBeLessThan((RESTART_PAUSE_SECONDS + 15) * 1000);
  });

  it('sends that pause before launchd kills it, even when stopped mid-heartbeat', async () => {
    const box = sandbox();
    await terminateRun(box);
    const [, heartbeat = '', pause = ''] = box.curl();
    expect(timeoutOf(heartbeat) + timeoutOf(pause)).toBeLessThan(LAUNCHD_EXIT_TIMEOUT_SECONDS);
  });

  it('sends nothing when stopped on battery, so an outage still opens', async () => {
    const box = sandbox({ onAc: false });
    await terminateRun(box);
    expect(box.curl()).toEqual([]);
  });

  it('leaves a pause set with lights-on pause alone', async () => {
    const box = sandbox({ paused: true });
    await terminateRun(box);
    expect(box.curl()).toEqual([]);
  });

  it('logs a failed request with the time, so status can tell an old error from a current one', async () => {
    const { stderr } = await terminateRun(sandbox({ failCurl: true }));
    expect(stderr).toMatch(new RegExp(`^\\w{3} \\d{2} \\w{3} \\d{2}:\\d{2} ${escapeRegExp(CURL_ERROR)}$`, 'm'));
  });
});

describe('the log', () => {
  it('is trimmed to its newest lines after an accepted heartbeat', async () => {
    const box = sandbox();
    const max = Number(/^LOG_MAX_LINES=(\d+)$/m.exec(readFileSync(SCRIPT, 'utf8'))?.[1]);
    const lines = Array.from({ length: max + 50 }, (_, i) => `line ${i}`);
    writeFileSync(box.log, `${lines.join('\n')}\n`);
    await terminateRun(box);
    expect(readFileSync(box.log, 'utf8').trim().split('\n')).toEqual(lines.slice(-max));
  });
});

describe('lights-on status', () => {
  it('shows when a heartbeat was last accepted', async () => {
    const box = sandbox();
    await terminateRun(box);
    expect(await box.run('sh "$SCRIPT" status')).toMatch(/^Last heartbeat accepted: \w{3} \d{2} \w{3} \d{2}:\d{2}\.$/m);
  });

  it('shows the logged error only when it is newer than the last accepted heartbeat', async () => {
    const box = sandbox();
    await terminateRun(box);
    const accepted = readdirSync(box.appDir).find((f) => f.startsWith('last-'));
    expect(accepted).toBeDefined();
    writeFileSync(box.log, `Mon 19 Oct 10:00 ${CURL_ERROR}\n`);
    const hour = Date.now() / 1000 - 3600;
    utimesSync(box.log, hour, hour);
    expect(await box.run('sh "$SCRIPT" status')).not.toContain(CURL_ERROR);
    utimesSync(join(box.appDir, accepted ?? ''), hour - 60, hour - 60);
    expect(await box.run('sh "$SCRIPT" status')).toContain(`Last error: Mon 19 Oct 10:00 ${CURL_ERROR}`);
  });
});

describe('lights-on update', () => {
  it('removes the download once the new version has installed itself', async () => {
    const box = sandbox();
    copyFileSync(SCRIPT, join(box.appDir, 'lights-on.sh'));
    await box.run(`sh "${join(box.appDir, 'lights-on.sh')}" update`);
    expect(box.recorded()).toContainEqual(expect.stringMatching(/^launchctl bootstrap /));
    expect(readdirSync(box.tmp)).toEqual([]);
  });

  it('starts the agent again even when the old one is still exiting', async () => {
    const box = sandbox({ stoppingChecks: 2 });
    copyFileSync(SCRIPT, join(box.appDir, 'lights-on.sh'));
    await box.run(`sh "${join(box.appDir, 'lights-on.sh')}" update`);
    expect(await box.run('sh "$SCRIPT" status')).not.toMatch(/^Not running/m);
  });
});

describe('lights-on uninstall', () => {
  it('ends the pause the stopping agent left, so the site does not wait it out', async () => {
    const box = sandbox();
    await box.run('sh "$SCRIPT" uninstall');
    expect(box.curl()).toEqual([expect.stringContaining(`-d {"until":null} ${URL}${HEARTBEAT_PAUSE_PATH}`)]);
  });

  it('sends nothing when it was never installed', async () => {
    const box = sandbox({ installed: false });
    await box.run('sh "$SCRIPT" uninstall');
    expect(box.curl()).toEqual([]);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
