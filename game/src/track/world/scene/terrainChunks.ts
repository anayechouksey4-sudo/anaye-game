/**
 * Terrain chunk geometry (pure: typed arrays only). 8 × 8 chunks of 256 m; LOD l samples every
 * 2^l cells (4, 8, 16 m), so LOD0 is exactly the physics heightfield. Each chunk = an n² grid plus
 * a 3 m skirt around its rim (hides LOD cracks). Every chunk of a LOD shares one index buffer.
 *
 * Triangles follow Rapier's split: cell (i, j) → (a, c, b) and (b, c, d) with a = (i, j),
 * b = (i+1, j), c = (i, j+1), d = (i+1, j+1); CCW seen from +Y.
 */
import { CELL, WORLD_HALF, WORLD_N } from '../gen/types';

export const CHUNKS = 8;
export const CHUNK_CELLS = 64;
export const CHUNK_SIZE = CHUNK_CELLS * CELL;
export const LOD_STEPS = [1, 2, 4] as const;
export const SKIRT_M = 3;

/** Grid vertices per side for a LOD step. */
export const sideOf = (step: number): number => CHUNK_CELLS / step + 1;

/** Perimeter (grid index list) walked +x on the north rim, +z east, −x south, −z west: skirts face outward. */
function perimeter(n: number): number[] {
  const p: number[] = [];
  for (let i = 0; i < n - 1; i++) p.push(i); // north (j = 0), +x
  for (let j = 0; j < n - 1; j++) p.push(j * n + (n - 1)); // east, +z
  for (let i = n - 1; i > 0; i--) p.push((n - 1) * n + i); // south, −x
  for (let j = n - 1; j > 0; j--) p.push(j * n); // west, −z
  return p;
}

/** Shared index buffer for one LOD (grid + skirt). */
export function chunkIndex(step: number): Uint16Array {
  const n = sideOf(step);
  const per = perimeter(n);
  const P = per.length;
  const out = new Uint16Array((n - 1) * (n - 1) * 6 + P * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      out[k++] = a;
      out[k++] = c;
      out[k++] = b;
      out[k++] = b;
      out[k++] = c;
      out[k++] = d;
    }
  const base = n * n;
  for (let s = 0; s < P; s++) {
    const p0 = per[s]!;
    const p1 = per[(s + 1) % P]!;
    const q0 = base + s;
    const q1 = base + ((s + 1) % P);
    out[k++] = p0;
    out[k++] = p1;
    out[k++] = q0;
    out[k++] = p1;
    out[k++] = q1;
    out[k++] = q0;
  }
  return out;
}

export interface ChunkLod {
  position: Float32Array;
  /** [minX, minY, minZ, maxX, maxY, maxZ] of the grid (skirt excluded). */
  bounds: [number, number, number, number, number, number];
}

/** Positions for chunk (cx, cz) at a LOD step, from row-major heights (513²). */
export function chunkPositions(heights: Float32Array, cx: number, cz: number, step: number): ChunkLod {
  const n = sideOf(step);
  const per = perimeter(n);
  const out = new Float32Array((n * n + per.length) * 3);
  const ix0 = cx * CHUNK_CELLS;
  const iz0 = cz * CHUNK_CELLS;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const ix = ix0 + i * step;
      const iz = iz0 + j * step;
      const y = heights[iz * WORLD_N + ix]!;
      const o = (j * n + i) * 3;
      out[o] = -WORLD_HALF + ix * CELL;
      out[o + 1] = y;
      out[o + 2] = -WORLD_HALF + iz * CELL;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  for (let s = 0; s < per.length; s++) {
    const src = per[s]! * 3;
    const o = (n * n + s) * 3;
    out[o] = out[src]!;
    out[o + 1] = out[src + 1]! - SKIRT_M;
    out[o + 2] = out[src + 2]!;
  }
  const x0 = -WORLD_HALF + ix0 * CELL;
  const z0 = -WORLD_HALF + iz0 * CELL;
  return { position: out, bounds: [x0, minY, z0, x0 + CHUNK_SIZE, maxY, z0 + CHUNK_SIZE] };
}

/** Distance from a point to an AABB [minX, minY, minZ, maxX, maxY, maxZ] (0 inside). */
export function aabbDistance(b: readonly number[], x: number, y: number, z: number): number {
  const dx = Math.max(b[0]! - x, 0, x - b[3]!);
  const dy = Math.max(b[1]! - y, 0, y - b[4]!);
  const dz = Math.max(b[2]! - z, 0, z - b[5]!);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
