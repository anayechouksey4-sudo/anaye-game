// One-line human summaries used by the relay log and the CLI tools.
import {
  CAR_PHYSICS_KEYS,
  CAR_PHYSICS_SPECS,
  describeChassisBalance,
  type CarPhysicsParams,
  type GameSessionInfo,
  type GameTelemetry,
  type PeerCounts,
  type SquadControls,
} from '../../shared/protocol';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatControls(c: SquadControls): string {
  const { front, rear } = describeChassisBalance(c.chassisBalance);
  return (
    `aero ${String(c.frontWingAero).padStart(3)}% · tier ${c.engineTier} · ` +
    `balance ${signed(c.chassisBalance).padStart(3)} (F${front}/R${rear})`
  );
}

/** Works for full params and for `physics:set` patches (only present keys are shown). */
export function formatPhysics(p: Partial<CarPhysicsParams>): string {
  const parts: string[] = [];
  for (const key of CAR_PHYSICS_KEYS) {
    const value = p[key];
    if (value === undefined) continue;
    const unit = CAR_PHYSICS_SPECS[key].unit;
    parts.push(`${key} ${Number(value.toFixed(3))}${unit ? ` ${unit}` : ''}`);
  }
  return parts.join(' · ');
}

/** `car rally · map chaos · jump 183 km/h` from a game:state's optional session fields ('' if none). */
export function formatSession(s: GameSessionInfo): string {
  const parts: string[] = [];
  if (s.carId !== undefined) parts.push(`car ${s.carId}`);
  if (s.trackId !== undefined) parts.push(`map ${s.trackId}`);
  if (s.bigJumpKmh !== undefined) parts.push(s.bigJumpKmh === null ? 'no big jump' : `jump ${s.bigJumpKmh} km/h`);
  return parts.join(' · ');
}

export function formatPeers(p: PeerCounts): string {
  return `game ${p.game} · dashboard ${p.dashboard} · observer ${p.observer}`;
}

export function formatTelemetry(t: GameTelemetry): string {
  const best = t.bestMs === null ? '–' : `${(t.bestMs / 1000).toFixed(2)}s`;
  const parts = [
    `${t.speedKmh.toFixed(0).padStart(3)} km/h`,
    `thr ${pct(t.throttle)} brk ${pct(t.brake)}`,
    `aero F${signed(Math.round(t.frontAeroN))}N R${signed(Math.round(t.rearAeroN))}N`,
    `wheels ${t.wheelsGrounded}`,
    `cp ${t.checkpoint}/${t.totalCheckpoints}`,
    `${(t.elapsedMs / 1000).toFixed(1)}s`,
    `falls ${t.falls}`,
    `best ${best}`,
  ];
  if (t.noseLift) parts.push('NOSE LIFT');
  if (t.rearSlip >= 0.05) parts.push(`slip ${t.rearSlip.toFixed(2)}`);
  if (t.speedTrapKmh !== null) parts.push(`trap ${t.speedTrapKmh.toFixed(0)} km/h`);
  if (t.finished) parts.push('FINISHED');
  return parts.join(' · ');
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`.padStart(4);
}
