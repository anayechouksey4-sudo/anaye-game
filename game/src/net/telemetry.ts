import type { GameTelemetry } from '@shared/protocol';
import { carRuntime } from '../car/runtime';
import { runClock } from '../game/runClock';
import { gameState } from '../state/store';

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Snapshot of everything the dashboard shows, assembled from the runtime + store. */
export function buildTelemetry(): GameTelemetry {
  const { run } = gameState();
  const rt = carRuntime;
  return {
    speedKmh: round(rt.speedKmh, 1),
    wheelsGrounded: rt.wheelsGrounded,
    checkpoint: run.checkpoint,
    totalCheckpoints: run.totalCheckpoints,
    elapsedMs: Math.round(run.finished ? run.elapsedMs : runClock.elapsedMs),
    falls: run.falls,
    finished: run.finished,
    bestMs: run.bestMs,
    throttle: round(rt.throttle, 2),
    brake: round(rt.brake, 2),
    frontAeroN: Math.round(rt.frontAeroN),
    rearAeroN: Math.round(rt.rearAeroN),
    noseLift: rt.noseLift,
    rearSlip: round(rt.rearSlip, 2),
    speedTrapKmh: run.speedTrapKmh,
  };
}
