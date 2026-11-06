/**
 * The animated front wing. Each element is a voxel strip spanning both sides of the nose, built
 * with its pivot (leading edge) at the origin and the chord running toward −Z, so
 * `rotation.x > 0` raises the trailing edge (more angle of attack) and `scale.z` sets the chord.
 *
 * Every car class describes its wing with a `FrontWingConfig` (one element, e.g. a chin spoiler or
 * a nose flap, or two, main plane + flap). `frontWingPose(frontDownforce, out, wingMax)` maps the
 * LIVE physics param to angles and chord scales, so the wing visibly steepens and grows as the
 * dashboard's Front Wing Aero slider goes up.
 */
import type { BufferGeometry } from 'three';
import { FRONT_WING_DOWNFORCE_MAX } from '@shared/protocol';
import { RIDE_HEIGHT } from '../vehicleSpec';
import { CAR_VOXEL_MATERIALS, M } from './carMaterial';
import { VoxelGrid, type VoxelMaterial, type VoxelMeshStats } from './voxelGrid';

const CELL = 0.08;

export interface FrontWingElement {
  chord: number;
  thickness: number;
  /** Palette slot of the element's surface (the trailing-edge row is the aero-status LED). */
  material: number;
}

export interface FrontWingConfig {
  /** Main element leading edge (pivot), chassis frame. */
  pivot: [number, number, number];
  /** Half-gap left open in the middle for the nose (0 = one continuous span). */
  spanInnerX: number;
  /** Half-span to the tip, m. */
  spanOuterX: number;
  main: FrontWingElement;
  /** Optional flap, hinged over the main element's trailing edge (slot gap). */
  upper?: FrontWingElement & { hingeY: number; hingeOverlap: number };
  /** Angle ranges in degrees at 0 % → 100 % Front Wing Aero (defaults: the hypercar's). */
  mainDeg?: [number, number];
  upperDeg?: [number, number];
}

/** The hypercar's two-element wing (just above the splitter, behind the nose tip). */
export const HYPERCAR_FRONT_WING: FrontWingConfig = {
  pivot: [0, 0.235 - RIDE_HEIGHT, 2.3],
  spanInnerX: 0.34,
  spanOuterX: 0.92,
  main: { chord: 0.24, thickness: 0.05, material: M.paint },
  upper: { chord: 0.16, thickness: 0.04, material: M.carbon, hingeY: 0.045, hingeOverlap: 0.03 },
};

/** Legacy names for the hypercar wing's dimensions. */
export const MAIN_CHORD = HYPERCAR_FRONT_WING.main.chord;
export const UPPER_CHORD = HYPERCAR_FRONT_WING.upper?.chord ?? 0.16;
export const MAIN_PIVOT = HYPERCAR_FRONT_WING.pivot;
export const UPPER_HINGE_Y = HYPERCAR_FRONT_WING.upper?.hingeY ?? 0.045;
export const UPPER_HINGE_OVERLAP = HYPERCAR_FRONT_WING.upper?.hingeOverlap ?? 0.03;

function buildElement(
  config: FrontWingConfig,
  element: FrontWingElement,
  materials: readonly VoxelMaterial[],
  seed: number,
): { geometry: BufferGeometry; stats: VoxelMeshStats } {
  const { chord, thickness } = element;
  const inner = config.spanInnerX;
  const cellsPerSide = Math.max(1, Math.round((config.spanOuterX - inner) / CELL));
  const sideWidth = cellsPerSide * CELL;
  const gapCells = Math.round((2 * inner) / CELL);
  const nx = cellsPerSide * 2 + gapCells;
  const nz = Math.max(1, Math.round(chord / CELL));
  const grid = new VoxelGrid([nx, 1, nz], [CELL, thickness, chord / nz], [-(sideWidth + gapCells * CELL * 0.5), -thickness / 2, -chord]);
  for (let i = 0; i < nx; i++) {
    if (i >= cellsPerSide && i < cellsPerSide + gapCells) continue;
    // k = 0 is the trailing edge (most negative z): it carries the aero-status LED.
    for (let k = 0; k < nz; k++) grid.set(i, 0, k, k === 0 ? M.aeroLed : element.material);
  }
  return grid.build(materials, seed);
}

export interface FrontWingGeometries {
  main: BufferGeometry;
  upper: BufferGeometry | null;
  stats: VoxelMeshStats;
}

export function buildFrontWingGeometries(
  config: FrontWingConfig = HYPERCAR_FRONT_WING,
  materials: readonly VoxelMaterial[] = CAR_VOXEL_MATERIALS,
): FrontWingGeometries {
  const main = buildElement(config, config.main, materials, 11);
  const upper = config.upper ? buildElement(config, config.upper, materials, 12) : null;
  const add = (k: keyof VoxelMeshStats) => main.stats[k] + (upper?.stats[k] ?? 0);
  return {
    main: main.geometry,
    upper: upper?.geometry ?? null,
    stats: { voxels: add('voxels'), faces: add('faces'), triangles: add('triangles'), vertices: add('vertices') },
  };
}

export interface FrontWingPose {
  /** Main element angle of attack, rad. */
  mainAngle: number;
  mainChordScale: number;
  /** Upper element angle of attack (absolute, chassis frame), rad. */
  upperAngle: number;
  upperChordScale: number;
}

const DEG = Math.PI / 180;

/**
 * Wing pose for a front-downforce factor. 0 → nearly flat with the upper flap retracted;
 * `wingMax` (the class's frontDownforce at 100 % Front Wing Aero) → steep, full-chord; the physics
 * panel can go beyond that (up to 15), which keeps steepening a little further.
 */
export function frontWingPose(
  frontDownforce: number,
  out: FrontWingPose,
  wingMax: number = FRONT_WING_DOWNFORCE_MAX,
  config: FrontWingConfig = HYPERCAR_FRONT_WING,
): FrontWingPose {
  const s = Math.min(Math.max(frontDownforce / Math.max(wingMax, 1e-6), 0), 2.3);
  const base = Math.min(s, 1);
  const extra = Math.max(s - 1, 0);
  const [m0, m1] = config.mainDeg ?? [2, 26];
  const [u0, u1] = config.upperDeg ?? [4, 50];
  out.mainAngle = (m0 + (m1 - m0) * base + 0.25 * (m1 - m0) * extra) * DEG;
  out.mainChordScale = 0.8 + 0.25 * base + 0.08 * extra;
  out.upperAngle = (u0 + (u1 - u0) * base + 0.22 * (u1 - u0) * extra) * DEG;
  out.upperChordScale = 0.3 + 0.7 * base + 0.15 * extra;
  return out;
}
