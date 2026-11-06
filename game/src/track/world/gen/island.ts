/**
 * Island shape and the natural (pre-road) terrain: trefoil coast with seeded noise and a land
 * guard, regional heights tied to the Rimway profile, The Crown, and the local landforms (Cobble
 * Hill, Lantern Point, buttes, Glassmere basin, the saddle shelf). Pure.
 */
import { mulberry32 } from '../../chaos/rng';
import { GradientNoise2D, periodicNoise1D, smax, smootherstep, smoothstep } from './noise';
import { flatDistFn, type RoadBuild } from './roads';
import {
  CITY_Y,
  COAST_NOISE,
  COBBLE_HILL,
  CROWN_REGION_R,
  DEG,
  FLAT_AREAS,
  GLASSMERE,
  LANTERN_POINT,
  PEAK,
  REGION_SECTORS,
  SADDLE,
  coastR,
  rimR,
  thetaOf,
} from './tessera';
import { REGION_IDS, type RegionId } from './types';

// Local aliases: hot loops must not go through module-namespace getters (tsx/CJS interop).
const _thetaOf = thetaOf;
const _rimR = rimR;
const _DEG = DEG;
const _SECTORS = REGION_SECTORS;
const _PEAK = PEAK;
const _SADDLE = SADDLE;
const _HILL = COBBLE_HILL;
const _LP = LANTERN_POINT;
const _LAKE = GLASSMERE;
const _GUARDS = FLAT_AREAS.filter((a) => a.guard > 0).map((a) => ({ guard: a.guard, dist: flatDistFn(a) }));
const _smoothstep = smoothstep;
const _smootherstep = smootherstep;
const _smax = smax;
const _CITY_Y = CITY_Y;

const TABLE_STEP = 0.25; // deg
const TABLE_N = Math.round(360 / TABLE_STEP);

export interface Butte {
  x: number;
  z: number;
  r: number;
  top: number;
}

export class Island {
  /** Rimway height by θ (TABLE_STEP deg). */
  readonly rimH = new Float64Array(TABLE_N);
  /** Shoreline radius by θ (noise + Rimway land guard). */
  readonly shoreR = new Float64Array(TABLE_N);
  readonly noise: GradientNoise2D;
  readonly buttes: Butte[];
  private readonly coastNoise: ((t: number) => number)[];

  readonly seed: number;

  constructor(seed: number, rim: RoadBuild) {
    this.seed = seed;
    const rng = mulberry32(seed ^ 0x51ed);
    this.coastNoise = [periodicNoise1D(rng, 22), periodicNoise1D(rng, 53)];
    this.noise = new GradientNoise2D(seed ^ 0x9e37);
    // Rimway height table: walk the samples (θ is monotone along the clover).
    const acc = new Float64Array(TABLE_N);
    const cnt = new Float64Array(TABLE_N);
    for (let i = 0; i < rim.n; i++) {
      const k = Math.floor(_thetaOf(rim.xs[i]!, rim.zs[i]!) / TABLE_STEP) % TABLE_N;
      acc[k] = acc[k]! + rim.h[i]!;
      cnt[k] = cnt[k]! + 1;
    }
    for (let k = 0; k < TABLE_N; k++) if (cnt[k]! > 0) this.rimH[k] = acc[k]! / cnt[k]!;
    // fill gaps by linear interpolation around the circle
    for (let k = 0; k < TABLE_N; k++) {
      if (cnt[k]! > 0) continue;
      let a = k;
      while (cnt[(a - 1 + TABLE_N) % TABLE_N]! === 0) a--;
      let b = k;
      while (cnt[(b + 1) % TABLE_N]! === 0) b++;
      const ia = (a - 1 + TABLE_N) % TABLE_N;
      const ib = (b + 1) % TABLE_N;
      const t = (k - (a - 1)) / (b + 1 - (a - 1));
      this.rimH[k] = this.rimH[ia]! + (this.rimH[ib]! - this.rimH[ia]!) * t;
    }
    for (let k = 0; k < TABLE_N; k++) {
      const tDeg = k * TABLE_STEP;
      const t = tDeg * _DEG;
      const natural = coastR(t) + COAST_NOISE[0] * this.coastNoise[0]!(t) + COAST_NOISE[1] * this.coastNoise[1]!(t);
      const H = this.rimH[k]!;
      // Land guard: the strip seaward of the Rimway must be wide enough for an eased ≤ 25° slope.
      const cliffs = tDeg >= 350 || tDeg <= 30; // Shell Cove chalk cliffs (masked)
      // The road's normal is slanted against the radius on the clover: 58 m along the normal
      // reaches 58·sec(α) m radially.
      const rr = rimR(t);
      const dr = 510 * Math.sin(3 * t);
      const guard = 58 * Math.sqrt(1 + (dr / rr) * (dr / rr)) + 6;
      // strip max slope ≈ 1.875 H / span (smootherstep) → span ≥ 4.7 H keeps it under 0.40;
      // inside the masked chalk cliffs the strip may be narrow (blended over 12° at the zone edges)
      const wide = Math.max(guard, 4.7 * H + 14);
      const d0 = Math.min(Math.abs(tDeg - 350), Math.abs(tDeg - 30), Math.abs(tDeg + 10), Math.abs(tDeg - 390));
      const inside = cliffs ? Math.min(1, d0 / 12) : 0;
      const margin = wide + (guard - wide) * inside;
      this.shoreR[k] = Math.max(natural, _rimR(t) + margin);
    }
    // Buttes (Cinnabar Reach), flat-topped, cliff-masked, placed clear of every road.
    this.buttes = [
      { x: 255, z: -505, r: 24, top: 58 },
      { x: 180, z: -370, r: 18, top: 52 },
      { x: 95, z: -455, r: 18, top: 55 },
      { x: 330, z: -470, r: 16, top: 50 },
    ];
  }

  rimHeightAt(tDeg: number): number {
    const f = tDeg / TABLE_STEP;
    const k = Math.floor(f);
    const t = f - k;
    const a = this.rimH[((k % TABLE_N) + TABLE_N) % TABLE_N]!;
    const b = this.rimH[(((k + 1) % TABLE_N) + TABLE_N) % TABLE_N]!;
    return a + (b - a) * t;
  }

  shoreAt(tDeg: number): number {
    const f = tDeg / TABLE_STEP;
    const k = Math.floor(f);
    const t = f - k;
    const a = this.shoreR[((k % TABLE_N) + TABLE_N) % TABLE_N]!;
    const b = this.shoreR[(((k + 1) % TABLE_N) + TABLE_N) % TABLE_N]!;
    return a + (b - a) * t;
  }

  /** Signed inland distance (m): > 0 land, < 0 sea; includes the coastal land guards. */
  landDist(x: number, z: number): number {
    const tDeg = _thetaOf(x, z);
    let d = this.shoreAt(tDeg) - Math.hypot(x, z);
    for (let k = 0; k < _GUARDS.length; k++) d = Math.max(d, _GUARDS[k]!.guard - _GUARDS[k]!.dist(x, z));
    d = Math.max(d, _LP.r - Math.hypot(x - _LP.x, z - _LP.z));
    // Volt Docks pier: land only 2 m beyond its 12 m deck (x = -600, z 345..470).
    const pz = Math.max(345, Math.min(470, z));
    d = Math.max(d, 8 - Math.hypot(x + 600, z - pz));
    return d;
  }

  /** Inland height for a sector at (x, z), before The Crown and landforms. */
  private sectorHeight(sector: string, x: number, z: number, inward: number, H: number): number {
    switch (sector) {
      case 'prism-city':
        return _CITY_Y;
      case 'kite-bay':
        return H + 6 * _smoothstep(0, 260, inward);
      case 'cinnabar-reach': {
        // Red plateau 28 m near the coast rising to 40 m inland, reached from the Rimway over a
        // distance proportional to the height difference (≤ ~0.35 slope).
        const T = 28 + 12 * _smoothstep(60, 260, inward) + 2.5 * this.noise.fbm(x, z, 260, 2) * _smoothstep(40, 120, inward);
        const span = Math.max(30, 4 * Math.abs(T - H));
        return H + (T - H) * _smoothstep(9, 9 + span, inward);
      }
      case 'shell-cove':
        return H + 4 * _smoothstep(0, 200, inward);
      case 'patchwork-downs':
        return H + 6 * _smoothstep(0, 220, inward) + 5 * this.noise.fbm(x + 500, z, 210, 2) * _smoothstep(9, 70, inward);
      case 'lantern-bay':
        return H + 4 * _smoothstep(0, 220, inward);
      default:
        return H;
    }
  }

  /** Natural terrain height before roads (no gulch carve; that follows the loop road later). */
  baseAt(x: number, z: number): number {
    const r = Math.sqrt(x * x + z * z);
    const tDeg = _thetaOf(x, z);
    // Deep sea (well past the shore and every coastal guard feature).
    if (r > this.shoreAt(tDeg) + 260) return -26;
    const rr = _rimR(tDeg * _DEG);
    const H = this.rimHeightAt(tDeg);
    let h: number;
    if (r <= rr + 9) {
      // Inland: blend neighbouring sectors over ±8°.
      const inward = Math.max(0, rr - r);
      let sum = 0;
      let wsum = 0;
      for (let k = 0; k < _SECTORS.length; k++) {
        const sec = _SECTORS[k]!;
        const a0 = sec[0];
        const a1 = sec[1];
        let t = tDeg;
        if (a0 < 0 && t > 180) t -= 360;
        if (t < a0 - 8 || t > a1 + 8) continue;
        const w = _smoothstep(a0 - 8, a0 + 8, t) * (1 - _smoothstep(a1 - 8, a1 + 8, t));
        if (w <= 0) continue;
        sum += w * this.sectorHeight(sec[2], x, z, inward, H);
        wsum += w;
      }
      h = wsum > 0 ? sum / wsum : H;
    } else {
      // Seaward strip: eased fall from the Rimway height to the shoreline.
      const shore = this.shoreAt(tDeg);
      const span = Math.max(8, shore - (rr + 9));
      const t = (r - rr - 9) / span;
      h = t > 1 ? 0 : H * (1 - _smootherstep(0, 1, t));
    }
    // Sea floor below the shoreline (guard-aware land distance; far inland it is always land).
    if (r > rr - 40) {
      const land = this.landDist(x, z);
      if (land < 0) {
        const d = -land;
        const sea = -1.5 * _smoothstep(0, 25, d) - 24.5 * _smoothstep(25, 150, d);
        h = Math.min(h, sea);
      } else if (land < 25) h = Math.max(h, 0.4 * _smoothstep(0, 25, land));
    }
    // The Crown.
    const px = x - _PEAK.x;
    const pz = z - _PEAK.z;
    const rho2 = px * px + pz * pz;
    if (rho2 < 560 * 560) {
      // the western foothills taper faster toward Prism City
      const cw = Math.cos(Math.atan2(pz, px) - Math.PI);
      const k = 1 + 0.09 * (cw > 0 ? cw * cw : 0);
      h = _smax(h, crownHeight(Math.sqrt(rho2) * k), 12);
    }
    // Prism City pad: level ground for 20 m beyond Avenue 380, then the foothills.
    if (x < -312 && z > -400 && z < 400 && r < rr) h = _CITY_Y + (h - _CITY_Y) * _smoothstep(-360, -312, x);
    // Saddle shelf: a gentle bench around Crown Saddle.
    const sx = x - _SADDLE.x;
    const sz = z - _SADDLE.z;
    const ds2 = sx * sx + sz * sz;
    if (ds2 < 310 * 310) h = _smax(h, _SADDLE.y + 2 - 0.22 * Math.max(0, Math.sqrt(ds2) - 50), 8);
    // Cobble Hill.
    const cx = x - _HILL.x;
    const cz = z - _HILL.z;
    const dc2 = cx * cx + cz * cz;
    if (dc2 < _HILL.foot * _HILL.foot) h = _smax(h, _HILL.top - 32 * easedRamp((Math.sqrt(dc2) - _HILL.courtyard) / (_HILL.foot - _HILL.courtyard), 0.15), 6);
    // Lantern Point headland.
    const lx = x - _LP.x;
    const lz = z - _LP.z;
    const dl2 = lx * lx + lz * lz;
    if (dl2 < 90 * 90) h = _smax(h, _LP.y * (1 - _smootherstep(10, 85, Math.sqrt(dl2))), 3);
    // Buttes: flat tops with steep (masked) sides.
    for (let k = 0; k < this.buttes.length; k++) {
      const b = this.buttes[k]!;
      const bx = x - b.x;
      const bz = z - b.z;
      const R = b.r + 14;
      const d2 = bx * bx + bz * bz;
      if (d2 < R * R) h = Math.max(h, b.top - (b.top - h) * _smoothstep(b.r - 2, b.r + 12, Math.sqrt(d2)));
    }
    // Glassmere basin: bed 17.4 m, shelving to a rim ≥ 19.4 m around the ellipse.
    const ex = (x - _LAKE.x) / _LAKE.a;
    const ez = (z - _LAKE.z) / _LAKE.b;
    const e2 = ex * ex + ez * ez;
    if (e2 < 3.24) {
      const e = Math.sqrt(e2);
      const rim = _LAKE.rim + 0.6;
      if (e <= 1) h = _LAKE.bed + (rim - _LAKE.bed) * _smoothstep(0.84, 1, e);
      else h = rim + (h - rim) * _smoothstep(1, 1.8, e);
    }
    return h;
  }

  regionAt(x: number, z: number): RegionId {
    if (this.landDist(x, z) < -30) return 'sea';
    if (Math.hypot(x - _PEAK.x, z - _PEAK.z) < CROWN_REGION_R) return 'the-crown';
    let t = _thetaOf(x, z);
    for (const [a0, a1, id] of _SECTORS) {
      let tt = t;
      if (a0 < 0 && tt > 180) tt -= 360;
      if (tt >= a0 && tt < a1) return id as RegionId;
    }
    t = 0;
    return 'shell-cove';
  }
}

/**
 * The Crown's radial profile (monotone cubic Hermite through knots): a gentle dome around the
 * plaza (181 m, ρ ≤ 20), a steep strata mid-face (cliff-masked above 60 m, where the summit road
 * climbs on benches) and concave foothills that stay under 25°.
 */
const CROWN_KNOTS: readonly [number, number, number][] = [
  [20, 181, 0],
  [40, 180, -0.1],
  [85, 168, -0.38],
  [133, 142, -0.68],
  [180, 104, -0.8],
  [230, 66, -0.5],
  [258, 55, -0.2],
  [300, 47, -0.21],
  [360, 27, -0.26],
  [420, 10, -0.18],
  [480, 0, 0],
];
export function crownHeight(rho: number): number {
  const K = CROWN_KNOTS;
  if (rho <= K[0]![0]) return K[0]![1];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i]!;
    const b = K[i + 1]!;
    if (rho <= b[0]) {
      const L = b[0] - a[0];
      const t = (rho - a[0]) / L;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * L * a[2] + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * L * b[2];
    }
  }
  return 0;
}

/** 0→1 ramp with quadratic easing over the first and last `e` of its length (max slope 1/(1-e)). */
export function easedRamp(t: number, e: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const k = 1 / (1 - e);
  if (t < e) return (k * t * t) / (2 * e);
  if (t > 1 - e) return 1 - (k * (1 - t) * (1 - t)) / (2 * e);
  return k * (t - e / 2);
}

export function regionIndex(id: RegionId): number {
  return REGION_IDS.indexOf(id);
}
