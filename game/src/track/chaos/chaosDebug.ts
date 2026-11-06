/**
 * `window.__CHAOS__` — scripting surface for the generated maps (the chaos track and every map
 * in track/maps/): tests, calibration, console. Installed by <GeneratedTrack/> while mounted and
 * removed on unmount. Read-only apart from `generate` (pure).
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { chaosRuntime, collect, type CollapseRecord, type PendulumProbe, type ShutterProbe, type TileProbe } from './chaosRuntime';
import { hazardClock } from './hazardClock';
import { centerXAt, describePlan, generateTrack, type ChaosTrackPlan } from './plan';
import type { TrackRecipe } from './recipe';

export interface ChaosDebugHandle {
  /** Map id of the mounted recipe ('chaos', 'ribbon', …). */
  map: string;
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
  /** Generate (without mounting) this map's plan for any seed — for determinism checks. */
  generate(seed: number): ReturnType<typeof describePlan>;
  /** Override the pendulum hinge-drive gains (1/s², 1/s, rad/s²) for calibration. */
  setPendulumDrive(stiffness: number, damping: number, maxAccel?: number): void;
  /** renderer.info of the last frame (draw calls include the shadow pass). */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number };
}

declare global {
  interface Window {
    __CHAOS__?: ChaosDebugHandle;
  }
}

export function useChaosDebugHandle(plan: ChaosTrackPlan, recipe: TrackRecipe): void {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const handle: ChaosDebugHandle = {
      map: recipe.id,
      seed: plan.seed,
      describe: () => describePlan(plan),
      plan: () => plan,
      centerX: (z) => centerXAt(plan, z),
      tiles: () => collect(chaosRuntime.tileSources),
      collapses: () => [...chaosRuntime.collapses],
      pendulums: () => collect(chaosRuntime.pendulumSources),
      shutters: () => collect(chaosRuntime.shutterSources),
      hazardTime: () => hazardClock.time,
      generate: (seed) => describePlan(generateTrack(recipe, seed)),
      setPendulumDrive: (stiffness, damping, maxAccel) => {
        const drive = chaosRuntime.pendulumDrive;
        drive.stiffness = stiffness;
        drive.damping = damping;
        if (maxAccel !== undefined) drive.maxAccel = maxAccel;
      },
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      }),
    };
    window.__CHAOS__ = handle;
    return () => {
      if (window.__CHAOS__ === handle) delete window.__CHAOS__;
    };
  }, [plan, recipe, gl]);
}
