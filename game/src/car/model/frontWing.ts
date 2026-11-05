/**
 * The animated two-element front wing. Each element is a voxel strip spanning both sides of the
 * nose, built with its pivot (leading edge) at the origin and the chord running toward −Z, so
 * `rotation.x > 0` raises the trailing edge (more angle of attack) and `scale.z` sets the chord.
 *
 * `frontWingPose(frontDownforce)` maps the LIVE physics param to angles and chord scales, so the
 * wing visibly steepens and grows as the dashboard's Front Wing Aero slider goes up.
 */
import type { BufferGeometry } from 'three';
import { FRONT_WING_DOWNFORCE_MAX } from '@shared/protocol';
import { RIDE_HEIGHT } from '../vehicleSpec';
import { CAR_VOXEL_MATERIALS, M } from './carMaterial';
import { VoxelGrid, type VoxelMeshStats } from './voxelGrid';

const SPAN_INNER_X = 0.34;
const SPAN_OUTER_X = 0.92;
const CELL = 0.08;

export const MAIN_CHORD = 0.24;
export const UPPER_CHORD = 0.16;
const MAIN_THICKNESS = 0.05;
const UPPER_THICKNESS = 0.04;

/** Main element leading edge, chassis frame (just above the splitter, behind the nose tip). */
export const MAIN_PIVOT: [number, number, number] = [0, 0.235 - RIDE_HEIGHT, 2.3];
/** Upper element hinge in the main element's frame: tucked over its trailing edge (slot gap). */
export const UPPER_HINGE_Y = 0.045;
export const UPPER_HINGE_OVERLAP = 0.03;

function buildElement(chord: number, thickness: number, surface: number, seed: number): { geometry: BufferGeometry; stats: VoxelMeshStats } {
  const cellsPerSide = Math.round((SPAN_OUTER_X - SPAN_INNER_X) / CELL);
  const sideWidth = cellsPerSide * CELL;
  const gapCells = Math.round((2 * SPAN_INNER_X) / CELL);
  const nx = cellsPerSide * 2 + gapCells;
  const nz = Math.round(chord / CELL);
  const grid = new VoxelGrid([nx, 1, nz], [CELL, thickness, chord / nz], [-(sideWidth + SPAN_INNER_X), -thickness / 2, -chord]);
  for (let i = 0; i < nx; i++) {
    if (i >= cellsPerSide && i < cellsPerSide + gapCells) continue;
    // k = 0 is the trailing edge (most negative z): it carries the aero-status LED.
    for (let k = 0; k < nz; k++) grid.set(i, 0, k, k === 0 ? M.aeroLed : surface);
  }
  return grid.build(CAR_VOXEL_MATERIALS, seed);
}

export function buildFrontWingGeometries(): {
  main: BufferGeometry;
  upper: BufferGeometry;
  stats: VoxelMeshStats;
} {
  const main = buildElement(MAIN_CHORD, MAIN_THICKNESS, M.paint, 11);
  const upper = buildElement(UPPER_CHORD, UPPER_THICKNESS, M.carbon, 12);
  return {
    main: main.geometry,
    upper: upper.geometry,
    stats: {
      voxels: main.stats.voxels + upper.stats.voxels,
      faces: main.stats.faces + upper.stats.faces,
      triangles: main.stats.triangles + upper.stats.triangles,
      vertices: main.stats.vertices + upper.stats.vertices,
    },
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
 * FRONT_WING_DOWNFORCE_MAX (100 % Front Wing Aero) → steep, full-chord; the physics panel can go
 * beyond that (up to 15), which keeps steepening a little further.
 */
export function frontWingPose(frontDownforce: number, out: FrontWingPose): FrontWingPose {
  const s = Math.min(Math.max(frontDownforce / FRONT_WING_DOWNFORCE_MAX, 0), 2.3);
  const base = Math.min(s, 1);
  const extra = Math.max(s - 1, 0);
  out.mainAngle = (2 + 24 * base + 6 * extra) * DEG;
  out.mainChordScale = 0.8 + 0.25 * base + 0.08 * extra;
  out.upperAngle = (4 + 46 * base + 10 * extra) * DEG;
  out.upperChordScale = 0.3 + 0.7 * base + 0.15 * extra;
  return out;
}
