/**
 * Road network: centreline sampling (≈ 2 m), junction detection, flat zones (pads, junction pads,
 * flat areas) and vertical profiles. Pure.
 *
 * Profile solve (per road, in priority order, every cross-section level):
 *   1. piecewise-linear interpolation of the height keys (authored anchors + flat-zone heights);
 *   2. flat zones are fixed, widened by W/2 so the box filter leaves them exactly level;
 *   3. grade clamp against the fixed samples (two-sided Lipschitz envelope + sweeps);
 *   4. box filter of width W: grade stays ≤ max and every vertical curve gets R ≥ W / Δgrade;
 *   5. rally hops are added as explicit sag / crest / sag shapes on level stretches.
 * A lower-priority road that joins a higher one is pinned to the higher road's final height.
 */
import { catmullRom, filletPath, planRadii, resample, type P2 } from './geom';
import { DEG, FLAT_AREAS, RIM_FLATS, RIM_KEYS, rimAt, type FlatArea, type RoadDef } from './tessera';
import { ROAD_HOP, ROAD_JUNCTION, ROAD_PAD } from './types';

export const ROAD_DS = 2;
export const PAD_R = 24;

export interface FlatZone {
  s0: number;
  s1: number;
  h: number;
  kind: 'pad' | 'junction' | 'area' | 'flat';
}

export interface Junction {
  major: number;
  minor: number;
  sMajor: number;
  sMinor: number;
  x: number;
  z: number;
  /** Pad radius = max(widths) + 6. */
  r: number;
  /** Crossing angle, rad (0..π/2). */
  angle: number;
  h: number;
}

export interface RoadBuild {
  def: RoadDef;
  index: number;
  n: number;
  ds: number;
  length: number;
  closed: boolean;
  xs: Float64Array;
  zs: Float64Array;
  tx: Float64Array;
  tz: Float64Array;
  radius: Float64Array;
  h: Float64Array;
  base: Float64Array;
  flags: Uint8Array;
  flats: FlatZone[];
  junctions: Junction[];
  /** Hop zones [s0, s1] (crest R ≥ 40 m allowed there). */
  hopZones: [number, number][];
  warnings: string[];
  solved: boolean;
}

// ── Sampling ────────────────────────────────────────────────────────────────────────────────

function densePath(def: RoadDef): P2[] {
  const p = def.path;
  if ('catmull' in p) return catmullRom(p.catmull, !!def.closed, 0.5);
  if ('fillet' in p) return filletPath(p.fillet, !!def.closed, 0.5, def.id);
  const out: P2[] = [];
  for (let i = 0; i < p.line.length - 1; i++) {
    const a = p.line[i]!;
    const b = p.line[i + 1]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k < m; k++) out.push([a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m]);
  }
  out.push([p.line[p.line.length - 1]![0], p.line[p.line.length - 1]![1]]);
  return out;
}

/** Nearest station on a sampled road to (x, z) (segment projection). */
export function projectOnRoad(r: { xs: Float64Array; zs: Float64Array; n: number; ds: number; closed: boolean }, x: number, z: number): { s: number; d: number; x: number; z: number } {
  const n = r.n;
  const segs = r.closed ? n : n - 1;
  let best = Infinity;
  let bs = 0;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const ax = r.xs[i]!;
    const az = r.zs[i]!;
    const dx = r.xs[j]! - ax;
    const dz = r.zs[j]! - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) {
      best = d;
      bs = (i + t) * r.ds;
      bx = px;
      bz = pz;
    }
  }
  return { s: bs, d: Math.sqrt(best), x: bx, z: bz };
}

/** Interpolated value of a per-sample array at station s. */
export function atStation(r: { n: number; ds: number; closed: boolean }, arr: ArrayLike<number>, s: number): number {
  const n = r.n;
  let f = s / r.ds;
  if (r.closed) {
    f %= n;
    if (f < 0) f += n;
  } else f = Math.max(0, Math.min(n - 1, f));
  const i = Math.floor(f);
  const t = f - i;
  const a = arr[i % n]!;
  const b = arr[r.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
  return a + (b - a) * t;
}

export function sampleRoads(defs: readonly RoadDef[]): RoadBuild[] {
  const roads: RoadBuild[] = [];
  defs.forEach((def, index) => {
    const dense = densePath(def);
    // Snap open-road endpoints onto a higher-priority road that passes within 8 m.
    if (!def.closed) {
      for (const end of [0, dense.length - 1]) {
        const p = dense[end]!;
        let best: { d: number; x: number; z: number } | null = null;
        for (const other of roads) {
          if (other.def.priority >= def.priority) continue;
          const hit = projectOnRoad(other, p[0], p[1]);
          if (hit.d < 8 && (!best || hit.d < best.d)) best = hit;
        }
        if (best && best.d > 1e-6) dense[end] = [best.x, best.z];
      }
    }
    const rs = resample(dense, !!def.closed, ROAD_DS);
    const n = rs.count;
    const tx = new Float64Array(n);
    const tz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = def.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = def.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const dx = rs.xs[b]! - rs.xs[a]!;
      const dz = rs.zs[b]! - rs.zs[a]!;
      const L = Math.hypot(dx, dz) || 1;
      tx[i] = dx / L;
      tz[i] = dz / L;
    }
    roads.push({
      def,
      index,
      n,
      ds: rs.ds,
      length: rs.length,
      closed: !!def.closed,
      xs: rs.xs,
      zs: rs.zs,
      tx,
      tz,
      radius: planRadii(rs.xs, rs.zs, !!def.closed, 5),
      h: new Float64Array(n),
      base: new Float64Array(n),
      flags: new Uint8Array(n),
      flats: [],
      junctions: [],
      hopZones: [],
      warnings: [],
      solved: false,
    });
  });
  return roads;
}

// ── Junctions ───────────────────────────────────────────────────────────────────────────────

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

export function findJunctions(roads: RoadBuild[]): Junction[] {
  const out: Junction[] = [];
  // bounding boxes for cheap rejection
  const bb = roads.map((r) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < r.n; i++) {
      x0 = Math.min(x0, r.xs[i]!);
      x1 = Math.max(x1, r.xs[i]!);
      z0 = Math.min(z0, r.zs[i]!);
      z1 = Math.max(z1, r.zs[i]!);
    }
    return [x0 - 2, x1 + 2, z0 - 2, z1 + 2] as const;
  });
  const inBox = (k: number, x: number, z: number) => x >= bb[k]![0] && x <= bb[k]![1] && z >= bb[k]![2] && z <= bb[k]![3];
  const add = (major: RoadBuild, minor: RoadBuild, sMajor: number, sMinor: number, x: number, z: number) => {
    for (const j of out) if (j.major === major.index && j.minor === minor.index && Math.hypot(j.x - x, j.z - z) < 10) return;
    const im = Math.round(sMajor / major.ds) % major.n;
    const in_ = Math.min(minor.n - 1, Math.round(sMinor / minor.ds) % minor.n);
    const dot = Math.abs(major.tx[im]! * minor.tx[in_]! + major.tz[im]! * minor.tz[in_]!);
    const angle = Math.acos(Math.min(1, dot));
    const j: Junction = { major: major.index, minor: minor.index, sMajor, sMinor, x, z, r: Math.max(major.def.width, minor.def.width) + 6, angle, h: 0 };
    out.push(j);
    major.junctions.push(j);
    minor.junctions.push(j);
  };
  for (const a of roads) {
    for (const b of roads) {
      if (a === b) continue;
      if (a.def.priority >= b.def.priority) continue; // a = major
      // Endpoints of either road lying on the other.
      for (const [r, other, isMinor] of [
        [b, a, true],
        [a, b, false],
      ] as const) {
        if (r.closed) continue;
        for (const end of [0, r.n - 1]) {
          if (!inBox(other.index, r.xs[end]!, r.zs[end]!)) continue;
          const hit = projectOnRoad(other, r.xs[end]!, r.zs[end]!);
          if (hit.d < 1.5) {
            const sR = end * r.ds;
            if (isMinor) add(a, b, hit.s, sR, hit.x, hit.z);
            else add(a, b, sR, hit.s, hit.x, hit.z);
          }
        }
      }
      // Proper crossings (grid-bucketed segments of the major road).
      const A = bb[a.index]!;
      const B = bb[b.index]!;
      if (A[1] < B[0] || B[1] < A[0] || A[3] < B[2] || B[3] < A[2]) continue;
      const cell = 32;
      const buckets = new Map<number, number[]>();
      const segsA = a.closed ? a.n : a.n - 1;
      for (let i = 0; i < segsA; i++) {
        const i1 = (i + 1) % a.n;
        const kx = Math.floor((a.xs[i]! + a.xs[i1]!) / 2 / cell);
        const kz = Math.floor((a.zs[i]! + a.zs[i1]!) / 2 / cell);
        const key = (kz + 1000) * 4096 + kx + 1000;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(i);
      }
      const segsB = b.closed ? b.n : b.n - 1;
      for (let k = 0; k < segsB; k++) {
        const k1 = (k + 1) % b.n;
        const kx = Math.floor((b.xs[k]! + b.xs[k1]!) / 2 / cell);
        const kz = Math.floor((b.zs[k]! + b.zs[k1]!) / 2 / cell);
        for (let oz = -1; oz <= 1; oz++)
          for (let ox = -1; ox <= 1; ox++) {
            const list = buckets.get((kz + oz + 1000) * 4096 + kx + ox + 1000);
            if (!list) continue;
            for (const i of list) {
              const i1 = (i + 1) % a.n;
              const hit = segIntersect(a.xs[i]!, a.zs[i]!, a.xs[i1]!, a.zs[i1]!, b.xs[k]!, b.zs[k]!, b.xs[k1]!, b.zs[k1]!);
              if (!hit) continue;
              const x = a.xs[i]! + (a.xs[i1]! - a.xs[i]!) * hit[0];
              const z = a.zs[i]! + (a.zs[i1]! - a.zs[i]!) * hit[0];
              add(a, b, (i + hit[0]) * a.ds, (k + hit[1]) * b.ds, x, z);
            }
          }
      }
    }
  }
  return out;
}

/** Half-length of the level zone each road needs around a junction (pad + corridor overlap + one cell). */
export function junctionHalfLengths(j: Junction, roads: RoadBuild[]): { major: number; minor: number } {
  const M = roads[j.major]!.def;
  const m = roads[j.minor]!.def;
  const a = Math.max(j.angle, 25 * DEG);
  const hM = M.width / 2 + 1;
  const hm = m.width / 2 + 1;
  return {
    major: Math.max(j.r, hm / Math.sin(a) + hM / Math.tan(a)) + 6,
    minor: Math.max(j.r, hM / Math.sin(a) + hm / Math.tan(a)) + 6,
  };
}

// ── Flat areas ──────────────────────────────────────────────────────────────────────────────

/** Compiled signed-distance function of a flat area's outline (negative inside), m. */
export function flatDistFn(a: FlatArea): (x: number, z: number) => number {
  const s = a.shape;
  if (s.kind === 'disc') {
    const cx = s.x;
    const cz = s.z;
    const r = s.r;
    return (x, z) => Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)) - r;
  }
  if (s.kind === 'rect') {
    const sx = Math.sin(s.yaw);
    const sz = Math.cos(s.yaw);
    const cx = s.x;
    const cz = s.z;
    const ha = s.halfAlong;
    const hc = s.halfAcross;
    return (x, z) => {
      const dx = x - cx;
      const dz = z - cz;
      const qx = Math.abs(dx * sx + dz * sz) - ha;
      const qz = Math.abs(dx * sz - dz * sx) - hc;
      const ox = qx > 0 ? qx : 0;
      const oz = qz > 0 ? qz : 0;
      return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0);
    };
  }
  // ellipse: approximate signed distance (scaled radial)
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const cx = s.x;
  const cz = s.z;
  const A = s.a;
  const B = s.b;
  const m = Math.min(A, B);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    const u = dx * c + dz * sn;
    const v = -dx * sn + dz * c;
    const k = Math.sqrt((u / A) * (u / A) + (v / B) * (v / B));
    if (k < 1e-9) return -m;
    const rr = Math.sqrt(u * u + v * v) / k;
    return (k - 1) * rr * Math.min(1, m / rr + 0.35);
  };
}

const flatFnCache = new WeakMap<FlatArea, (x: number, z: number) => number>();
/** Signed distance to a flat area's outline (negative inside), m. */
export function flatAreaDist(a: FlatArea, x: number, z: number): number {
  let f = flatFnCache.get(a);
  if (!f) flatFnCache.set(a, (f = flatDistFn(a)));
  return f(x, z);
}

// ── Profiles ────────────────────────────────────────────────────────────────────────────────

function boxFilter(src: Float64Array, closed: boolean, half: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  if (half <= 0) {
    out.set(src);
    return out;
  }
  const w = 2 * half + 1;
  const get = (i: number) => (closed ? src[((i % n) + n) % n]! : src[Math.max(0, Math.min(n - 1, i))]!);
  let sum = 0;
  for (let k = -half; k <= half; k++) sum += get(k);
  for (let i = 0; i < n; i++) {
    out[i] = sum / w;
    sum += get(i + half + 1) - get(i - half);
  }
  return out;
}

interface SolveInput {
  n: number;
  ds: number;
  closed: boolean;
  keys: { s: number; h: number }[];
  flats: FlatZone[];
  grade: number;
  filterW: number;
}

/** Linear key interpolation → fixed flats → grade clamp → box filter. Returns heights per sample. */
export function solveProfile(inp: SolveInput, warn: (msg: string) => void): Float64Array {
  const { n, ds, closed } = inp;
  const L = closed ? n * ds : (n - 1) * ds;
  const keys = inp.keys.map((k) => ({ s: closed ? ((k.s % L) + L) % L : Math.max(0, Math.min(L, k.s)), h: k.h })).sort((a, b) => a.s - b.s);
  const p = new Float64Array(n);
  if (keys.length === 0) throw new Error('road without height keys');
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    if (keys.length === 1) {
      p[i] = keys[0]!.h;
      continue;
    }
    let lo: { s: number; h: number } | null = null;
    let hi: { s: number; h: number } | null = null;
    for (const k of keys) {
      if (k.s <= s) lo = k;
      if (k.s >= s && !hi) hi = k;
    }
    if (closed) {
      if (!lo) lo = { s: keys[keys.length - 1]!.s - L, h: keys[keys.length - 1]!.h };
      if (!hi) hi = { s: keys[0]!.s + L, h: keys[0]!.h };
    } else {
      if (!lo) lo = hi!;
      if (!hi) hi = lo;
    }
    p[i] = hi.s === lo.s ? lo.h : lo.h + ((hi.h - lo.h) * (s - lo.s)) / (hi.s - lo.s);
  }
  // Fixed samples: flats widened by W/2 + one sample.
  const half = Math.round(inp.filterW / 2 / ds);
  const fixed = new Uint8Array(n);
  const fixedH = new Float64Array(n);
  for (const f of inp.flats) {
    const i0 = Math.floor(f.s0 / ds) - half - 1;
    const i1 = Math.ceil(f.s1 / ds) + half + 1;
    for (let i = i0; i <= i1; i++) {
      let k = i;
      if (closed) k = ((i % n) + n) % n;
      else if (i < 0 || i >= n) continue;
      if (fixed[k] && Math.abs(fixedH[k]! - f.h) > 1e-6) {
        // Two widened zones disagree: keep the inner (unwidened) one.
        const inner = i * ds >= f.s0 && i * ds <= f.s1;
        if (!inner) continue;
      }
      fixed[k] = 1;
      fixedH[k] = f.h;
      p[k] = f.h;
    }
  }
  const G = inp.grade * 0.985 * ds;
  // Envelope from fixed samples (forward/backward, twice around for closed roads).
  const U = new Float64Array(n).fill(Infinity);
  const Lo = new Float64Array(n).fill(-Infinity);
  const passes = closed ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = closed ? (i - 1 + n) % n : i - 1;
      if (fixed[i]) {
        U[i] = fixedH[i]!;
        Lo[i] = fixedH[i]!;
      } else if (prev >= 0) {
        U[i] = Math.min(U[i]!, U[prev]! + G);
        Lo[i] = Math.max(Lo[i]!, Lo[prev]! - G);
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      const next = closed ? (i + 1) % n : i + 1;
      if (!fixed[i] && next < n) {
        U[i] = Math.min(U[i]!, U[next]! + G);
        Lo[i] = Math.max(Lo[i]!, Lo[next]! - G);
      }
    }
  }
  let clamped = 0;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    if (Lo[i]! > U[i]! + 1e-9) {
      warn(`infeasible grade between fixed zones at s=${(i * ds).toFixed(0)}`);
      p[i] = (Lo[i]! + U[i]!) / 2;
      continue;
    }
    const v = Math.min(U[i]!, Math.max(Lo[i]!, p[i]!));
    if (Math.abs(v - p[i]!) > 0.01) clamped++;
    p[i] = v;
  }
  for (let pass = 0; pass < passes + 1; pass++) {
    for (let i = 1; i < (closed ? n + 1 : n); i++) {
      const k = i % n;
      const prev = (i - 1) % n;
      if (fixed[k]) continue;
      p[k] = Math.min(p[prev]! + G, Math.max(p[prev]! - G, p[k]!));
    }
    for (let i = (closed ? n : n - 1) - 1; i >= 0; i--) {
      const k = i % n;
      const next = (i + 1) % n;
      if (fixed[k] || (!closed && i + 1 >= n)) continue;
      p[k] = Math.min(p[next]! + G, Math.max(p[next]! - G, p[k]!));
    }
  }
  if (clamped > 0) warn(`${clamped} samples grade-clamped (keys steeper than ${(inp.grade * 100).toFixed(1)} %)`);
  const out = boxFilter(p, closed, half);
  // Exact flats (the filter leaves them level up to rounding).
  for (const f of inp.flats) {
    const i0 = Math.ceil(f.s0 / ds);
    const i1 = Math.floor(f.s1 / ds);
    for (let i = i0; i <= i1; i++) {
      let k = i;
      if (closed) k = ((i % n) + n) % n;
      else if (i < 0 || i >= n) continue;
      out[k] = f.h;
    }
  }
  return out;
}

/** Rally hop: added height at offset x (m) from the crest. Sag R 160, ramps ±8 %, crest R 45. */
export const HOP = { g: 0.08, sagR: 160, crestR: 45, ramp: 6 };
export function hopShape(x: number): number {
  const { g, sagR, crestR, ramp } = HOP;
  const a = g * sagR; // sag length
  const c = 2 * g * crestR; // crest length
  const halfLen = a + ramp + c / 2;
  const u = Math.abs(x);
  if (u >= halfLen) return 0;
  // integrate the grade from the far end (u = halfLen) inward
  const t = halfLen - u; // distance from the hop's foot
  // grade(t): 0→g over a (sag), g over ramp, g→0 over c/2 (crest half)
  if (t <= a) return (t * t) / (2 * sagR);
  const hA = (a * a) / (2 * sagR);
  if (t <= a + ramp) return hA + g * (t - a);
  const hB = hA + g * ramp;
  const q = t - a - ramp;
  return hB + g * q - (q * q) / (2 * crestR);
}
export const HOP_HALF = HOP.g * HOP.sagR + HOP.ramp + HOP.g * HOP.crestR;

/**
 * Solve road profiles in priority order (only roads passing `only`, skipping solved ones).
 * `baseAt(x, z)` is the terrain before roads (fallback height only). Fills h, flats, flags,
 * hopZones and the junction heights.
 */
export function solveRoadProfiles(roads: RoadBuild[], baseAt: (x: number, z: number) => number, only: (r: RoadBuild) => boolean = () => true): void {
  const order = [...roads].sort((a, b) => a.def.priority - b.def.priority || a.index - b.index);
  for (const r of order) {
    if (r.solved || !only(r)) continue;
    const def = r.def;
    const warn = (m: string) => r.warnings.push(m);
    const L = r.closed ? r.n * r.ds : (r.n - 1) * r.ds;
    const wrap = (s: number) => (r.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s)));
    // 1. Authored keys.
    const keys: { s: number; h: number }[] = [];
    if (def.keys === 'rim') {
      for (const [t, h] of RIM_KEYS) {
        const [x, z] = rimAt(t);
        keys.push({ s: projectOnRoad(r, x, z).s, h });
      }
    } else for (const k of def.keys) keys.push({ s: projectOnRoad(r, k.x, k.z).s, h: k.h });
    // 2. Level-zone extents (height from the keys unless fixed by an area or a major road).
    interface Zone {
      s0: number;
      s1: number;
      kind: FlatZone['kind'];
      fixed: number | null;
    }
    const zones: Zone[] = [];
    if (def.keys === 'rim') {
      for (const [t0, t1] of RIM_FLATS) {
        const a = projectOnRoad(r, ...rimAt(t0)).s;
        let b = projectOnRoad(r, ...rimAt(t1)).s;
        if (b < a) b += L;
        zones.push({ s0: a, s1: b, kind: 'flat', fixed: null });
      }
    }
    for (const f of def.flats ?? []) {
      const a = projectOnRoad(r, f.a[0], f.a[1]).s;
      const b = projectOnRoad(r, f.b[0], f.b[1]).s;
      zones.push({ s0: Math.min(a, b), s1: Math.max(a, b), kind: 'flat', fixed: null });
    }
    for (const pad of def.pads ?? []) {
      const c = projectOnRoad(r, pad.x, pad.z);
      const ic = Math.round(c.s / r.ds);
      let i0 = ic;
      let i1 = ic;
      const inside = (i: number) => Math.hypot(r.xs[i]! - pad.x, r.zs[i]! - pad.z) <= PAD_R;
      while (i0 > 0 && inside(i0 - 1)) i0--;
      while (i1 < r.n - 1 && inside(i1 + 1)) i1++;
      zones.push({ s0: i0 * r.ds, s1: i1 * r.ds, kind: 'pad', fixed: null });
      for (let i = i0; i <= i1; i++) r.flags[i]! |= ROAD_PAD;
    }
    for (const area of FLAT_AREAS) {
      let i = 0;
      while (i < r.n) {
        if (flatAreaDist(area, r.xs[i]!, r.zs[i]!) <= def.width / 2 + 1) {
          let j = i;
          while (j + 1 < r.n && flatAreaDist(area, r.xs[j + 1]!, r.zs[j + 1]!) <= def.width / 2 + 1) j++;
          zones.push({ s0: i * r.ds, s1: j * r.ds, kind: 'area', fixed: area.y });
          if (area.id === 'saddle') for (let k = i; k <= j; k++) r.flags[k]! |= ROAD_PAD;
          i = j + 1;
        } else i++;
      }
    }
    for (const j of r.junctions) {
      const hl = junctionHalfLengths(j, roads);
      const isMajor = j.major === r.index;
      const s = isMajor ? j.sMajor : j.sMinor;
      const half = isMajor ? hl.major : hl.minor;
      let fixed: number | null = null;
      if (!isMajor) {
        const major = roads[j.major]!;
        if (!major.solved) throw new Error(`junction order: ${major.def.id} not solved before ${def.id}`);
        fixed = atStation(major, major.h, j.sMajor);
        j.h = fixed;
      }
      let s0 = s - half;
      let s1 = s + half;
      if (!r.closed) {
        s0 = Math.max(0, s0);
        s1 = Math.min(L, s1);
      }
      zones.push({ s0, s1, kind: 'junction', fixed });
      const i0 = Math.round(s0 / r.ds);
      const i1 = Math.round(s1 / r.ds);
      for (let i = i0; i <= i1; i++) r.flags[r.closed ? ((i % r.n) + r.n) % r.n : Math.max(0, Math.min(r.n - 1, i))]! |= ROAD_JUNCTION;
    }
    // 3. Merge overlapping zones.
    zones.sort((a, b) => a.s0 - b.s0);
    const merged: Zone[] = [];
    for (const z of zones) {
      const last = merged[merged.length - 1];
      if (last && z.s0 <= last.s1 + 0.5) {
        if (last.fixed !== null && z.fixed !== null && Math.abs(last.fixed - z.fixed) > 0.02)
          warn(`conflicting level zones at s=${z.s0.toFixed(0)}: ${last.fixed.toFixed(2)} vs ${z.fixed.toFixed(2)}`);
        last.s1 = Math.max(last.s1, z.s1);
        if (last.fixed === null) last.fixed = z.fixed;
        if (z.kind === 'pad') last.kind = 'pad';
      } else merged.push({ ...z });
    }
    // 4. Effective station: keys are interpolated with the level zones squeezed out, so the climb is
    //    spread evenly over the sloping parts.
    // (each zone counts with the W/2 margins the solver keeps level around it)
    const pieces: [number, number][] = [];
    const wHalf = def.filterW / 2;
    const raw: [number, number][] = merged.map((z) => [z.s0 - wHalf, z.s1 + wHalf]);
    raw.sort((a, b) => a[0] - b[0]);
    const unioned: [number, number][] = [];
    for (const [a, b] of raw) {
      const last = unioned[unioned.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else unioned.push([a, b]);
    }
    for (const [a0, b0] of unioned) {
      const a = r.closed ? a0 : Math.max(0, a0);
      const b = r.closed ? b0 : Math.min(L, b0);
      if (!r.closed) pieces.push([a, b]);
      else if (a < 0) pieces.push([a + L, L], [0, b]);
      else if (b > L) pieces.push([a, L], [0, b - L]);
      else pieces.push([a, b]);
    }
    let flatTotal = 0;
    for (const [a, b] of pieces) flatTotal += b - a;
    const effL = Math.max(1, L - flatTotal);
    const sEff = (s: number): number => {
      const w = wrap(s);
      let cut = 0;
      for (const [a, b] of pieces) cut += Math.max(0, Math.min(w, b) - a);
      return w - cut;
    };
    const effKeys: { e: number; h: number }[] = keys.map((k) => ({ e: sEff(k.s), h: k.h }));
    for (const z of merged) if (z.fixed !== null) effKeys.push({ e: sEff(z.s0 + 0.01), h: z.fixed });
    effKeys.sort((a, b) => a.e - b.e);
    const effHeight = (e: number): number => {
      if (effKeys.length === 0) return NaN;
      let lo: { e: number; h: number } | undefined;
      let hi: { e: number; h: number } | undefined;
      for (const k of effKeys) {
        if (k.e <= e) lo = k;
        if (k.e >= e && !hi) hi = k;
      }
      if (r.closed) {
        lo ??= { e: effKeys[effKeys.length - 1]!.e - effL, h: effKeys[effKeys.length - 1]!.h };
        hi ??= { e: effKeys[0]!.e + effL, h: effKeys[0]!.h };
      } else {
        lo ??= hi;
        hi ??= lo;
      }
      return hi!.e === lo!.e ? lo!.h : lo!.h + ((hi!.h - lo!.h) * (e - lo!.e)) / (hi!.e - lo!.e);
    };
    // 5. Zone heights.
    const flats: FlatZone[] = merged.map((z) => {
      let h = z.fixed ?? effHeight(sEff(z.s0 + 0.01));
      if (!Number.isFinite(h)) h = baseAt(r.xs[0]!, r.zs[0]!);
      return { s0: z.s0, s1: z.s1, h, kind: z.kind };
    });
    for (const j of r.junctions) {
      if (j.major !== r.index) continue;
      const f = flats.find((z) => j.sMajor >= z.s0 - 1 && j.sMajor <= z.s1 + 1) ?? flats.find((z) => j.sMajor + L >= z.s0 - 1 && j.sMajor + L <= z.s1 + 1);
      j.h = f ? f.h : effHeight(sEff(j.sMajor));
    }
    r.flats = flats;
    // 6. Linear profile keys: zone ends + authored keys outside zones.
    const finalKeys: { s: number; h: number }[] = [];
    for (const f of flats) finalKeys.push({ s: f.s0, h: f.h }, { s: f.s1, h: f.h });
    for (const k of keys) if (!flats.some((f) => k.s > f.s0 - 0.01 && k.s < f.s1 + 0.01)) finalKeys.push(k);
    if (finalKeys.length === 0) finalKeys.push({ s: 0, h: baseAt(r.xs[0]!, r.zs[0]!) });
    r.h = solveProfile({ n: r.n, ds: r.ds, closed: r.closed, keys: finalKeys, flats, grade: def.gradeMax, filterW: def.filterW }, warn);
    // Hops.
    for (const [hx, hz] of def.hops ?? []) {
      const c = projectOnRoad(r, hx, hz).s;
      r.hopZones.push([c - HOP_HALF, c + HOP_HALF]);
      for (let i = 0; i < r.n; i++) {
        let d = i * r.ds - c;
        if (r.closed) {
          if (d > L / 2) d -= L;
          if (d < -L / 2) d += L;
        }
        if (Math.abs(d) < HOP_HALF) {
          r.h[i] = r.h[i]! + hopShape(d);
          r.flags[i]! |= ROAD_HOP;
        }
      }
    }
    r.solved = true;
  }
}
