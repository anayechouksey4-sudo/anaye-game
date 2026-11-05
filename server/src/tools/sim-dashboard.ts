// Pretends to be the SquadHQ phone: sweeps the three sliders smoothly and prints what the game reports back.
import {
  CONTROLS_SEND_INTERVAL_MS,
  SQUAD_CONTROL_SPECS,
  assessBigJump,
  snapToSpec,
  squadControlsEqual,
  type CarPhysicsParams,
  type GameTelemetry,
  type SquadControls,
} from '../../../shared/protocol';
import { formatControls, formatPeers, formatTelemetry } from '../format';
import { numberArg, onStop, parseToolArgs } from './args';
import { connectToolClient } from './client';

const USAGE = `Simulated SquadHQ dashboard: sweeps Front Wing Aero, Engine Tier and Chassis Balance.

Usage: npm run sim:dashboard -- [--url ws://localhost:8787] [--hz 30] [--duration 0] [--name sim-dashboard]

  --url        Relay URL (host, host:port or ws://…)
  --hz         Slider update rate (default ${Math.round(1000 / CONTROLS_SEND_INTERVAL_MS)})
  --duration   Stop after this many seconds (default 0 = until Ctrl+C)
`;

const { values } = parseToolArgs(USAGE, {
  hz: { type: 'string' },
  duration: { type: 'string' },
  name: { type: 'string', default: 'sim-dashboard' },
});
const hz = numberArg(values.hz, 'hz', 1000 / CONTROLS_SEND_INTERVAL_MS, 1, 120);
const durationSec = numberArg(values.duration, 'duration', 0, 0, 86_400);

/** Incommensurate periods so the three sliders drift through every combination over time. */
function slidersAt(tSec: number): SquadControls {
  const wave = (periodSec: number, phase: number): number => Math.sin((2 * Math.PI * tSec) / periodSec + phase);
  return {
    frontWingAero: snapToSpec(50 + 50 * wave(8, 0), SQUAD_CONTROL_SPECS.frontWingAero),
    engineTier: snapToSpec(3 + 2.4 * wave(11, 1), SQUAD_CONTROL_SPECS.engineTier),
    chassisBalance: snapToSpec(50 * wave(6.5, 2), SQUAD_CONTROL_SPECS.chassisBalance),
  };
}

const counts = { sent: 0, state: 0, telemetry: 0 };
let current: SquadControls | null = null;
let lastPhysics: CarPhysicsParams | null = null;
let lastTelemetry: GameTelemetry | null = null;
const tty = process.stdout.isTTY;
let lastPrint = 0;

const client = connectToolClient({
  url: values.url,
  role: 'dashboard',
  name: values.name,
  reconnect: true,
  onOpen: () => log(`connected to ${client.url}`),
  onClose: (code, reason, retryInMs) =>
    log(`disconnected (${code}${reason ? ` ${reason}` : ''})${retryInMs !== null ? `, retrying in ${retryInMs} ms` : ''}`),
  onError: (err) => log(`socket error: ${err.message}`),
  onMessage: (message) => {
    switch (message.type) {
      case 'server:welcome':
        log(`welcome: id ${message.clientId}, role ${message.role}, peers ${formatPeers(message.peers)}`);
        current = null; // resend on (re)connect so the game is in sync immediately
        return;
      case 'server:presence':
        log(`presence: ${formatPeers(message.peers)}`);
        return;
      case 'server:error':
        log(`server error ${message.code}: ${message.message}`);
        return;
      case 'game:state':
        counts.state += 1;
        lastPhysics = message.physics;
        return;
      case 'game:telemetry':
        counts.telemetry += 1;
        lastTelemetry = message.telemetry;
        return;
      default:
        return;
    }
  },
});

const startedAt = performance.now();
const timer = setInterval(() => {
  const controls = slidersAt((performance.now() - startedAt) / 1000);
  if (!squadControlsEqual(controls, current) && client.send({ type: 'squad:controls', controls })) {
    current = controls;
    counts.sent += 1;
  }
  printStatus();
}, 1000 / hz);

function printStatus(): void {
  const now = performance.now();
  if (!current || (!tty && now - lastPrint < 1000)) return;
  lastPrint = now;
  let line = `→ ${formatControls(current)}`;
  if (lastPhysics) {
    const jump = assessBigJump(lastPhysics);
    line += `  ← game: top ~${jump.topSpeedKmh.toFixed(0)} km/h, jump ${jump.verdict}`;
  }
  if (lastTelemetry) line += `  | ${formatTelemetry(lastTelemetry)}`;
  if (tty) process.stdout.write(`\r\x1b[2K${line.slice(0, process.stdout.columns - 1)}`);
  else console.log(line);
}

function log(line: string): void {
  if (tty) process.stdout.write('\r\x1b[2K');
  console.log(line);
}

onStop(durationSec, (reason) => {
  clearInterval(timer);
  log(
    `stopping (${reason}): sent ${counts.sent} squad:controls, received ${counts.state} game:state, ` +
      `${counts.telemetry} game:telemetry`,
  );
  client.close();
  setTimeout(() => process.exit(0), 100);
});
