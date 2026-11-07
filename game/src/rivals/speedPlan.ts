/**
 * Kinematic speed plan for a rival: v(s) along a route from curvature (v = √(aLat · R)), capped by
 * the class's top speed, with acceleration ≤ A_ACC and braking ≤ A_BRAKE, then scaled by ONE factor
 * (on the capped profile min(v_curv, vTop), never above vTop, re-running the accel / brake passes)
 * so the driving time equals the target to within 0.1 %. Pure: node-tested in game/test/rivals.test.ts.
 */
import type { RaceRoute } from './route';

export const A_LAT = 10; // m/s² lateral (the plan says 9–12)
export const A_ACC = 6; // m/s²
export const A_BRAKE = 10; // m/s²
/** Time tolerance the solver stops at (the plan asks for 0.5 %). */
export const TIME_TOLERANCE = 0.001;

export interface SpeedPlan {
  /** Station per point (= route.cum). */
  s: Float32Array;
  /** Speed per point, m/s. */
  v: Float32Array;
  /** Driving time at each point from the start of motion, s (t[0] = 0). */
  t: Float64Array;
  /** Total driving time, s (= t at the finish station). */
  totalS: number;
  /** The one scale factor applied to the curvature / top-speed limit. */
  scale: number;
  /** Top speed used as the hard cap, m/s. */
  vTop: number;
  /** The target was met within TIME_TOLERANCE. */
  feasible: boolean;
}

/** Circumscribed-circle curvature (1/R) at point i from its neighbours ±m. */
function curvatureAt(pts: Float32Array, i: number, m: number, n: number): number {
  const a = Math.max(0, i - m);
  const c = Math.min(n - 1, i + m);
  if (c - a < 2) return 0;
  const ax = pts[a * 3]!;
  const az = pts[a * 3 + 2]!;
  const bx = pts[i * 3]!;
  const bz = pts[i * 3 + 2]!;
  const cx = pts[c * 3]!;
  const cz = pts[c * 3 + 2]!;
  const ab = Math.hypot(bx - ax, bz - az);
  const bc = Math.hypot(cx - bx, cz - bz);
  const ca = Math.hypot(ax - cx, az - cz);
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  if (ab * bc * ca < 1e-9) return 0;
  return (2 * area2) / (ab * bc * ca);
}

/** Curvature-limited speed per point (before the cap), smoothed with a 3-point max of curvature. */
export function curvatureLimits(route: RaceRoute, aLat = A_LAT): Float32Array {
  const n = route.cum.length;
  const kappa = new Float32Array(n);
  // Neighbour spacing ≈ 6 m so a 2 m-sampled route does not see noise as corners.
  for (let i = 0; i < n; i++) {
    const ds = i + 1 < n ? route.cum[i + 1]! - route.cum[i]! : route.cum[i]! - route.cum[i - 1]!;
    const m = Math.max(1, Math.round(6 / Math.max(ds, 0.5)));
    kappa[i] = curvatureAt(route.points, i, m, n);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(kappa[i]!, kappa[Math.max(0, i - 1)]!, kappa[Math.min(n - 1, i + 1)]!);
    out[i] = k > 1e-6 ? Math.sqrt(aLat / k) : Infinity;
  }
  return out;
}

function passes(route: RaceRoute, limits: Float32Array, scale: number, vTop: number, out: Float32Array, finishIndex: number): number {
  const n = route.cum.length;
  const cum = route.cum;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    // ONE factor on the capped profile min(v_curv, vTop); the class top speed is never exceeded.
    const lim = Math.min(Math.min(limits[i]!, vTop) * scale, vTop);
    const ds = cum[i]! - cum[i - 1]!;
    const reach = Math.sqrt(out[i - 1]! * out[i - 1]! + 2 * A_ACC * ds);
    out[i] = Math.min(lim, reach);
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = cum[i + 1]! - cum[i]!;
    const reach = Math.sqrt(out[i + 1]! * out[i + 1]! + 2 * A_BRAKE * ds);
    if (out[i]! > reach) out[i] = reach;
  }
  let t = 0;
  for (let i = 1; i <= finishIndex; i++) {
    const ds = cum[i]! - cum[i - 1]!;
    const vm = out[i - 1]! + out[i]!;
    t += vm > 1e-6 ? (2 * ds) / vm : 0;
  }
  return t;
}

/**
 * Plan the route at `vTop` (m/s) so the finish (station `route.lengthM`) is reached after `targetS`
 * seconds of driving. Returns the plan whether or not the target was reachable (`feasible`).
 */
export function planSpeeds(route: RaceRoute, vTop: number, targetS: number): SpeedPlan {
  const n = route.cum.length;
  const limits = curvatureLimits(route);
  const v = new Float32Array(n);
  // The finish line is a route point (classicRoute / islandRoute guarantee it): the nearest one.
  let finishIndex = n - 1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(route.cum[i]! - route.lengthM);
    if (d < best) {
      best = d;
      finishIndex = i;
    }
  }
  // Time is monotonic decreasing in the scale; bisect on log(scale).
  let lo = Math.log(0.05);
  let hi = Math.log(20);
  let scale = 1;
  let total = passes(route, limits, scale, vTop, v, finishIndex);
  const fastest = passes(route, limits, Math.exp(hi), vTop, v, finishIndex);
  const slowest = passes(route, limits, Math.exp(lo), vTop, v, finishIndex);
  let feasible = targetS >= fastest * (1 - TIME_TOLERANCE) && targetS <= slowest * (1 + TIME_TOLERANCE);
  if (feasible) {
    for (let iter = 0; iter < 60; iter++) {
      const mid = (lo + hi) / 2;
      total = passes(route, limits, Math.exp(mid), vTop, v, finishIndex);
      if (Math.abs(total - targetS) <= targetS * TIME_TOLERANCE * 0.5) {
        scale = Math.exp(mid);
        break;
      }
      if (total > targetS) lo = mid;
      else hi = mid;
      scale = Math.exp(mid);
    }
    total = passes(route, limits, scale, vTop, v, finishIndex);
    feasible = Math.abs(total - targetS) <= targetS * TIME_TOLERANCE;
  } else {
    scale = targetS < fastest ? Math.exp(hi) : Math.exp(lo);
    total = passes(route, limits, scale, vTop, v, finishIndex);
  }
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const ds = route.cum[i]! - route.cum[i - 1]!;
    const vm = v[i - 1]! + v[i]!;
    t[i] = t[i - 1]! + (vm > 1e-6 ? (2 * ds) / vm : 0);
  }
  return { s: route.cum, v, t, totalS: total, scale, vTop, feasible };
}

/** Station reached after `tSec` of driving (clamped to the plan's end). */
export function stationAtTime(plan: SpeedPlan, tSec: number): number {
  const t = plan.t;
  const n = t.length;
  if (n === 0) return 0;
  if (tSec <= 0) return 0;
  if (tSec >= t[n - 1]!) return plan.s[n - 1]!;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid]! <= tSec) lo = mid;
    else hi = mid - 1;
  }
  const t0 = t[lo]!;
  const t1 = t[lo + 1]!;
  const u = t1 > t0 ? (tSec - t0) / (t1 - t0) : 0;
  // Constant acceleration inside the segment: s = s0 + v0·τ + ½·a·τ².
  const v0 = plan.v[lo]!;
  const v1 = plan.v[lo + 1]!;
  const dt = t1 - t0;
  const tau = u * dt;
  const a = dt > 0 ? (v1 - v0) / dt : 0;
  return plan.s[lo]! + v0 * tau + 0.5 * a * tau * tau;
}

/** Speed after `tSec` of driving, m/s. */
export function speedAtTime(plan: SpeedPlan, tSec: number): number {
  const t = plan.t;
  const n = t.length;
  if (n === 0 || tSec <= 0) return 0;
  if (tSec >= t[n - 1]!) return plan.v[n - 1]!;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid]! <= tSec) lo = mid;
    else hi = mid - 1;
  }
  const t0 = t[lo]!;
  const t1 = t[lo + 1]!;
  const u = t1 > t0 ? (tSec - t0) / (t1 - t0) : 0;
  return plan.v[lo]! + (plan.v[lo + 1]! - plan.v[lo]!) * u;
}

/** Discrete check of the limits (tests): max positive / negative acceleration between points and the top speed. */
export function planLimits(plan: SpeedPlan): { maxAcc: number; maxBrake: number; maxV: number } {
  let maxAcc = 0;
  let maxBrake = 0;
  let maxV = 0;
  for (let i = 1; i < plan.v.length; i++) {
    const ds = plan.s[i]! - plan.s[i - 1]!;
    if (ds <= 1e-9) continue;
    const a = (plan.v[i]! * plan.v[i]! - plan.v[i - 1]! * plan.v[i - 1]!) / (2 * ds);
    if (a > maxAcc) maxAcc = a;
    if (-a > maxBrake) maxBrake = -a;
    if (plan.v[i]! > maxV) maxV = plan.v[i]!;
  }
  return { maxAcc, maxBrake, maxV };
}
