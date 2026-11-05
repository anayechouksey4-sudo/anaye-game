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
import { VoxelGrid, type VoxelMeshStats } from './voxelGrid';

const CELLS_ACROSS = 12; // diameter in voxels
const SPOKES = 5;
const TREAD_BLOCKS = 16;
const BAND_SEGMENTS = 4;

/** Angular distance to the nearest multiple of 2π/count, rad. */
function angleToNearest(angle: number, count: number): number {
  const step = (Math.PI * 2) / count;
  const a = ((angle % step) + step) % step;
  return Math.min(a, step - a);
}

export function buildWheelGeometry(wheel: Pick<WheelSpec, 'radius' | 'width' | 'side'>, seed: number): { geometry: BufferGeometry; stats: VoxelMeshStats } {
  const r = wheel.radius;
  const v = (2 * r) / CELLS_ACROSS;
  const nx = Math.max(3, Math.round(wheel.width / 0.064));
  const vx = wheel.width / nx;
  const grid = new VoxelGrid([nx, CELLS_ACROSS, CELLS_ACROSS], [vx, v, v], [-wheel.width / 2, -r, -r]);
  const outerI = wheel.side === 'left' ? nx - 1 : 0;
  const rimR = 0.7 * r;

  for (let k = 0; k < CELLS_ACROSS; k++)
    for (let j = 0; j < CELLS_ACROSS; j++) {
      const y = grid.cy(j);
      const z = grid.cz(k);
      const rr = Math.hypot(y, z);
      // 0.4 voxel inside the radius keeps a flat 2-voxel contact row at exactly −r.
      if (rr > r - 0.4 * v) continue;
      const angle = Math.atan2(y, z);
      for (let i = 0; i < nx; i++) {
        const outer = i === outerI;
        let m: number;
        if (rr >= rimR) {
          const treadRow = rr > r - 1.45 * v;
          m = treadRow && Math.floor(((angle + Math.PI) / (Math.PI * 2)) * TREAD_BLOCKS) % 2 === 0 ? M.tread : M.tyre;
          if (outer && rr > 0.8 * r && rr < 0.93 * r && angleToNearest(angle, BAND_SEGMENTS) < 0.42) m = M.sidewallBand;
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
  return grid.build(CAR_VOXEL_MATERIALS, seed);
}
