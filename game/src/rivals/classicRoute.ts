/**
 * RaceRoute of a generated classic map (track/chaos plan): the plan's 2D ideal line (`centerline`
 * [z, x], `centerXAt`) sampled every 2 m from the spawn to the finish gate (plus a short run-out),
 * with the driving-surface height from the plan's deck boxes (flat decks and pitched ramp plates,
 * the same boxes StaticTrack turns into colliders) and the collapsible tiles' tops. Where no surface
 * lies under the line (the hops and the big jump) the height follows a ballistic arc from the lip to
 * the landing. Rivals ignore the hazards themselves (they are ghosts): they drive over the tile field
 * as if it held, through pendulums and shutters. Pure data.
 */
import { centerXAt, type ChaosTrackPlan, type DeckBox } from '../track/chaos/plan';

/** A driving surface box: the plan's decks plus the collapsible tiles (their tops are the road over a tile field). */
type SurfaceBox = Pick<DeckBox, 'center' | 'size' | 'pitch'>;

/** Decks and tiles of a plan (the tiles field has no deck under it; its tiles are the surface). */
export function drivingSurfaces(plan: ChaosTrackPlan): SurfaceBox[] {
  const out: SurfaceBox[] = [...plan.decks];
  for (const seg of plan.segments) {
    if (seg.kind !== 'tiles') continue;
    for (const t of seg.tiles) out.push({ center: t.center, size: [seg.size, seg.thickness, seg.size], pitch: 0 });
  }
  return out;
}
import { cumulativeOf, yawsOf, type RaceRoute } from './route';

export const ROUTE_STEP_M = 2;
/** Metres of road kept after the finish line so a finished rival rolls on instead of stopping dead. */
export const RUN_OUT_M = 60;
const G = 9.81;

/** Height of the top surface of the highest deck under (x, z), or null when nothing lies there. */
export function deckTopAt(decks: readonly SurfaceBox[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const d of decks) {
    const [cx, cy, cz] = d.center;
    const [w, t, l] = d.size;
    if (Math.abs(x - cx) > w / 2 + 1e-6) continue;
    let top: number;
    if (d.pitch === 0) {
      if (Math.abs(z - cz) > l / 2 + 1e-6) continue;
      top = cy + t / 2;
    } else {
      const c = Math.cos(d.pitch);
      const s = Math.sin(d.pitch);
      // Local z along the plate (see plan.ts DeckBox: rotation about +X, negative climbs toward +Z).
      const zl = (z - cz - (t / 2) * s) / c;
      if (Math.abs(zl) > l / 2 + 1e-6) continue;
      top = cy + (t / 2) * c - zl * s;
    }
    if (best === null || top > best) best = top;
  }
  return best;
}

/** Take-off angle (rad, positive = nose up) of the plan segment that starts the flight at z, else 0. */
function takeoffAngleAt(plan: ChaosTrackPlan, z: number): number {
  for (const seg of plan.segments) {
    if (z < seg.startZ - 1 || z > seg.endZ + 1) continue;
    if (seg.kind === 'gap') return (seg.lipAngleDeg * Math.PI) / 180;
    if (seg.kind === 'bigJump') return (seg.takeoffDeg * Math.PI) / 180;
  }
  return 0;
}

/**
 * Fill y over [a, b] (exclusive of both ends, which are grounded) with a ballistic arc from point a
 * to point b at the lip's take-off angle; falls back to a gentle hump when the angle cannot reach.
 */
function fillFlight(points: Float32Array, cum: Float32Array, a: number, b: number, theta: number): void {
  const ya = points[a * 3 + 1]!;
  const yb = points[b * 3 + 1]!;
  const L = cum[b]! - cum[a]!;
  const tan = Math.tan(theta);
  const cos2 = Math.cos(theta) ** 2;
  const denom = 2 * cos2 * (L * tan - (yb - ya));
  const v2 = denom > 1e-6 ? (G * L * L) / denom : 0;
  for (let i = a + 1; i < b; i++) {
    const x = cum[i]! - cum[a]!;
    let y: number;
    if (v2 > 0) y = ya + x * tan - (G * x * x) / (2 * v2 * cos2);
    else {
      const u = x / L;
      y = ya + (yb - ya) * u + 4 * u * (1 - u) * Math.max(1, Math.abs(yb - ya) * 0.25);
    }
    points[i * 3 + 1] = y;
  }
}

export function classicRoute(plan: ChaosTrackPlan): RaceRoute {
  const layout = plan.layout;
  const z0 = layout.spawn.position[2];
  const zFinish = layout.finish.position[2];
  const zEnd = zFinish + RUN_OUT_M;
  // Sample z every 2 m plus every gate's exact z (so gate stations and the finish are exact points).
  const zs: number[] = [];
  for (let z = z0; z < zEnd; z += ROUTE_STEP_M) zs.push(z);
  zs.push(zEnd);
  for (let k = 1; k < layout.checkpoints.length; k++) zs.push(layout.checkpoints[k]!.position[2]);
  zs.push(zFinish);
  zs.sort((a, b) => a - b);
  const pts: number[] = [];
  const surfaces = drivingSurfaces(plan);
  let lastDeck = layout.spawn.position[1];
  let prevZ = -Infinity;
  for (const z of zs) {
    if (z - prevZ < 0.05) continue;
    prevZ = z;
    const x = centerXAt(plan, z);
    const top = deckTopAt(surfaces, x, z);
    if (top === null && z > zFinish) break; // run-out ends where the road does
    pts.push(x, top ?? Number.NaN, z);
    if (top !== null) lastDeck = top;
  }
  const points = new Float32Array(pts);
  const n = points.length / 3;
  // Flights: NaN spans between grounded points.
  const flights: [number, number][] = [];
  const cum = cumulativeOf(points);
  let i = 0;
  while (i < n) {
    if (!Number.isNaN(points[i * 3 + 1]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && Number.isNaN(points[i * 3 + 1]!)) i++;
    const a = start - 1;
    const b = i;
    if (a < 0 || b >= n) {
      for (let k = start; k < i; k++) points[k * 3 + 1] = lastDeck;
      continue;
    }
    fillFlight(points, cum, a, b, takeoffAngleAt(plan, points[a * 3 + 2]!));
    flights.push([start, i]);
  }
  const yaw = yawsOf(points);
  const lengthM = stationAtZ(points, cum, zFinish);
  const gateS: number[] = [0];
  for (let k = 1; k < layout.checkpoints.length; k++) gateS.push(stationAtZ(points, cum, layout.checkpoints[k]!.position[2]));
  gateS.push(lengthM);
  return { id: layout.id, points, cum, lengthM, gateS, yaw, world: 'classic', flights };
}

/** Station where the (z-monotonic) classic route crosses z. */
function stationAtZ(points: Float32Array, cum: Float32Array, z: number): number {
  const n = cum.length;
  for (let i = 1; i < n; i++) {
    const za = points[i * 3 - 1]!;
    const zb = points[i * 3 + 2]!;
    if (z <= zb) {
      const u = zb > za ? (z - za) / (zb - za) : 0;
      return cum[i - 1]! + (cum[i]! - cum[i - 1]!) * Math.min(1, Math.max(0, u));
    }
  }
  return cum[n - 1]!;
}
