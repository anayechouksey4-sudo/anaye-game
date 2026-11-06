/**
 * Blocky voxel wheels: a 12 × 12 voxel disc per wheel (voxel = radius / 6, so the flat bottom
 * row sits exactly on the physics radius), extruded across the tyre width.
 *   tyre    dark rubber ring with alternating tread blocks on the circumference
 *   band    yellow segments on the outer sidewall (makes the spin readable from the side)
 *   rim     neon lip + five neon spokes recessed one voxel into the face, yellow hub
 *   barrel  dark metal behind the spokes
 * Wheel-local frame: centre at the origin, axle along X; the outer face is +X for left wheels and
 * −X for right wheels (chassis +X = driver's left).
 */
import type { BufferGeometry } from 'three';
import type { WheelSpec } from '../vehicleSpec';
import { CAR_VOXEL_MATERIALS, M } from './carMaterial';
import { VoxelGrid, type VoxelMaterial, type VoxelMeshStats } from './voxelGrid';

const CELLS_ACROSS = 12; // diameter in voxels

/** Per-class wheel look (colours come from the class livery: M.rim, M.hub, M.sidewallBand, M.tyre…). */
export interface WheelStyle {
  spokes: number;
  treadBlocks: number;
  /** Yellow (M.sidewallBand) segments on the outer sidewall; 0 = none. */
  bandSegments: number;
  /** Rim radius as a fraction of the wheel radius (smaller = more tyre sidewall). */
  rimRatio: number;
  /** Off-road knobs: alternate blocks of the outer ring are cut away, so the silhouette is lumpy. */
  knobby: boolean;
  /** Solid rim face (disc wheel) instead of open spokes. */
  disc: boolean;
}

export const DEFAULT_WHEEL_STYLE: WheelStyle = { spokes: 5, treadBlocks: 16, bandSegments: 4, rimRatio: 0.7, knobby: false, disc: false };

/** Angular distance to the nearest multiple of 2π/count, rad. */
function angleToNearest(angle: number, count: number): number {
  const step = (Math.PI * 2) / count;
  const a = ((angle % step) + step) % step;
  return Math.min(a, step - a);
}

export function buildWheelGeometry(
  wheel: Pick<WheelSpec, 'radius' | 'width' | 'side'>,
  seed: number,
  materials: readonly VoxelMaterial[] = CAR_VOXEL_MATERIALS,
  style: WheelStyle = DEFAULT_WHEEL_STYLE,
): { geometry: BufferGeometry; stats: VoxelMeshStats } {
  const SPOKES = style.spokes;
  const TREAD_BLOCKS = style.treadBlocks;
  const BAND_SEGMENTS = style.bandSegments;
  const r = wheel.radius;
  const v = (2 * r) / CELLS_ACROSS;
  const nx = Math.max(3, Math.round(wheel.width / 0.064));
  const vx = wheel.width / nx;
  const grid = new VoxelGrid([nx, CELLS_ACROSS, CELLS_ACROSS], [vx, v, v], [-wheel.width / 2, -r, -r]);
  const outerI = wheel.side === 'left' ? nx - 1 : 0;
  const rimR = style.rimRatio * r;

  for (let k = 0; k < CELLS_ACROSS; k++)
    for (let j = 0; j < CELLS_ACROSS; j++) {
      const y = grid.cy(j);
      const z = grid.cz(k);
      const rr = Math.hypot(y, z);
      // 0.4 voxel inside the radius keeps a flat 2-voxel contact row at exactly −r.
      if (rr > r - 0.4 * v) continue;
      const angle = Math.atan2(y, z);
      const block = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * TREAD_BLOCKS);
      // Knobs: on the two shoulder columns the outermost ring keeps only every other block
      // (staggered side to side). The centre of the tread stays whole, so the tyre always rolls
      // on its physics radius while its silhouette looks lumpy.
      const outerRing = rr > r - 1.0 * v;
      for (let i = 0; i < nx; i++) {
        const outer = i === outerI;
        let m: number;
        if (rr >= rimR) {
          if (style.knobby && outerRing && (i === 0 || i === nx - 1) && (block + (i === 0 ? 1 : 0)) % 2 === 1) continue;
          const treadRow = rr > r - 1.45 * v;
          m = treadRow && block % 2 === 0 ? M.tread : M.tyre;
          if (BAND_SEGMENTS > 0 && outer && rr > 0.8 * r && rr < 0.93 * r && angleToNearest(angle, BAND_SEGMENTS) < 0.42) m = M.sidewallBand;
        } else if (outer && style.disc) {
          m = rr < 0.24 * r ? M.hub : rr > rimR - 0.75 * v ? M.rim : M.rimBarrel;
        } else if (outer) {
          // Outer face: neon lip, spokes and hub; everything else is open (recessed barrel shows).
          const lip = rr > rimR - 0.75 * v;
          const spokeHalfWidth = (0.85 * v) / Math.max(rr, v);
          const spoke = angleToNearest(angle, SPOKES) < spokeHalfWidth;
          if (rr < 0.24 * r) m = M.hub;
          else if (lip || spoke) m = M.rim;
          else continue;
        } else {
          m = M.rimBarrel;
        }
        grid.set(i, j, k, m);
      }
    }
  return grid.build(materials, seed);
}
