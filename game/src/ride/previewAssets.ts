/**
 * Builds the geometries of a LOOK (a ride and/or a driver over a car class) for the MY RIDE
 * preview and, through the same function, for the game once CarModel consumes looks:
 *
 *   base grid   the class's body, filled ONCE per class and cached (the expensive part: 5–11 ms)
 *   applyLook   ride/livery.ts: a new grid + material table (≈ 1 ms)
 *   mesh        VoxelGrid.build + 4 wheels + the front wing (≈ 3–8 ms)
 *
 * `lookBuildLog` records every build's cost (the builder's slider debounce is judged against it:
 * ≤ 50 ms per rebuild, measured in game/README.md "MY RIDE").
 */
import type { BufferGeometry } from 'three';
import type { CarClassId } from '@shared/protocol';
import { buildFrontWingGeometries, type FrontWingConfig } from '../car/model/frontWing';
import { CAR_MODELS } from '../car/model/models';
import type { VoxelGrid } from '../car/model/voxelGrid';
import { buildWheelGeometry } from '../car/model/wheelVoxels';
import { getVehicleSpec, type Tuple3, type VehicleSpec } from '../car/vehicleSpec';
import { applyLook, type LookSpec } from './livery';

export interface LookAssets {
  carId: CarClassId;
  spec: VehicleSpec;
  body: BufferGeometry;
  /** Indexed like spec.wheels (FL, FR, RL, RR). */
  wheels: BufferGeometry[];
  /** Front wing in the chassis frame (pivot converted), or null. */
  wing: { config: FrontWingConfig; main: BufferGeometry; upper: BufferGeometry | null } | null;
  /** Exhaust outlets in the chassis frame (for the flame). */
  outlets: Tuple3[];
  stats: { bodyTris: number; wheelTris: number; wingTris: number; totalTris: number; applyMs: number; meshMs: number; totalMs: number; changed: number };
  dispose(): void;
}

const baseGrids = new Map<string, VoxelGrid>();

/** The class's stock body grid, filled once per page (read-only: applyLook copies it). */
export function baseGridFor(carId: CarClassId): VoxelGrid {
  const hit = baseGrids.get(carId);
  if (hit) return hit;
  const grid = CAR_MODELS[carId].buildBody(getVehicleSpec(carId));
  baseGrids.set(carId, grid);
  return grid;
}

export const lookBuildLog = {
  builds: 0,
  lastMs: 0,
  maxMs: 0,
  /** Last 32 build times, ms (applyLook + mesh; the base fill is cached). */
  history: [] as number[],
  /** Time the first fill of each class took, ms (one-off per page). */
  fillMs: {} as Record<string, number>,
  /** Triangle counts and timings of the latest build. */
  lastStats: null as LookAssets['stats'] | null,
};

export function buildLookAssets(carId: CarClassId, look: LookSpec): LookAssets {
  const spec = getVehicleSpec(carId);
  const def = CAR_MODELS[carId];
  if (!baseGrids.has(carId)) {
    const t = performance.now();
    baseGridFor(carId);
    lookBuildLog.fillMs[carId] = Math.round((performance.now() - t) * 10) / 10;
  }
  const t0 = performance.now();
  const result = applyLook(baseGridFor(carId), spec, def, look);
  const t1 = performance.now();
  const body = result.grid.build(result.materials, 1);
  const wheelBuilds = spec.wheels.map((w) => buildWheelGeometry(w, 20 + w.index, result.materials, result.wheelStyle));
  const toChassis = (p: readonly [number, number, number]): Tuple3 => [p[0], p[1] - spec.rideHeight, p[2]];
  let wing: LookAssets['wing'] = null;
  let wingTris = 0;
  if (def.wing) {
    const config: FrontWingConfig = { ...def.wing, pivot: toChassis(def.wing.pivot) };
    const built = buildFrontWingGeometries(config, result.materials);
    wing = { config, main: built.main, upper: built.upper };
    wingTris = built.stats.triangles;
  }
  const t2 = performance.now();
  const wheelTris = wheelBuilds.reduce((n, b) => n + b.stats.triangles, 0);
  const totalMs = t2 - t0;
  lookBuildLog.builds++;
  lookBuildLog.lastMs = Math.round(totalMs * 10) / 10;
  lookBuildLog.maxMs = Math.max(lookBuildLog.maxMs, lookBuildLog.lastMs);
  lookBuildLog.history.push(lookBuildLog.lastMs);
  if (lookBuildLog.history.length > 32) lookBuildLog.history.shift();
  const wheels = wheelBuilds.map((b) => b.geometry);
  const stats: LookAssets['stats'] = {
    bodyTris: body.stats.triangles,
    wheelTris,
    wingTris,
    totalTris: body.stats.triangles + wheelTris + wingTris,
    applyMs: Math.round((t1 - t0) * 10) / 10,
    meshMs: Math.round((t2 - t1) * 10) / 10,
    totalMs: Math.round(totalMs * 10) / 10,
    changed: result.changed,
  };
  lookBuildLog.lastStats = stats;
  return {
    carId,
    spec,
    body: body.geometry,
    wheels,
    wing,
    outlets: result.outlets.map(toChassis),
    stats,
    dispose() {
      body.geometry.dispose();
      for (const w of wheels) w.dispose();
      wing?.main.dispose();
      wing?.upper?.dispose();
    },
  };
}
