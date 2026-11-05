// Pretends to be the racer: applies squad:controls / physics:set and streams plausible telemetry back.
import {
  DEFAULT_CAR_PHYSICS,
  TELEMETRY_INTERVAL_MS,
  assessBigJump,
  clampPhysics,
  mapSquadControlsToPhysics,
  squadControlsEqual,
  type CarPhysicsParams,
  type SquadControls,
} from '../../../shared/protocol';
import { formatControls, formatPeers, formatPhysics, formatTelemetry } from '../format';
import { createThrottledLog } from '../throttled-log';
import { numberArg, onStop, parseToolArgs } from './args';
import { connectToolClient } from './client';
import { createFakeCar } from './fake-car';

const USAGE = `Simulated racer: applies dashboard controls and streams game:state + game:telemetry.

Usage: npm run sim:game -- [--url ws://localhost:8787] [--hz 10] [--duration 0] [--name sim-game]

  --url        Relay URL (host, host:port or ws://…)
  --hz         Telemetry rate (default ${1000 / TELEMETRY_INTERVAL_MS})
  --duration   Stop after this many seconds (default 0 = until Ctrl+C)
`;

const { values } = parseToolArgs(USAGE, {
  hz: { type: 'string' },
  duration: { type: 'string' },
  name: { type: 'string', default: 'sim-game' },
});
const hz = numberArg(values.hz, 'hz', 1000 / TELEMETRY_INTERVAL_MS, 1, 60);
const durationSec = numberArg(values.duration, 'duration', 0, 0, 86_400);

let controls: SquadControls | null = null;
let physics: CarPhysicsParams = { ...DEFAULT_CAR_PHYSICS };
const counts = { controls: 0, physicsSet: 0, state: 0, telemetry: 0 };
const applyLog = createThrottledLog(1000, (line) => console.log(line));

function physicsEqual(a: CarPhysicsParams, b: CarPhysicsParams): boolean {
  return (Object.keys(a) as (keyof CarPhysicsParams)[]).every((k) => a[k] === b[k]);
}

function publishState(): void {
  if (client.send({ type: 'game:state', physics, controls })) counts.state += 1;
}

/** Dashboard controls are authoritative: they remap every param, discarding earlier physics:set patches. */
function applyControls(next: SquadControls, source: string): void {
  const nextPhysics = mapSquadControlsToPhysics(next);
  if (squadControlsEqual(next, controls) && physicsEqual(nextPhysics, physics)) return;
  controls = next;
  physics = nextPhysics;
  publishState();
  const jump = assessBigJump(physics);
  applyLog.push(
    (n) =>
      `applied ${source}: ${formatControls(next)} → top ~${jump.topSpeedKmh.toFixed(0)} km/h, ` +
      `jump ${jump.verdict}${n > 1 ? `  [${n} updates/s]` : ''}`,
  );
}

const client = connectToolClient({
  url: values.url,
  role: 'game',
  name: values.name,
  reconnect: true,
  onOpen: () => console.log(`connected to ${client.url}`),
  onClose: (code, reason, retryInMs) =>
    console.log(
      `disconnected (${code}${reason ? ` ${reason}` : ''})${retryInMs !== null ? `, retrying in ${retryInMs} ms` : ''}`,
    ),
  onError: (err) => console.log(`socket error: ${err.message}`),
  onMessage: (message) => {
    switch (message.type) {
      case 'server:welcome':
        console.log(`welcome: id ${message.clientId}, role ${message.role}, peers ${formatPeers(message.peers)}`);
        if (message.snapshot.controls) applyControls(message.snapshot.controls, 'snapshot');
        else publishState();
        return;
      case 'server:presence':
        console.log(`presence: ${formatPeers(message.peers)}`);
        return;
      case 'server:error':
        console.log(`server error ${message.code}: ${message.message}`);
        return;
      case 'squad:controls':
        counts.controls += 1;
        applyControls(message.controls, `controls from ${message.from ?? '?'}`);
        return;
      case 'physics:set': {
        counts.physicsSet += 1;
        const next = clampPhysics({ ...physics, ...message.params });
        if (physicsEqual(next, physics)) return;
        physics = next;
        publishState();
        console.log(`applied physics:set from ${message.from ?? '?'}: ${formatPhysics(message.params)}`);
        return;
      }
      default:
        return;
    }
  },
});

const car = createFakeCar();
let lastTick = performance.now();
let lastPrint = 0;
const timer = setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.5, (now - lastTick) / 1000);
  lastTick = now;
  const telemetry = car.step(dt, physics);
  if (client.send({ type: 'game:telemetry', telemetry })) counts.telemetry += 1;
  if (now - lastPrint >= 1000) {
    lastPrint = now;
    console.log(`telemetry → ${formatTelemetry(telemetry)}`);
  }
}, 1000 / hz);

onStop(durationSec, (reason) => {
  clearInterval(timer);
  applyLog.cancel();
  console.log(
    `stopping (${reason}): received ${counts.controls} squad:controls, ${counts.physicsSet} physics:set; ` +
      `sent ${counts.state} game:state, ${counts.telemetry} game:telemetry`,
  );
  client.close();
  setTimeout(() => process.exit(0), 100);
});
