/**
 * Shared helpers for the voxel car bodies (one shape module per car class), and the contract a
 * class's model fulfils (`CarModelDef`).
 *
 * Conventions match hypercarShape.ts: chassis frame (+Z nose, +X driver's left, origin at the
 * class's ride height), shape functions take |x| (`ax`), the GROUND-relative height `h` and `z`,
 * and return a palette slot (0 = empty). Wheel wells are carved from the class's wheel spec, so a
 * body always clears its own physics wheels.
 */
import type { VehicleSpec } from '../vehicleSpec';
import { wheelRestCenterYFor } from '../vehicleSpec';
import type { Livery } from './carMaterial';
import type { FrontWingConfig } from './frontWing';
import { VoxelGrid } from './voxelGrid';
import type { WheelStyle } from './wheelVoxels';

export const VOXEL = 0.08;

/** What a car class's model provides to carAssets / CarModel. */
export interface CarModelDef {
  /** Fills and paints the body grid in the chassis frame of `spec`. */
  buildBody(spec: VehicleSpec): VoxelGrid;
  /** Palette overrides (paint colours, rims…). */
  livery?: Livery;
  /** Animated front wing / spoiler driven by frontDownforce; null = none. Its pivot is [x, h, z] (h ground-relative). */
  wing: FrontWingConfig | null;
  /** Exhaust outlets [x, h, z] (h ground-relative) for the flame; all on one z plane. */
  exhaust: readonly (readonly [number, number, number])[];
  wheel?: Partial<WheelStyle>;
}

/**
 * An empty body grid for a class: cells of VOXEL, an odd column count so x = 0 is a cell centre,
 * spanning |x| ≤ halfWidth, ground-relative heights h0 … maxH and zMin … zMax.
 */
export function makeBodyGrid(spec: VehicleSpec, halfWidth: number, maxH: number, zMin: number, zMax: number, h0 = 0.1): VoxelGrid {
  const half = Math.ceil(halfWidth / VOXEL - 0.5);
  const nx = 2 * half + 1;
  const ny = Math.ceil((maxH - h0) / VOXEL);
  const nz = Math.ceil((zMax - zMin) / VOXEL);
  return new VoxelGrid([nx, ny, nz], [VOXEL, VOXEL, VOXEL], [(-nx * VOXEL) / 2, h0 - spec.rideHeight, zMin]);
}

/** Fill a grid from a shape function of (|x|, ground-relative h, z, signed x). */
export function fillBody(g: VoxelGrid, spec: VehicleSpec, sample: (ax: number, h: number, z: number, x: number) => number): void {
  g.fill((x, y, z) => sample(Math.abs(x), y + spec.rideHeight, z, x));
}

export interface Well {
  axle: 'front' | 'rear';
  z: number;
  /** Wheel-centre height above the ground at rest. */
  h: number;
  r: number;
  /** Cells with |x| at or beyond this are inside the well. */
  innerX: number;
  /** Extra room above the tyre for suspension compression. */
  bump: number;
}

export interface WellOptions {
  margin?: number;
  bump?: number;
  /** Inboard clearance for the steered front wheels. */
  frontSteer?: number;
  rearInboard?: number;
}

export function wheelWells(spec: VehicleSpec, o: WellOptions = {}): Well[] {
  const margin = o.margin ?? 0.05;
  const out: Well[] = [];
  for (const w of spec.wheels) {
    if (out.some((x) => x.axle === w.axle)) continue;
    const inboard = w.axle === 'front' ? (o.frontSteer ?? 0.16) : (o.rearInboard ?? 0.05);
    out.push({
      axle: w.axle,
      z: w.connection[2],
      h: wheelRestCenterYFor(spec, w) + spec.rideHeight,
      r: w.radius + margin,
      innerX: Math.abs(w.connection[0]) - w.width / 2 - inboard,
      bump: o.bump ?? 0.04,
    });
  }
  return out;
}

export function wellDistance(well: Well, h: number, z: number): number {
  const dz = z - well.z;
  let dh = h - well.h;
  if (dh > 0) dh = Math.max(0, dh - well.bump);
  return Math.sqrt(dz * dz + dh * dh);
}

export function inWells(wells: readonly Well[], ax: number, h: number, z: number): boolean {
  for (const well of wells) if (ax >= well.innerX && wellDistance(well, h, z) < well.r) return true;
  return false;
}

/** One voxel lower within a voxel of either edge of [inner, outer] (inner ≤ 0 = no inner edge). */
export function chamfer(ax: number, inner: number, outer: number, step = VOXEL): number {
  return (ax > outer - VOXEL * 1.05 ? step : 0) + (inner > 0 && ax < inner + VOXEL * 1.05 ? step : 0);
}

/** Which faces of a filled cell are open (x faces are judged on the outward side of the car). */
export function exposure(g: VoxelGrid, i: number, j: number, k: number): { top: boolean; side: boolean; front: boolean; rear: boolean; bottom: boolean } {
  const outward = g.cx(i) >= 0 ? 1 : -1;
  return {
    top: !g.filled(i, j + 1, k),
    side: !g.filled(i + outward, j, k),
    front: !g.filled(i, j, k + 1),
    rear: !g.filled(i, j, k - 1),
    bottom: !g.filled(i, j - 1, k),
  };
}

/** Recolour cells after scanning the whole grid (so a pass never reads its own output). */
export function paintPass(g: VoxelGrid, spec: VehicleSpec, fn: (m: number, ax: number, h: number, z: number, i: number, j: number, k: number, x: number) => number | void): void {
  const recolor: [number, number, number, number][] = [];
  g.forEachFilled((i, j, k, m) => {
    const x = g.cx(i);
    const next = fn(m, Math.abs(x), g.cy(j) + spec.rideHeight, g.cz(k), i, j, k, x);
    if (next !== undefined && next !== m) recolor.push([i, j, k, next]);
  });
  for (const [i, j, k, m] of recolor) g.set(i, j, k, m);
}
