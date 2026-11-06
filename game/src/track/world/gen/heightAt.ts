/**
 * Terrain height on the same triangles Rapier's heightfield uses: cell (ix, iz) is split along
 * (ix+1, iz)–(ix, iz+1); triangles (a, c, b) and (b, c, d) with a = (ix, iz), b = (ix+1, iz),
 * c = (ix, iz+1), d = (ix+1, iz+1). Bilinear interpolation would be off by up to ~1.6 cm. Pure.
 */
import { CELL as CELL_, WORLD_CELLS as WORLD_CELLS_, WORLD_HALF as WORLD_HALF_, WORLD_N as WORLD_N_ } from './types';

// Local copies (fast in hot loops under any module loader).
const CELL = CELL_;
const WORLD_CELLS = WORLD_CELLS_;
const WORLD_HALF = WORLD_HALF_;
const WORLD_N = WORLD_N_;

/** Height at world (x, z) from row-major heights (513²). Outside the grid: clamped to the edge. */
export function heightAt(heights: ArrayLike<number>, x: number, z: number): number {
  let fx = (x + WORLD_HALF) / CELL;
  let fz = (z + WORLD_HALF) / CELL;
  fx = fx < 0 ? 0 : fx > WORLD_CELLS ? WORLD_CELLS : fx;
  fz = fz < 0 ? 0 : fz > WORLD_CELLS ? WORLD_CELLS : fz;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  if (ix >= WORLD_CELLS) ix = WORLD_CELLS - 1;
  if (iz >= WORLD_CELLS) iz = WORLD_CELLS - 1;
  const u = fx - ix;
  const v = fz - iz;
  const i = iz * WORLD_N + ix;
  const hb = heights[i + 1]!;
  const hc = heights[i + WORLD_N]!;
  if (u + v <= 1) {
    const ha = heights[i]!;
    return ha + u * (hb - ha) + v * (hc - ha);
  }
  const hd = heights[i + WORLD_N + 1]!;
  return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
}

/** Unit-free slope (|∇h|) of the triangle under (x, z). */
export function slopeAt(heights: ArrayLike<number>, x: number, z: number): number {
  const fx = Math.max(0, Math.min(WORLD_CELLS - 1e-6, (x + WORLD_HALF) / CELL));
  const fz = Math.max(0, Math.min(WORLD_CELLS - 1e-6, (z + WORLD_HALF) / CELL));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const i = iz * WORLD_N + ix;
  const u = fx - ix;
  const v = fz - iz;
  let gx: number;
  let gz: number;
  if (u + v <= 1) {
    gx = (heights[i + 1]! - heights[i]!) / CELL;
    gz = (heights[i + WORLD_N]! - heights[i]!) / CELL;
  } else {
    gx = (heights[i + WORLD_N + 1]! - heights[i + WORLD_N]!) / CELL;
    gz = (heights[i + WORLD_N + 1]! - heights[i + 1]!) / CELL;
  }
  return Math.hypot(gx, gz);
}
