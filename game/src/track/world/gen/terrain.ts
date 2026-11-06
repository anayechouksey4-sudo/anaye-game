/**
 * Heightfield construction: natural base → road corridors (exact road heights) → cut/fill
 * envelopes (eased slopes ≤ 1:3 for fills ≤ 6 m, ≤ 24° otherwise; inside cliff masks they stop at
 * the 6 m shoulder) → smoothing passes that never touch corridors → re-clamp → 1/256 m rounding.
 * Pure.
 */
import type { Island } from './island';
import { flatDistFn, type RoadBuild } from './roads';
import { COBBLE_HILL as COBBLE_HILL_, DEG as DEG_, FLAT_AREAS as FLAT_AREAS_, GLASSMERE as GLASSMERE_, PEAK as PEAK_, rimR as rimR_, thetaOf as thetaOf_ } from './tessera';
import { CELL, WORLD_CELLS, WORLD_HALF, WORLD_N } from './types';

// Local aliases (hot loops must not go through module-namespace getters).
const DEG = DEG_;
const FLAT_AREAS = FLAT_AREAS_;
const GLASSMERE = GLASSMERE_;
const PEAK = PEAK_;
const COBBLE_HILL = COBBLE_HILL_;
const rimR = rimR_;
const thetaOf = thetaOf_;

/** Envelope reach beyond the corridor edge, m (adaptive per sample, never more). */
export const ENV_REACH = 72;
/** Shoulder (cliff-free) band beyond a road edge, m. */
export const SHOULDER = 6;
/**
 * Inside cliff zones the envelopes still reach this far beyond the corridor edge, so every vertex
 * of a cell that is not masked (any corner within the shoulder) stays under the eased slopes.
 */
const ZONE_ENV = SHOULDER + 6;
/** Massif core mask: natural terrain above this height within CORE_R of the peak. */
export const CORE_H = 52;
export const CORE_R = 290;
const PHI_STEP = 0.25;
const PHI_N = Math.ceil(ENV_REACH / PHI_STEP) + 2;
/** Eased slope onset over this distance (keeps the slope change per 4 m cell small). */
const EASE = 20;
const CUT_SLOPE = 0.42; // with a 12 % road grade along it: √(0.42² + 0.12²) = 0.437 < tan 25° (0.466)
const FILL_SLOPE_SHALLOW = 0.3; // with the grade: √(0.3² + 0.09²) = 0.313 < 1:3 (0.333) while the fill is ≤ 6 m deep
const FILL_SLOPE_DEEP = 0.42;

function buildPhi(maxSlope: (depth: number) => number): Float64Array {
  const t = new Float64Array(PHI_N);
  let h = 0;
  for (let i = 1; i < PHI_N; i++) {
    const e = (i - 0.5) * PHI_STEP;
    const u = e / EASE;
    const ease = e >= EASE ? 1 : u * u * (3 - 2 * u);
    h += maxSlope(h) * ease * PHI_STEP;
    t[i] = h;
  }
  return t;
}
export const PHI_UP = buildPhi(() => CUT_SLOPE);
export const PHI_DOWN = buildPhi((depth) => (depth < 7.5 ? FILL_SLOPE_SHALLOW : FILL_SLOPE_DEEP));
export function phi(table: Float64Array, e: number): number {
  if (e <= 0) return 0;
  const f = e / PHI_STEP;
  const i = Math.floor(f);
  if (i >= PHI_N - 1) return table[PHI_N - 1]! + (f - (PHI_N - 1)) * PHI_STEP * 0.44;
  return table[i]! + (table[i + 1]! - table[i]!) * (f - i);
}
/** Smallest e at which both envelopes exceed `dev` metres (the reach needed for a deviation). */
export function reachFor(dev: number): number {
  if (dev <= 0) return 2;
  let i = 1;
  while (i < PHI_N && Math.min(PHI_UP[i]!, PHI_DOWN[i]!) < dev) i++;
  return Math.min(ENV_REACH, i * PHI_STEP + 4);
}

export interface TerrainBuild {
  /** Final heights (row-major), rounded to 1/256 m. */
  heights: Float32Array;
  /** Natural terrain incl. landforms and the gulch carve, before roads (row-major). */
  natural: Float32Array;
  /** 1 = corridor or flat area vertex (exact height). */
  fixed: Uint8Array;
  /** Road index owning a corridor vertex (-1 none, -2 flat area). */
  corrRoad: Int16Array;
  /** Distance to the nearest road centreline (m, ≤ 64; chamfer-approximate beyond ~20 m). */
  roadDist: Float32Array;
  roadNear: Int16Array;
  roadStation: Float32Array;
  /** Distance from the nearest road EDGE (exact within the envelope bands, else ≥ 20). */
  edgeDist: Float32Array;
  /** Cliff mask per cell (512²): 1 = natural cliff zone, 2 = quay wall. */
  cliff: Uint8Array;
  /** Envelope conflicts (vertices where the lower bound exceeded the upper bound). */
  conflicts: number;
  /** Per vertex: 1 where an envelope conflict was resolved by averaging (diagnostics). */
  conflictMask: Uint8Array;
  /** Per vertex cliff zone (1 natural cliff / bench, 2 quay wall) before the shoulder exclusion. */
  zone: Uint8Array;
  /** Per vertex: index into FLAT_AREAS of the flat area it lies in (-1 none). */
  areaIdx: Int8Array;
}

const N = WORLD_N;
const HALF = WORLD_HALF;
const STEP = CELL;
const NCELL = WORLD_CELLS;
const vx = (ix: number) => -HALF + STEP * ix;
const toIx = (x: number) => (x + HALF) / STEP;

/** Gulch: the canyon section of the Cinnabar Loop (stations s0..s1). */
export interface GulchSpec {
  road: RoadBuild;
  s0: number;
  s1: number;
}

/** Natural terrain: evaluated every 8 m and Catmull-Rom upsampled (C1, no kinks). */
function naturalGrid(island: Island): Float32Array {
  const C = 257; // coarse vertices per side (8 m)
  const coarse = new Float64Array(C * C);
  for (let iz = 0; iz < C; iz++) for (let ix = 0; ix < C; ix++) coarse[iz * C + ix] = island.baseAt(-HALF + 8 * ix, -HALF + 8 * iz);
  const out = new Float32Array(N * N);
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const at = (ix: number, iz: number) => coarse[Math.max(0, Math.min(C - 1, iz)) * C + Math.max(0, Math.min(C - 1, ix))]!;
  const row = new Float64Array(4);
  for (let iz = 0; iz < N; iz++) {
    const cz = iz >> 1;
    const tz = (iz & 1) * 0.5;
    for (let ix = 0; ix < N; ix++) {
      const cx = ix >> 1;
      const tx = (ix & 1) * 0.5;
      if (tx === 0 && tz === 0) {
        out[iz * N + ix] = coarse[cz * C + cx]!;
        continue;
      }
      for (let k = -1; k <= 2; k++) {
        const zz = cz + k;
        row[k + 1] = tx === 0 ? at(cx, zz) : cr(at(cx - 1, zz), at(cx, zz), at(cx + 1, zz), at(cx + 2, zz), tx);
      }
      out[iz * N + ix] = tz === 0 ? row[1]! : cr(row[0]!, row[1]!, row[2]!, row[3]!, tz);
    }
  }
  return out;
}

interface Grids {
  natural: Float32Array;
  fixed: Uint8Array;
  fixedH: Float64Array;
  corrRoad: Int16Array;
  roadDist: Float32Array;
  roadNear: Int16Array;
  roadStation: Float32Array;
  edgeDist: Float32Array;
  U: Float64Array;
  Lo: Float64Array;
  zone: Uint8Array;
  areaIdx: Int8Array;
}

export function buildTerrain(island: Island, roads: RoadBuild[], gulch: GulchSpec | null, timings?: Record<string, number>): TerrainBuild {
  const NV = N * N;
  let tMark = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    if (timings) timings[name] = (timings[name] ?? 0) + (now - tMark);
    tMark = now;
  };
  const g: Grids = {
    natural: naturalGrid(island),
    fixed: new Uint8Array(NV),
    fixedH: new Float64Array(NV),
    corrRoad: new Int16Array(NV).fill(-1),
    roadDist: new Float32Array(NV).fill(64),
    roadNear: new Int16Array(NV).fill(-1),
    roadStation: new Float32Array(NV),
    edgeDist: new Float32Array(NV).fill(64),
    U: new Float64Array(NV).fill(Infinity),
    Lo: new Float64Array(NV).fill(-Infinity),
    zone: new Uint8Array(NV),
    areaIdx: new Int8Array(NV).fill(-1),
  };
  lap('t.natural');
  if (gulch) carveGulch(g.natural, g.zone, gulch);
  lap('t.gulch');
  const flatFns = FLAT_AREAS.map((a) => flatDistFn(a));
  FLAT_AREAS.forEach((a, k) => stampFlat(g, a.y, flatFns[k]!, flatBounds(a), k));
  lap('t.flats');
  const order = [...roads].sort((a, b) => b.def.priority - a.def.priority || b.index - a.index);
  const tmpD = new Float64Array(NV).fill(Infinity);
  const tmpH = new Float64Array(NV);
  for (const r of order) stampCorridor(g, r, tmpD, tmpH);
  lap('t.corridors');
  buildZones(g, island);
  for (const r of roads) {
    if (r.def.kind === 'mountain')
      benchZones(
        g,
        r,
        (x, z) => Math.hypot(x - PEAK.x, z - PEAK.z) < 400,
        (x) => x > -376, // strata stop at the city edge (Avenue 380 keeps its own shoulder)
      );
    else if (r.def.id === 'castle-ramp') benchZones(g, r, (x, z) => Math.hypot(x - COBBLE_HILL.x, z - COBBLE_HILL.z) < 180);
    else if (gulch && r === gulch.road) benchZones(g, r, (_x, _z, s) => s >= gulch.s0 && s <= gulch.s1);
  }
  lap('t.zones');
  const tmpR = new Float64Array(NV);
  for (const r of roads) if (!r.def.quay) envelopeRoad(g, r, reachProfile(g.natural, r), tmpD, tmpH, tmpR);
  lap('t.envelopes');
  FLAT_AREAS.forEach((a, k) => {
    // pads on hills (courtyard, plaza, saddle) only need their eased shoulder; low areas get the full reach
    const reach = a.id === 'cobblekeep' ? 4 : a.id === 'plaza' || a.id === 'saddle' ? 20 : ENV_REACH;
    if (!a.quay) envelopeFlat(g, a.y, flatFns[k]!, flatBounds(a, reach), reach);
  });
  lap('t.flatEnv');
  chamfer(g.roadDist, g.roadNear, g.roadStation);
  lap('t.chamfer');
  const h = new Float64Array(NV);
  const conflictMask = new Uint8Array(NV);
  const conflicts = compose(g, h, conflictMask);
  // a zone vertex with no envelope on it is a free cliff: neither smoothed nor used as a neighbour
  const cliffy = new Uint8Array(NV);
  for (let v = 0; v < NV; v++) if (g.zone[v] && g.U[v] === Infinity && g.Lo[v] === -Infinity) cliffy[v] = 1;
  const tmpS = new Float64Array(NV);
  for (let pass = 0; pass < 14; pass++) smoothPass(g, h, tmpS, cliffy);
  lap('t.compose');
  lakeFloor(g.fixed, h);
  const heights = new Float32Array(NV);
  for (let v = 0; v < NV; v++) heights[v] = Math.round(h[v]! * 256) / 256;
  const cliff = cliffMask(g.zone, g.edgeDist);
  lap('t.finish');
  return {
    heights,
    natural: g.natural,
    fixed: g.fixed,
    corrRoad: g.corrRoad,
    roadDist: g.roadDist,
    roadNear: g.roadNear,
    roadStation: g.roadStation,
    edgeDist: g.edgeDist,
    cliff,
    conflicts,
    conflictMask,
    zone: g.zone,
    areaIdx: g.areaIdx,
  };
}

/** Gulch carve: the canyon follows the loop road between s0 and s1 (walls are cliff-masked). */
function carveGulch(natural: Float32Array, zone: Uint8Array, gulch: GulchSpec): void {
  const r = gulch.road;
  const half = r.def.width / 2 + 1 + SHOULDER;
  const reach = half + 30;
  for (let i = 0; i < r.n; i++) {
    const s = i * r.ds;
    if (s < gulch.s0 || s > gulch.s1) continue;
    const taper = Math.min(1, (s - gulch.s0) / 40, (gulch.s1 - s) / 40);
    const x = r.xs[i]!;
    const z = r.zs[i]!;
    const h = r.h[i]!;
    const ix0 = Math.max(0, Math.floor(toIx(x - reach)));
    const ix1 = Math.min(N - 1, Math.ceil(toIx(x + reach)));
    const iz0 = Math.max(0, Math.floor(toIx(z - reach)));
    const iz1 = Math.min(N - 1, Math.ceil(toIx(z + reach)));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const v = iz * N + ix;
        const ddx = vx(ix) - x;
        const ddz = vx(iz) - z;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > reach) continue;
        const carve = h + 1.6 * Math.max(0, d - half);
        const cur = natural[v]!;
        if (carve < cur + 6 && taper > 0 && d > half - 0.5 && cur > h + 1.5) zone[v] = 1;
        if (carve < cur) natural[v] = cur + (carve - cur) * taper;
      }
  }
}

function stampFlat(g: Grids, y: number, f: (x: number, z: number) => number, bb: [number, number, number, number], k: number): void {
  const fixed = g.fixed;
  const fixedH = g.fixedH;
  const corrRoad = g.corrRoad;
  const areaIdx = g.areaIdx;
  for (let iz = bb[2]; iz <= bb[3]; iz++)
    for (let ix = bb[0]; ix <= bb[1]; ix++) {
      const v = iz * N + ix;
      if (f(vx(ix), vx(iz)) <= 0) {
        fixed[v] = 1;
        fixedH[v] = y;
        corrRoad[v] = -2;
        areaIdx[v] = k;
      }
    }
}

/** Exact corridor (width/2 + 1 m): every vertex takes the road height at its nearest centreline point. */
function stampCorridor(g: Grids, r: RoadBuild, tmpD: Float64Array, tmpH: Float64Array): void {
  const fixed = g.fixed;
  const fixedH = g.fixedH;
  const corrRoad = g.corrRoad;
  const roadDist = g.roadDist;
  const roadNear = g.roadNear;
  const roadStation = g.roadStation;
  const edgeDist = g.edgeDist;
  const halfW = r.def.width / 2;
  // quays (the pier) keep one extra cell of deck so the wall never tilts the wheel tracks
  const half = halfW + (r.def.quay ? 5 : 1);
  const reach = half + 3;
  const touched: number[] = [];
  const segs = r.closed ? r.n : r.n - 1;
  const xs = r.xs;
  const zs = r.zs;
  const hs = r.h;
  const n = r.n;
  const ri = r.index;
  const rds = r.ds;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const ax = xs[i]!;
    const az = zs[i]!;
    const dx = xs[j]! - ax;
    const dz = zs[j]! - az;
    const ha = hs[i]!;
    const dh = hs[j]! - ha;
    const L2 = dx * dx + dz * dz;
    const invL2 = L2 > 0 ? 1 / L2 : 0;
    const ix0 = Math.max(0, Math.floor(toIx(Math.min(ax, ax + dx) - reach)));
    const ix1 = Math.min(N - 1, Math.ceil(toIx(Math.max(ax, ax + dx) + reach)));
    const iz0 = Math.max(0, Math.floor(toIx(Math.min(az, az + dz) - reach)));
    const iz1 = Math.min(N - 1, Math.ceil(toIx(Math.max(az, az + dz) + reach)));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = vx(iz);
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = vx(ix);
        let t = ((px - ax) * dx + (pz - az) * dz) * invL2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px;
        const qz = az + dz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        if (d > reach) continue;
        const v = iz * N + ix;
        if (tmpD[v] === Infinity) touched.push(v);
        if (d < tmpD[v]!) {
          tmpD[v] = d;
          tmpH[v] = ha + dh * t;
          if (d < roadDist[v]!) {
            roadDist[v] = d;
            roadNear[v] = ri;
            roadStation[v] = (i + t) * rds;
          }
        }
      }
    }
  }
  for (let k = 0; k < touched.length; k++) {
    const v = touched[k]!;
    const d = tmpD[v]!;
    if (d <= half + 1e-9) {
      fixed[v] = 1;
      fixedH[v] = tmpH[v]!;
      corrRoad[v] = ri;
    }
    const ed = d > halfW ? d - halfW : 0;
    if (ed < edgeDist[v]!) edgeDist[v] = ed;
    tmpD[v] = Infinity;
  }
}

function zoneBox(zone: Uint8Array, x0: number, x1: number, z0: number, z1: number, fn: (v: number, x: number, z: number) => number): void {
  const ix0 = Math.max(0, Math.floor(toIx(x0)));
  const ix1 = Math.min(N - 1, Math.ceil(toIx(x1)));
  const iz0 = Math.max(0, Math.floor(toIx(z0)));
  const iz1 = Math.min(N - 1, Math.ceil(toIx(z1)));
  for (let iz = iz0; iz <= iz1; iz++)
    for (let ix = ix0; ix <= ix1; ix++) {
      const v = iz * N + ix;
      if (zone[v]) continue;
      const m = fn(v, vx(ix), vx(iz));
      if (m) zone[v] = m;
    }
}

/** Cliff mask zones per vertex: massif core, buttes, Shell Cove cliffs, quay walls (the gulch is already in). */
function buildZones(g: Grids, island: Island): void {
  const zone = g.zone;
  const natural = g.natural;
  const px0 = PEAK.x;
  const pz0 = PEAK.z;
  zoneBox(zone, px0 - CORE_R, px0 + CORE_R, pz0 - CORE_R, pz0 + CORE_R, (v, x, z) =>
    natural[v]! > CORE_H && (x - px0) * (x - px0) + (z - pz0) * (z - pz0) < CORE_R * CORE_R ? 1 : 0,
  );
  for (const b of island.buttes) {
    const R = b.r + 14;
    zoneBox(zone, b.x - R, b.x + R, b.z - R, b.z + R, (_v, x, z) => ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < R * R ? 1 : 0));
  }
  zoneBox(zone, 350, 1024, -460, 160, (_v, x, z) => {
    const t = thetaOf(x, z);
    return (t >= 350 || t <= 30) && Math.sqrt(x * x + z * z) > rimR(t * DEG) + 8 + SHOULDER && island.landDist(x, z) > -70 ? 1 : 0;
  });
  zoneBox(zone, -616, -584, 368, 486, () => 2);
  zoneBox(zone, -742, -498, 362, 388, () => 2);
}

/**
 * Strata benches along The Crown's mountain roads (PLAN: "guard rail + strata wall" between summit
 * legs): beyond the 6 m shoulder, wherever the cut/fill envelope would still bind, the terrain keeps
 * its natural shape behind a cliff-masked wall instead of an endless embankment.
 */
function benchZones(g: Grids, r: RoadBuild, where: (x: number, z: number, s: number) => boolean, inside: (x: number, z: number) => boolean = () => true): void {
  const zone = g.zone;
  const natural = g.natural;
  const half = r.def.width / 2 + 1;
  const reach = half + ENV_REACH + 4;
  for (let i = 0; i < r.n; i += 2) {
    const x = r.xs[i]!;
    const z = r.zs[i]!;
    if (!where(x, z, i * r.ds)) continue;
    const h = r.h[i]!;
    const ix0 = Math.max(0, Math.floor(toIx(x - reach)));
    const ix1 = Math.min(N - 1, Math.ceil(toIx(x + reach)));
    const iz0 = Math.max(0, Math.floor(toIx(z - reach)));
    const iz1 = Math.min(N - 1, Math.ceil(toIx(z + reach)));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const v = iz * N + ix;
        if (zone[v]) continue;
        const dx = vx(ix) - x;
        const dz = vx(iz) - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const e = d - half;
        if (e <= SHOULDER + 2 || e > ENV_REACH + 4) continue;
        if (g.fixed[v] || !inside(vx(ix), vx(iz))) continue;
        const dev = natural[v]! - h;
        // 3 m margin: other roads nearby may sit a little below / above the natural ground
        if (dev > phi(PHI_UP, e) - 3 || -dev > phi(PHI_DOWN, e) - 3) zone[v] = 1;
      }
  }
}

const PROBES = [4, 10, 18, 28, 40, 56, 72];
/** Envelope reach per sample: beyond the farthest lateral probe where the natural terrain leaves the envelope. */
function reachProfile(natural: Float32Array, r: RoadBuild): Float64Array {
  const half = r.def.width / 2 + 1;
  const n = r.n;
  const out = new Float64Array(n);
  const probeUp = PROBES.map((o) => phi(PHI_UP, o) - 1.5);
  const probeDn = PROBES.map((o) => phi(PHI_DOWN, o) - 1.5);
  for (let i = 0; i < n; i++) {
    let need = 8;
    const nx = -r.tz[i]!;
    const nz = r.tx[i]!;
    const hi = r.h[i]!;
    const x = r.xs[i]!;
    const z = r.zs[i]!;
    for (let k = 0; k < PROBES.length; k++) {
      const off = half + PROBES[k]!;
      const a = natAt(natural, x + nx * off, z + nz * off) - hi;
      const b = natAt(natural, x - nx * off, z - nz * off) - hi;
      const up = probeUp[k]!;
      const dn = probeDn[k]!;
      if (a > up || b > up || -a > dn || -b > dn) need = Math.min(ENV_REACH, (PROBES[k + 1] ?? ENV_REACH) + 2);
    }
    out[i] = need;
  }
  return out;
}

function natAt(natural: Float32Array, x: number, z: number): number {
  let ix = Math.round(toIx(x));
  let iz = Math.round(toIx(z));
  ix = ix < 0 ? 0 : ix > N - 1 ? N - 1 : ix;
  iz = iz < 0 ? 0 : iz > N - 1 ? N - 1 : iz;
  return natural[iz * N + ix]!;
}

/**
 * Cut/fill envelope of one road from each vertex's NEAREST centreline point (a min over chords of
 * a sloped road would conflict right at the corridor edge, where the eased envelope is ~0). The
 * along-road gradient adds to the eased cross slope, so CUT_SLOPE leaves room for 12 % grades.
 * Also refines the road / edge distance fields nearby.
 */
function envelopeRoad(g: Grids, r: RoadBuild, reachAt: Float64Array, tmpD: Float64Array, tmpH: Float64Array, tmpR: Float64Array): void {
  const U = g.U;
  const Lo = g.Lo;
  const fixed = g.fixed;
  const zone = g.zone;
  const roadDist = g.roadDist;
  const roadNear = g.roadNear;
  const roadStation = g.roadStation;
  const edgeDist = g.edgeDist;
  const PU = PHI_UP;
  const PD = PHI_DOWN;
  const inv = 1 / PHI_STEP;
  const lastPhi = PHI_N - 2;
  const halfW = r.def.width / 2;
  const half = halfW + 1;
  const n = r.n;
  const ri = r.index;
  const rds = r.ds;
  const xs = r.xs;
  const zs = r.zs;
  const hs = r.h;
  const step = 2;
  const segs = r.closed ? n : n - 1;
  const touched: number[] = [];
  for (let i = 0; i < segs; i += step) {
    const j = r.closed ? (i + step) % n : Math.min(n - 1, i + step);
    const span = r.closed ? step : j - i;
    const er = Math.max(reachAt[i]!, reachAt[j]!, reachAt[(i + 1) % n]!);
    const reach = half + er;
    const reach2 = reach * reach;
    const ax = xs[i]!;
    const az = zs[i]!;
    const dx = xs[j]! - ax;
    const dz = zs[j]! - az;
    const ha = hs[i]!;
    const dh = hs[j]! - ha;
    const L2 = dx * dx + dz * dz;
    const invL2 = L2 > 0 ? 1 / L2 : 0;
    const cx = ax + dx / 2;
    const cz = az + dz / 2;
    const hl = Math.sqrt(L2) / 2;
    const iz0 = Math.max(0, Math.floor(toIx(cz - reach - hl)));
    const iz1 = Math.min(N - 1, Math.ceil(toIx(cz + reach + hl)));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = vx(iz);
      const oz = Math.abs(pz - cz) - hl;
      const wx = oz > 0 ? (reach2 > oz * oz ? Math.sqrt(reach2 - oz * oz) : -1) : reach;
      if (wx < 0) continue;
      const ix0 = Math.max(0, Math.floor(toIx(cx - wx - hl)));
      const ix1 = Math.min(N - 1, Math.ceil(toIx(cx + wx + hl)));
      let v = iz * N + ix0;
      for (let ix = ix0; ix <= ix1; ix++, v++) {
        const px = vx(ix);
        let t = ((px - ax) * dx + (pz - az) * dz) * invL2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px;
        const qz = az + dz * t - pz;
        const d2 = qx * qx + qz * qz;
        if (d2 > reach2) continue;
        const d = Math.sqrt(d2);
        if (tmpD[v] === Infinity) touched.push(v);
        if (d < tmpD[v]!) {
          tmpD[v] = d;
          tmpH[v] = ha + dh * t;
          tmpR[v] = er;
          if (d < roadDist[v]! - 0.25) {
            roadDist[v] = d;
            roadNear[v] = ri;
            roadStation[v] = (i + t * span) * rds;
          }
        }
      }
    }
  }
  for (let k = 0; k < touched.length; k++) {
    const v = touched[k]!;
    const d = tmpD[v]!;
    const h = tmpH[v]!;
    const er = tmpR[v]!;
    tmpD[v] = Infinity;
    const ed = d > halfW ? d - halfW : 0;
    if (ed < edgeDist[v]!) edgeDist[v] = ed;
    if (fixed[v]) continue;
    const e = d - half;
    if (e > er || (e > ZONE_ENV && zone[v])) continue;
    let up = h;
    let lo = h;
    if (e > 0) {
      const f = e * inv;
      let q = f | 0;
      if (q > lastPhi) q = lastPhi;
      const w = f - q;
      up += PU[q]! + (PU[q + 1]! - PU[q]!) * w;
      lo -= PD[q]! + (PD[q + 1]! - PD[q]!) * w;
    }
    if (up < U[v]!) U[v] = up;
    if (lo > Lo[v]!) Lo[v] = lo;
  }
}

function envelopeFlat(g: Grids, y: number, f: (x: number, z: number) => number, bb: [number, number, number, number], reach: number): void {
  const U = g.U;
  const Lo = g.Lo;
  const fixed = g.fixed;
  const zone = g.zone;
  for (let iz = bb[2]; iz <= bb[3]; iz++)
    for (let ix = bb[0]; ix <= bb[1]; ix++) {
      const v = iz * N + ix;
      if (fixed[v]) continue;
      const e = f(vx(ix), vx(iz));
      if (e > reach || (zone[v] && e > ZONE_ENV)) continue;
      const up = y + phi(PHI_UP, e);
      const lo = y - phi(PHI_DOWN, e);
      if (up < U[v]!) U[v] = up;
      if (lo > Lo[v]!) Lo[v] = lo;
    }
}

function compose(g: Grids, h: Float64Array, mask: Uint8Array): number {
  const fixed = g.fixed;
  const fixedH = g.fixedH;
  const U = g.U;
  const Lo = g.Lo;
  const natural = g.natural;
  let conflicts = 0;
  for (let v = 0; v < h.length; v++) {
    if (fixed[v]) {
      h[v] = fixedH[v]!;
      continue;
    }
    const lo = Lo[v]!;
    const up = U[v]!;
    const nat = natural[v]!;
    if (lo > up + 1e-6) {
      conflicts++;
      mask[v] = 1;
      h[v] = (lo + up) / 2;
    } else h[v] = nat < lo ? lo : nat > up ? up : nat;
  }
  return conflicts;
}

/** One smoothing pass (free land below 120 m) with re-clamp; never touches corridors or free cliffs. */
function smoothPass(g: Grids, h: Float64Array, tmp: Float64Array, cliffy: Uint8Array): void {
  const fixed = g.fixed;
  const U = g.U;
  const Lo = g.Lo;
  tmp.set(h);
  for (let iz = 1; iz < N - 1; iz++)
    for (let ix = 1; ix < N - 1; ix++) {
      const v = iz * N + ix;
      const c = tmp[v]!;
      if (fixed[v] || cliffy[v] || c > 120 || c < -3) continue;
      let sum = 2 * c;
      let w = 2;
      if (!cliffy[v - 1]) {
        sum += tmp[v - 1]!;
        w++;
      }
      if (!cliffy[v + 1]) {
        sum += tmp[v + 1]!;
        w++;
      }
      if (!cliffy[v - N]) {
        sum += tmp[v - N]!;
        w++;
      }
      if (!cliffy[v + N]) {
        sum += tmp[v + N]!;
        w++;
      }
      const avg = sum / w;
      const lo = Lo[v]!;
      const up = U[v]!;
      h[v] = lo > up ? (lo + up) / 2 : avg < lo ? lo : avg > up ? up : avg;
    }
}

/** Glassmere: the bed never goes below 17.4 m (≤ 0.6 m deep everywhere). */
function lakeFloor(fixed: Uint8Array, h: Float64Array): void {
  const L = GLASSMERE;
  const lx0 = Math.max(0, Math.floor(toIx(L.x - L.a * 1.3)));
  const lx1 = Math.min(N - 1, Math.ceil(toIx(L.x + L.a * 1.3)));
  const lz0 = Math.max(0, Math.floor(toIx(L.z - L.b * 1.3)));
  const lz1 = Math.min(N - 1, Math.ceil(toIx(L.z + L.b * 1.3)));
  for (let iz = lz0; iz <= lz1; iz++)
    for (let ix = lx0; ix <= lx1; ix++) {
      const ex = (vx(ix) - L.x) / L.a;
      const ez = (vx(iz) - L.z) / L.b;
      const v = iz * N + ix;
      if (ex * ex + ez * ez < 1.5625 && !fixed[v] && h[v]! < L.bed) h[v] = L.bed;
    }
}

/** Cliff mask per cell: a zone cell (any corner) more than SHOULDER from every road edge (quays always). */
function cliffMask(zone: Uint8Array, edgeDist: Float32Array): Uint8Array {
  const cliff = new Uint8Array(NCELL * NCELL);
  for (let cz = 0; cz < NCELL; cz++)
    for (let cx = 0; cx < NCELL; cx++) {
      const v = cz * N + cx;
      const z = Math.max(zone[v]!, zone[v + 1]!, zone[v + N]!, zone[v + N + 1]!);
      if (!z) continue;
      const minEdge = Math.min(edgeDist[v]!, edgeDist[v + 1]!, edgeDist[v + N]!, edgeDist[v + N + 1]!);
      if (z === 2 || minEdge > SHOULDER - 0.01) cliff[cz * NCELL + cx] = z;
    }
  return cliff;
}

/** Two-pass 3×3 chamfer distance transform (4 m grid) that only lowers distances; copies the source road. */
function chamfer(dist: Float32Array, near: Int16Array, station: Float32Array): void {
  const a = STEP;
  const b = STEP * Math.SQRT2;
  const relax = (v: number, u: number, w: number) => {
    const d = dist[u]! + w;
    if (d < dist[v]!) {
      dist[v] = d;
      near[v] = near[u]!;
      station[v] = station[u]!;
    }
  };
  for (let iz = 0; iz < N; iz++)
    for (let ix = 0; ix < N; ix++) {
      const v = iz * N + ix;
      if (ix > 0) relax(v, v - 1, a);
      if (iz > 0) {
        relax(v, v - N, a);
        if (ix > 0) relax(v, v - N - 1, b);
        if (ix < N - 1) relax(v, v - N + 1, b);
      }
    }
  for (let iz = N - 1; iz >= 0; iz--)
    for (let ix = N - 1; ix >= 0; ix--) {
      const v = iz * N + ix;
      if (ix < N - 1) relax(v, v + 1, a);
      if (iz < N - 1) {
        relax(v, v + N, a);
        if (ix < N - 1) relax(v, v + N + 1, b);
        if (ix > 0) relax(v, v + N - 1, b);
      }
    }
  for (let v = 0; v < dist.length; v++) if (dist[v]! > 64) dist[v] = 64;
}

function flatBounds(a: (typeof FLAT_AREAS)[number], pad = 0): [number, number, number, number] {
  const s = a.shape;
  let r: number;
  if (s.kind === 'disc') r = s.r;
  else if (s.kind === 'ellipse') r = Math.max(s.a, s.b);
  else r = Math.hypot(s.halfAlong, s.halfAcross);
  const R = r + pad + 2;
  return [
    Math.max(0, Math.floor(toIx(s.x - R))),
    Math.min(N - 1, Math.ceil(toIx(s.x + R))),
    Math.max(0, Math.floor(toIx(s.z - R))),
    Math.min(N - 1, Math.ceil(toIx(s.z + R))),
  ];
}
