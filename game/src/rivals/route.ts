/**
 * The race route the rivals drive and everyone is ranked on: a polyline x, y, z (y = driving-surface
 * height, or the flight arc over a gap) with cumulative station `cum`, and the station of every gate
 * (`gateS[0] = 0` at the spawn, then checkpoints 1…n−1, then the finish). Pure data, no three /
 * React / Rapier: node tests build routes from the plan generators directly.
 *
 * Builders: classicRoute (track/chaos plan), islandRoute (track/world WorldEvent) — see classicRoute.ts
 * and islandRoute.ts; `routeCache` in RivalsLayer keeps one per layout id.
 */
export interface RaceRoute {
  /** Layout id this route belongs to. */
  id: string;
  /** x, y, z per point. */
  points: Float32Array;
  /** Station (metres along the x/z polyline) per point; cum[0] = 0. */
  cum: Float32Array;
  lengthM: number;
  /** Station of gate k: 0 (spawn), checkpoints 1…n−1, the finish last. */
  gateS: number[];
  /** Tangent-based yaw per point (atan2(dx, dz), the game's yaw convention: 0 faces +Z). */
  yaw: Float32Array;
  /** 'classic' heights are baked into `points`; 'island' heights come from the terrain at runtime. */
  world: 'classic' | 'island';
  /** Per-point index ranges [start, end) flown over a gap (no deck below: pose follows the arc, no surface tilt). */
  flights: [number, number][];
}

export function cumulativeOf(points: ArrayLike<number>): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = points[i * 3]! - points[i * 3 - 3]!;
    const dz = points[i * 3 + 2]! - points[i * 3 - 1]!;
    out[i] = out[i - 1]! + Math.hypot(dx, dz);
  }
  return out;
}

export function yawsOf(points: ArrayLike<number>): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === n - 1 ? n - 1 : i + 1;
    const dx = points[b * 3]! - points[a * 3]!;
    const dz = points[b * 3 + 2]! - points[a * 3 + 2]!;
    out[i] = dx === 0 && dz === 0 ? (i > 0 ? out[i - 1]! : 0) : Math.atan2(dx, dz);
  }
  return out;
}

/** Index of the last point whose station ≤ s (binary search; 0 ≤ result ≤ n − 2). */
export function segmentAt(cum: Float32Array, s: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  if (hi < 0) return 0;
  if (s <= 0) return 0;
  if (s >= cum[hi + 1]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point (x, y, z) and yaw at station `s`, linearly interpolated; extrapolates along the end tangents. */
export function sampleRoute(route: RaceRoute, s: number, out: { x: number; y: number; z: number; yaw: number }): void {
  const { points, cum, yaw } = route;
  const n = cum.length;
  if (n === 0) {
    out.x = out.y = out.z = out.yaw = 0;
    return;
  }
  if (n === 1 || s <= 0) {
    const y0 = yaw[0]!;
    const back = s < 0 ? -s : 0;
    out.x = points[0]! - Math.sin(y0) * back;
    out.y = points[1]!;
    out.z = points[2]! - Math.cos(y0) * back;
    out.yaw = y0;
    return;
  }
  const i = segmentAt(cum, s);
  const s0 = cum[i]!;
  const s1 = cum[i + 1]!;
  const span = s1 - s0;
  const t = span > 1e-9 ? Math.min(Math.max((s - s0) / span, 0), s >= s1 ? 1e9 : 1) : 0;
  const a = i * 3;
  const b = a + 3;
  out.x = points[a]! + (points[b]! - points[a]!) * t;
  out.y = points[a + 1]! + (points[b + 1]! - points[a + 1]!) * (t > 1 ? 1 : t);
  out.z = points[a + 2]! + (points[b + 2]! - points[a + 2]!) * t;
  const ya = yaw[i]!;
  let d = yaw[i + 1]! - ya;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  out.yaw = ya + d * Math.min(t, 1);
}

/** Point index range to search for a car that has passed gate `lastGate` (one gate ahead, a margin behind). */
function gateWindow(route: RaceRoute, lastGate: number): [number, number] {
  const g = route.gateS;
  const k = Math.max(0, Math.min(lastGate, g.length - 1));
  const sFrom = Math.max(0, (g[k] ?? 0) - 60);
  const sTo = k + 1 < g.length ? g[k + 1]! + 60 : route.lengthM;
  return [segmentAt(route.cum, sFrom), Math.min(route.cum.length - 2, segmentAt(route.cum, sTo))];
}

/**
 * Station of the point of the route nearest (x, z), searched within the window of the gate the car
 * passed last (`lastGate`, 0 = none yet), clamped so progress between gates never exceeds the next gate.
 */
export function stationOnRoute(route: RaceRoute, x: number, z: number, lastGate: number): number {
  const { points, cum } = route;
  const n = cum.length;
  if (n < 2) return 0;
  const [i0, i1] = gateWindow(route, lastGate);
  let best = Infinity;
  let bestS = cum[i0]!;
  for (let i = i0; i <= i1; i++) {
    const ax = points[i * 3]!;
    const az = points[i * 3 + 2]!;
    const sx = points[i * 3 + 3]! - ax;
    const sz = points[i * 3 + 5]! - az;
    const l2 = sx * sx + sz * sz;
    let t = l2 > 1e-9 ? ((x - ax) * sx + (z - az) * sz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + sx * t - x;
    const dz = az + sz * t - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bestS = cum[i]! + (cum[i + 1]! - cum[i]!) * t;
    }
  }
  const g = route.gateS;
  const k = Math.max(0, Math.min(lastGate, g.length - 1));
  const lo = g[k] ?? 0;
  const hi = k + 1 < g.length ? g[k + 1]! : route.lengthM;
  return bestS < lo ? lo : bestS > hi ? hi : bestS;
}

/** Gate index a station has passed (0 = none beyond the spawn). */
export function gatePassedAt(route: RaceRoute, s: number): number {
  let k = 0;
  for (let i = 1; i < route.gateS.length; i++) if (s >= route.gateS[i]!) k = i;
  return k;
}

/**
 * A route for a layout without a plan (the hand-built test track): straight legs from the spawn
 * through the checkpoints to the finish, sampled every 2 m, heights from the gate positions.
 */
export function layoutRoute(layout: { id: string; spawn: { position: readonly number[] }; checkpoints: { position: readonly number[] }[]; finish: { position: readonly number[] } }): RaceRoute {
  const nodes: number[][] = [[...layout.spawn.position]];
  for (let k = 1; k < layout.checkpoints.length; k++) nodes.push([...layout.checkpoints[k]!.position]);
  nodes.push([...layout.finish.position]);
  const pts: number[] = [];
  const gateIndex: number[] = [0];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const len = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      pts.push(a[0]! + (b[0]! - a[0]!) * u, a[1]! + (b[1]! - a[1]!) * u, a[2]! + (b[2]! - a[2]!) * u);
    }
    gateIndex.push(pts.length / 3);
  }
  const last = nodes[nodes.length - 1]!;
  pts.push(last[0]!, last[1]!, last[2]!);
  const points = new Float32Array(pts);
  const cum = cumulativeOf(points);
  const gateS = gateIndex.map((i) => cum[Math.min(i, cum.length - 1)]!);
  return { id: layout.id, points, cum, lengthM: cum[cum.length - 1]!, gateS, yaw: yawsOf(points), world: 'classic', flights: [] };
}
