import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SERVER_PORT, HEARTBEAT_INTERVAL_MS } from '../../shared/protocol';
import { formatBanner } from '../src/banner';
import { UsageError, resolveCliOptions } from '../src/options';
import { createThrottledLog } from '../src/throttled-log';

describe('resolveCliOptions', () => {
  it('defaults to DEFAULT_SERVER_PORT on 0.0.0.0', () => {
    assert.deepEqual(resolveCliOptions([], {}), {
      port: DEFAULT_SERVER_PORT,
      host: '0.0.0.0',
      heartbeatMs: HEARTBEAT_INTERVAL_MS,
      quiet: false,
      help: false,
    });
  });

  it('port precedence: --port, then SQUAD_PORT, then PORT', () => {
    assert.equal(resolveCliOptions([], { PORT: '9001' }).port, 9001);
    assert.equal(resolveCliOptions([], { PORT: '9001', SQUAD_PORT: '9002' }).port, 9002);
    assert.equal(resolveCliOptions(['--port', '9003'], { PORT: '9001', SQUAD_PORT: '9002' }).port, 9003);
    assert.equal(resolveCliOptions(['--port=0'], {}).port, 0);
  });

  it('parses --host, --heartbeat and -q', () => {
    const o = resolveCliOptions(['--host', '127.0.0.1', '--heartbeat', '2500', '-q'], {});
    assert.equal(o.host, '127.0.0.1');
    assert.equal(o.heartbeatMs, 2500);
    assert.equal(o.quiet, true);
  });

  it('rejects bad ports, bad heartbeats and unknown flags with UsageError', () => {
    assert.throws(() => resolveCliOptions(['--port', 'abc'], {}), UsageError);
    assert.throws(() => resolveCliOptions(['--port', '70000'], {}), UsageError);
    assert.throws(() => resolveCliOptions([], { SQUAD_PORT: '-1' }), UsageError);
    assert.throws(() => resolveCliOptions(['--heartbeat', '5'], {}), UsageError);
    assert.throws(() => resolveCliOptions(['--verbose'], {}), UsageError);
  });
});

describe('formatBanner', () => {
  it('lists every LAN IPv4 as ws://<ip>:<port>', () => {
    const banner = formatBanner({
      host: '0.0.0.0',
      port: 8787,
      lan: [
        { interfaceName: 'en0', address: '192.168.1.23' },
        { interfaceName: 'en5', address: '10.0.0.7' },
      ],
    });
    assert.match(banner, /ws:\/\/192\.168\.1\.23:8787 +\(en0\)/);
    assert.match(banner, /ws:\/\/10\.0\.0\.7:8787 +\(en5\)/);
    assert.match(banner, /http:\/\/localhost:8787\/health/);
  });

  it('explains when the relay is not reachable from the LAN', () => {
    assert.match(formatBanner({ host: '0.0.0.0', port: 1, lan: [] }), /No LAN IPv4 address/);
    assert.match(formatBanner({ host: '127.0.0.1', port: 1, lan: [] }), /--host 0\.0\.0\.0/);
  });
});

describe('createThrottledLog', () => {
  it('prints the first event at once, then at most one summary per interval ending on the last value', async () => {
    const lines: string[] = [];
    const log = createThrottledLog(80, (line) => lines.push(line));
    log.push(() => 'v0');
    for (let i = 1; i <= 5; i++) log.push((n) => `v${i} x${n}`);
    assert.deepEqual(lines, ['v0']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(lines, ['v0', 'v5 x5']);
    log.push(() => 'late');
    log.cancel();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(lines, ['v0', 'v5 x5']);
  });
});
