/**
 * Nearest road-centreline sample queries (respawn poses, wheel surface classification). A 32 m
 * grid over the island lists every drivable road sample (rail excluded). Queries allocate nothing:
 * the result lands in the module-level `hit` object. Pure (no three / rapier).
 */
import { ROAD_SAFE, SURF, WORLD_HALF, type RoadData, type SurfaceName } from '../gen/types';

const CELL_M = 32;
const GRID = (2 * WORLD_HALF) / CELL_M;

export interface RoadHit {
  found: boolean;
  /** Global sample index (into RoadIndex arrays). */
  k: number;
  dist: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
  surface: number;
  grade: number;
  safe: boolean;
  road: number;
}

export interface RoadIndex {
  roads: readonly RoadData[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  grade: Float32Array;
  halfWidth: Float32Array;
  surface: Uint8Array;
  flags: Uint8Array;
  road: Uint16Array;
  cellStart: Uint32Array;
  items: Uint32Array;
}

function surfaceOf(r: RoadData): number {
  return SURF[r.surface as SurfaceName] ?? SURF.asphalt;
}

export function buildRoadIndex(roads: readonly RoadData[]): RoadIndex {
  let total = 0;
  for (const r of roads) if (r.kind !== 'rail') total += r.points.length / 3;
  const x = new Float32Array(total);
  const y = new Float32Array(total);
  const z = new Float32Array(total);
  const tx = new Float32Array(total);
  const tz = new Float32Array(total);
  const grade = new Float32Array(total);
  const halfWidth = new Float32Array(total);
  const surface = new Uint8Array(total);
  const flags = new Uint8Array(total);
  const road = new Uint16Array(total);
  const cellOf = new Uint32Array(total);
  const counts = new Uint32Array(GRID * GRID + 1);
  let k = 0;
  roads.forEach((r, ri) => {
    if (r.kind === 'rail') return;
    const n = r.points.length / 3;
    const s = surfaceOf(r);
    for (let i = 0; i < n; i++) {
      const a = r.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = r.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const span = Math.max(1e-3, (b - a + (r.closed && b < a ? n : 0)) * r.ds);
      x[k] = r.points[i * 3]!;
      y[k] = r.points[i * 3 + 1]!;
      z[k] = r.points[i * 3 + 2]!;
      tx[k] = r.tangents[i * 2]!;
      tz[k] = r.tangents[i * 2 + 1]!;
      grade[k] = Math.abs(r.points[b * 3 + 1]! - r.points[a * 3 + 1]!) / span;
      halfWidth[k] = r.width / 2;
      surface[k] = s;
      flags[k] = r.flags[i]!;
      road[k] = ri;
      const cx = Math.min(GRID - 1, Math.max(0, Math.floor((x[k]! + WORLD_HALF) / CELL_M)));
      const cz = Math.min(GRID - 1, Math.max(0, Math.floor((z[k]! + WORLD_HALF) / CELL_M)));
      const c = cz * GRID + cx;
      cellOf[k] = c;
      counts[c + 1]!++;
      k++;
    }
  });
  const cellStart = new Uint32Array(GRID * GRID + 1);
  for (let c = 0; c < GRID * GRID; c++) cellStart[c + 1] = cellStart[c]! + counts[c + 1]!;
  const fill = cellStart.slice(0, GRID * GRID);
  const items = new Uint32Array(total);
  for (let i = 0; i < total; i++) items[fill[cellOf[i]!]!++] = i;
  return { roads, x, y, z, tx, tz, grade, halfWidth, surface, flags, road, cellStart, items };
}

export const hit: RoadHit = { found: false, k: -1, dist: Infinity, x: 0, y: 0, z: 0, tx: 0, tz: 1, halfWidth: 0, surface: 0, grade: 0, safe: false, road: -1 };

/**
 * Nearest sample to (x, z) within `maxDist` m, optionally only ROAD_SAFE samples or samples with
 * grade ≤ maxGrade. Writes `hit`; returns hit.found.
 */
export function nearestRoad(idx: RoadIndex, x: number, z: number, maxDist: number, safeOnly = false, maxGrade = Infinity): boolean {
  const r = Math.ceil(maxDist / CELL_M);
  const cx = Math.floor((x + WORLD_HALF) / CELL_M);
  const cz = Math.floor((z + WORLD_HALF) / CELL_M);
  let best = maxDist * maxDist;
  let bk = -1;
  for (let gz = Math.max(0, cz - r); gz <= Math.min(GRID - 1, cz + r); gz++)
    for (let gx = Math.max(0, cx - r); gx <= Math.min(GRID - 1, cx + r); gx++) {
      const c = gz * GRID + gx;
      for (let j = idx.cellStart[c]!, e = idx.cellStart[c + 1]!; j < e; j++) {
        const k = idx.items[j]!;
        if (safeOnly && !(idx.flags[k]! & ROAD_SAFE)) continue;
        if (idx.grade[k]! > maxGrade) continue;
        const dx = idx.x[k]! - x;
        const dz = idx.z[k]! - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2;
          bk = k;
        }
      }
    }
  hit.found = bk >= 0;
  if (bk < 0) {
    hit.k = -1;
    hit.dist = Infinity;
    return false;
  }
  hit.k = bk;
  hit.dist = Math.sqrt(best);
  hit.x = idx.x[bk]!;
  hit.y = idx.y[bk]!;
  hit.z = idx.z[bk]!;
  hit.tx = idx.tx[bk]!;
  hit.tz = idx.tz[bk]!;
  hit.halfWidth = idx.halfWidth[bk]!;
  hit.surface = idx.surface[bk]!;
  hit.grade = idx.grade[bk]!;
  hit.safe = (idx.flags[bk]! & ROAD_SAFE) !== 0;
  hit.road = idx.road[bk]!;
  return true;
}

/**
 * Road surface id under (x, z), or -1 when off every road: the nearest sample within 10 m whose
 * half-width covers the point (perpendicular distance from the sample's tangent line).
 */
export function roadSurfaceAt(idx: RoadIndex, x: number, z: number): number {
  if (!nearestRoad(idx, x, z, 10)) return -1;
  const dx = x - hit.x;
  const dz = z - hit.z;
  const across = Math.abs(dx * hit.tz - dz * hit.tx);
  return across <= hit.halfWidth ? hit.surface : -1;
}
