/**
 * `window.__CHAOS__` — scripting surface for the chaos track (tests, calibration, console).
 * Installed by <ChaosTrack/> while mounted. Read-only apart from `generate` (pure).
 */
import { useEffect } from 'react';
import { chaosRuntime, collect, type CollapseRecord, type PendulumProbe, type ShutterProbe, type TileProbe } from './chaosRuntime';
import { hazardClock } from './hazardClock';
import { centerXAt, describePlan, generateChaosTrack, type ChaosTrackPlan } from './plan';

export interface ChaosDebugHandle {
  seed: number;
  /** Segment list, checkpoints, finish, big-jump lip (JSON-friendly). */
  describe(): ReturnType<typeof describePlan>;
  /** The full plan (decks, hazards, decor). */
  plan(): ChaosTrackPlan;
  /** Ideal-line X at a given Z (autopilots steer toward it). */
  centerX(z: number): number;
  tiles(): TileProbe[];
  collapses(): CollapseRecord[];
  pendulums(): PendulumProbe[];
  shutters(): ShutterProbe[];
  hazardTime(): number;
  /** Generate (without mounting) the plan for any seed — for determinism checks. */
  generate(seed: number): ReturnType<typeof describePlan>;
}

declare global {
  interface Window {
    __CHAOS__?: ChaosDebugHandle;
  }
}

export function useChaosDebugHandle(plan: ChaosTrackPlan): void {
  useEffect(() => {
    const handle: ChaosDebugHandle = {
      seed: plan.seed,
      describe: () => describePlan(plan),
      plan: () => plan,
      centerX: (z) => centerXAt(plan, z),
      tiles: () => collect(chaosRuntime.tileSources),
      collapses: () => [...chaosRuntime.collapses],
      pendulums: () => collect(chaosRuntime.pendulumSources),
      shutters: () => collect(chaosRuntime.shutterSources),
      hazardTime: () => hazardClock.time,
      generate: (seed) => describePlan(generateChaosTrack(seed)),
    };
    window.__CHAOS__ = handle;
    return () => {
      if (window.__CHAOS__ === handle) delete window.__CHAOS__;
    };
  }, [plan]);
}
