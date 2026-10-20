import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_PATH, HEARTBEAT_PAUSE_PATH } from '../../shared/paths';

const SCRIPT = join(import.meta.dirname, '../../scripts/mac-sensor.sh');
const RESTART_PAUSE_SECONDS = Number(/^RESTART_PAUSE_SECONDS=(\d+)$/m.exec(readFileSync(SCRIPT, 'utf8'))?.[1]);
const URL = 'https://garsfontein.example';

/**
 * Starts `lights-on run` with macOS's tools stubbed, sends it SIGTERM (as launchd does at a restart)
 * once it is waiting out its first minute, and returns the shell's pid and every stubbed call. The
 * signal comes from sh, not Node, so it is a real signal on Windows too.
 */
async function terminateRun({ onAc, paused = false }: { onAc: boolean; paused?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'lights-on-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  const appDir = join(home, 'Library/Application Support/lights-on');
  const calls = join(dir, 'calls');
  mkdirSync(bin);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'url'), `${URL}\n`);
  writeFileSync(join(appDir, 'auth-header'), 'Authorization: Bearer test\n');
  if (paused) writeFileSync(join(appDir, 'paused-until'), `${Math.floor(Date.now() / 1000) + 3600}\n`);
  const stub = (name: string, body = '') => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >>"$CALLS"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('pmset', `echo "Now drawing from '${onAc ? 'AC Power' : 'Battery Power'}'"`);
  stub('curl');
  stub('caffeinate');
  stub('sleep', 'exec /usr/bin/sleep "$@"');
  // BSD date's -r takes epoch seconds; GNU date's takes a file.
  writeFileSync(
    join(bin, 'date'),
    '#!/bin/sh\nif [ "$2" = -r ]; then exec /usr/bin/date -u -d "@$3" "$4"; fi\nexec /usr/bin/date "$@"\n',
  );
  chmodSync(join(bin, 'date'), 0o755);
  const driver = `
    sh "$SCRIPT" run >/dev/null 2>&1 & pid=$!
    until grep -q '^sleep' "$CALLS" 2>/dev/null; do /usr/bin/sleep 0.1; done
    kill -TERM $pid
    wait $pid
    echo $pid`;
  const { stdout } = await promisify(execFile)('sh', ['-c', driver], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, SCRIPT, CALLS: calls },
    timeout: 10_000,
  });
  const lines = readFileSync(calls, 'utf8').trim().split('\n');
  return { pid: stdout.trim(), lines, curl: lines.filter((l) => l.startsWith('curl ')) };
}

describe('lights-on run', () => {
  it('keeps the Mac awake for as long as its own shell runs', async () => {
    const { pid, lines } = await terminateRun({ onAc: true });
    expect(lines).toContain(`caffeinate -s -w ${pid}`);
  });

  it('ends a pause left by a restart with its first heartbeat', async () => {
    const { curl } = await terminateRun({ onAc: true });
    expect(curl[0]).toContain(`-d {"until":null} ${URL}${HEARTBEAT_PAUSE_PATH}`);
    expect(curl[1]).toContain(`-d {"poweredFor":0} ${URL}${HEARTBEAT_PATH}`);
  });

  it('pauses the Worker long enough to restart when stopped on the charger', async () => {
    const stoppedAt = Date.now();
    const { curl } = await terminateRun({ onAc: true });
    expect(curl).toHaveLength(3);
    const until = /-d \{"until":"([^"]+)"\} (\S+)$/.exec(curl[2] ?? '');
    expect(until?.[2]).toBe(`${URL}${HEARTBEAT_PAUSE_PATH}`);
    const pausedFor = Date.parse(until?.[1] ?? '') - stoppedAt;
    expect(pausedFor).toBeGreaterThan((RESTART_PAUSE_SECONDS - 5) * 1000);
    expect(pausedFor).toBeLessThan((RESTART_PAUSE_SECONDS + 15) * 1000);
  });

  it('sends nothing when stopped on battery, so an outage still opens', async () => {
    const { curl } = await terminateRun({ onAc: false });
    expect(curl).toEqual([]);
  });

  it('leaves a pause set with lights-on pause alone', async () => {
    const { curl } = await terminateRun({ onAc: true, paused: true });
    expect(curl).toEqual([]);
  });
});
