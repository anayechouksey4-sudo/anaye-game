/**
 * Plan-view geometry: Catmull-Rom and fillet (straight + circular arc) paths, uniform resampling,
 * plan radius and a segment spatial index. Pure.
 */

export type P2 = [number, number];
/**
 * Fillet path vertex: [x, z, corner radius]. Radius is ignored at the ends of an open path.
 * With a 4th element ±1 the vertex is a hairpin: the path wraps around the circle (x, z, radius)
 * with tangent legs, turning counter-clockwise (+1, angle from +X toward +Z) or clockwise (-1).
 */
export type FilletPt = [number, number, number?, number?];

/** Tangent point on circle (cx, cz, r) for travel from (px, pz) wrapping with sign `sign`; `outgoing` = leaving toward (px, pz). */
function tangentPoint(cx: number, cz: number, r: number, px: number, pz: number, sign: number, outgoing: boolean): [number, number, number] {
  const D = Math.hypot(px - cx, pz - cz);
  if (D <= r + 1e-6) throw new Error('hairpin neighbour inside its circle');
  const beta = Math.atan2(pz - cz, px - cx);
  const alpha = Math.acos(r / D);
  for (const phi of [beta + alpha, beta - alpha]) {
    const tx = cx + Math.cos(phi) * r;
    const tz = cz + Math.sin(phi) * r;
    // circle tangent direction for the wrap sense
    const dx = -Math.sin(phi) * sign;
    const dz = Math.cos(phi) * sign;
    // travel direction along the leg at the tangent point
    const lx = outgoing ? px - tx : tx - px;
    const lz = outgoing ? pz - tz : tz - pz;
    if (lx * dx + lz * dz > 0) return [tx, tz, phi];
  }
  throw new Error('no tangent');
}

const TAU = Math.PI * 2;

/** Dense Catmull-Rom polyline through `ctrl` (uniform parameter), about `step` m between points. */
export function catmullRom(ctrl: readonly P2[], closed: boolean, step = 0.5): P2[] {
  const n = ctrl.length;
  const out: P2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = ctrl[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[(i + 1) % n]!;
    const p3 = ctrl[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]!;
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push([ctrl[n - 1]![0], ctrl[n - 1]![1]]);
  return out;
}

/**
 * Dense polyline of straight legs joined by circular arcs of the given corner radii (tangent
 * continuous). Throws if two fillets overlap on one leg (an authoring error).
 */
export function filletPath(input: readonly FilletPt[], closed: boolean, step = 0.5, label = 'path'): P2[] {
  // Expand hairpins into two plain vertices joined by a wrap arc.
  const pts: FilletPt[] = [];
  const wraps = new Map<number, { cx: number; cz: number; r: number; a0: number; sweep: number }>();
  for (let i = 0; i < input.length; i++) {
    const v = input[i]!;
    const sign = v[3];
    if (!sign) {
      pts.push(v);
      continue;
    }
    const prev = input[(i - 1 + input.length) % input.length]!;
    const next = input[(i + 1) % input.length]!;
    const r = v[2] ?? 19;
    const [t1x, t1z, p1] = tangentPoint(v[0], v[1], r, prev[0], prev[1], sign, false);
    const [t2x, t2z, p2] = tangentPoint(v[0], v[1], r, next[0], next[1], sign, true);
    let sweep = p2 - p1;
    if (sign > 0) while (sweep <= 0) sweep += TAU;
    else while (sweep >= 0) sweep -= TAU;
    wraps.set(pts.length, { cx: v[0], cz: v[1], r, a0: p1, sweep });
    pts.push([t1x, t1z, 0], [t2x, t2z, 0]);
  }
  const n = pts.length;
  interface Corner {
    a: P2;
    b: P2;
    c: P2;
    r: number;
    a0: number;
    sweep: number;
    t: number;
  }
  // First pass: deflection and requested tangent length per corner.
  const want: { delta: number; sign: number; d1: P2; d2: P2; r: number; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const isEnd = !closed && (i === 0 || i === n - 1);
    const r = pts[i]![2] ?? 0;
    const p = pts[i]!;
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;
    let d1x = p[0] - prev[0];
    let d1z = p[1] - prev[1];
    let d2x = next[0] - p[0];
    let d2z = next[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1;
    d1z /= l1;
    d2x /= l2;
    d2z /= l2;
    const dot = Math.max(-1, Math.min(1, d1x * d2x + d1z * d2z));
    const delta = isEnd || r <= 0 ? 0 : Math.acos(dot);
    const sign = d1x * d2z - d1z * d2x > 0 ? 1 : -1;
    want.push({ delta, sign, d1: [d1x, d1z], d2: [d2x, d2z], r, t: delta < 1e-6 ? 0 : r * Math.tan(delta / 2) });
  }
  // Fillets that would overlap on a leg shrink in proportion (the validator checks the radii).
  const legs = closed ? n : n - 1;
  const scale = new Float64Array(n).fill(1);
  for (let i = 0; i < legs; i++) {
    const j = (i + 1) % n;
    const p = pts[i]!;
    const q = pts[j]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const used = want[i]!.t + want[j]!.t;
    if (used > L) {
      const f = (L * 0.999) / used;
      scale[i] = Math.min(scale[i]!, f);
      scale[j] = Math.min(scale[j]!, f);
    }
  }
  void label;
  const corners: (Corner | null)[] = [];
  for (let i = 0; i < n; i++) {
    const w = want[i]!;
    if (w.delta < 1e-6) {
      corners.push(null);
      continue;
    }
    const p = pts[i]!;
    const t = w.t * scale[i]!;
    const r = t / Math.tan(w.delta / 2);
    const [d1x, d1z] = w.d1;
    const [d2x, d2z] = w.d2;
    const a: P2 = [p[0] - d1x * t, p[1] - d1z * t];
    const b: P2 = [p[0] + d2x * t, p[1] + d2z * t];
    const c: P2 = [a[0] - w.sign * d1z * r, a[1] + w.sign * d1x * r];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    corners.push({ a, b, c, r, a0, sweep: w.sign * w.delta, t });
  }
  const out: P2[] = [];
  const pushLine = (from: P2, to: P2) => {
    const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const m = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < m; k++) out.push([from[0] + ((to[0] - from[0]) * k) / m, from[1] + ((to[1] - from[1]) * k) / m]);
  };
  const pushArc = (c: Corner) => {
    const L = Math.abs(c.sweep) * c.r;
    const m = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < m; k++) {
      const ang = c.a0 + (c.sweep * k) / m;
      out.push([c.c[0] + Math.cos(ang) * c.r, c.c[1] + Math.sin(ang) * c.r]);
    }
  };
  const startOf = (i: number): P2 => corners[i]?.b ?? [pts[i]![0], pts[i]![1]];
  const endOf = (i: number): P2 => corners[i]?.a ?? [pts[i]![0], pts[i]![1]];
  const pushWrap = (w: { cx: number; cz: number; r: number; a0: number; sweep: number }) => {
    const L = Math.abs(w.sweep) * w.r;
    const m = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < m; k++) {
      const ang = w.a0 + (w.sweep * k) / m;
      out.push([w.cx + Math.cos(ang) * w.r, w.cz + Math.sin(ang) * w.r]);
    }
  };
  const legs2 = closed ? n : n - 1;
  for (let i = 0; i < legs2; i++) {
    const c = corners[i];
    if (c) pushArc(c);
    const w = wraps.get(i);
    if (w) pushWrap(w);
    else pushLine(startOf(i), endOf((i + 1) % n));
  }
  if (!closed) out.push([pts[n - 1]![0], pts[n - 1]![1]]);
  return out;
}

/** Points every `ds` m-ish of arc length (exactly uniform: closed paths get n points, open n + 1). */
export interface Resampled {
  xs: Float64Array;
  zs: Float64Array;
  count: number;
  ds: number;
  length: number;
}

export function resample(dense: readonly P2[], closed: boolean, targetDs: number): Resampled {
  const m = dense.length;
  const cum = new Float64Array(m + 1);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1]! + Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]);
  let length = cum[m - 1]!;
  if (closed) {
    length += Math.hypot(dense[0]![0] - dense[m - 1]![0], dense[0]![1] - dense[m - 1]![1]);
    cum[m] = length;
  }
  const segs = Math.max(1, Math.round(length / targetDs));
  const ds = length / segs;
  const count = closed ? segs : segs + 1;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = Math.min(i * ds, length);
    const last = closed ? m : m - 1;
    while (j < last - 1 && cum[j + 1]! < s) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % m]!;
    const span = cum[j + 1]! - cum[j]!;
    const t = span > 0 ? (s - cum[j]!) / span : 0;
    xs[i] = a[0] + (b[0] - a[0]) * t;
    zs[i] = a[1] + (b[1] - a[1]) * t;
  }
  if (!closed) {
    xs[count - 1] = dense[m - 1]![0];
    zs[count - 1] = dense[m - 1]![1];
  }
  return { xs, zs, count, ds, length };
}

/** Plan radius at each sample from the circle through samples i-k, i, i+k (Infinity on straights). */
export function planRadii(xs: Float64Array, zs: Float64Array, closed: boolean, k = 5): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    let ia = i - k;
    let ic = i + k;
    if (closed) {
      ia = (ia + n) % n;
      ic %= n;
    } else {
      if (ia < 0 || ic >= n) continue;
    }
    const ax = xs[ia]!;
    const az = zs[ia]!;
    const bx = xs[i]!;
    const bz = zs[i]!;
    const cx = xs[ic]!;
    const cz = zs[ic]!;
    const ab = Math.hypot(bx - ax, bz - az);
    const bc = Math.hypot(cx - bx, cz - bz);
    const ca = Math.hypot(ax - cx, az - cz);
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    out[i] = Math.abs(cross) < 1e-9 ? Infinity : (ab * bc * ca) / (2 * Math.abs(cross));
  }
  return out;
}

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** Spatial hash over polyline segments (road centrelines) for nearest-point queries. */
export interface IndexedLine {
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
  closed: boolean;
}

export interface NearestHit {
  line: number;
  /** Segment start index (the point lies between seg and seg + 1). */
  seg: number;
  t: number;
  dist: number;
  x: number;
  z: number;
}

export class SegmentIndex {
  readonly lines: readonly IndexedLine[];
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  constructor(lines: readonly IndexedLine[], cell = 16) {
    this.lines = lines;
    this.cell = cell;
    lines.forEach((line, li) => {
      const n = line.xs.length;
      const segs = line.closed ? n : n - 1;
      for (let s = 0; s < segs; s++) {
        const ax = line.xs[s]!;
        const az = line.zs[s]!;
        const bx = line.xs[(s + 1) % n]!;
        const bz = line.zs[(s + 1) % n]!;
        const x0 = Math.floor(Math.min(ax, bx) / cell);
        const x1 = Math.floor(Math.max(ax, bx) / cell);
        const z0 = Math.floor(Math.min(az, bz) / cell);
        const z1 = Math.floor(Math.max(az, bz) / cell);
        for (let cz = z0; cz <= z1; cz++)
          for (let cx = x0; cx <= x1; cx++) {
            const key = (cz + 4096) * 8192 + (cx + 4096);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(li, s);
          }
      }
    });
  }

  /** Visit every segment whose cell is within `radius` of (x, z) (may repeat segments). */
  forEachNear(x: number, z: number, radius: number, fn: (line: number, seg: number) => void): void {
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c);
    const x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c);
    const z1 = Math.floor((z + radius) / c);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.cells.get((cz + 4096) * 8192 + (cx + 4096));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) fn(list[i]!, list[i + 1]!);
      }
  }

  /** Nearest point on any line (optionally restricted to a filter) within `radius`; null if none. */
  nearest(x: number, z: number, radius: number, filter?: (line: number) => boolean): NearestHit | null {
    let best: NearestHit | null = null;
    this.forEachNear(x, z, radius, (li, s) => {
      if (filter && !filter(li)) return;
      const line = this.lines[li]!;
      const n = line.xs.length;
      const ax = line.xs[s]!;
      const az = line.zs[s]!;
      const bx = line.xs[(s + 1) % n]!;
      const bz = line.zs[(s + 1) % n]!;
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d <= radius && (!best || d < best.dist)) best = { line: li, seg: s, t, dist: d, x: px, z: pz };
    });
    return best;
  }
}
