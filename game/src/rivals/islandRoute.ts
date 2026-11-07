/**
 * RaceRoute of a Tessera Isle race: the generator's 2 m route (x, y, z with y = road height) as is,
 * gate stations from `event.gates`, plus a tangent run-out after the finish. Heights at runtime come
 * from the terrain (heightAt), so a lateral offset stays on the road camber. Pure data.
 */
import type { WorldEvent } from '../track/world/gen/types';
import { cumulativeOf, yawsOf, type RaceRoute } from './route';
import { RUN_OUT_M } from './classicRoute';

export function islandRoute(event: WorldEvent): RaceRoute {
  const n = event.route.length / 3;
  const extra = Math.ceil(RUN_OUT_M / 2);
  const points = new Float32Array((n + extra) * 3);
  points.set(event.route);
  // Run-out along the final tangent (the finish of every island race sits on a road that continues).
  const ax = event.route[(n - 2) * 3]!;
  const az = event.route[(n - 2) * 3 + 2]!;
  const bx = event.route[(n - 1) * 3]!;
  const by = event.route[(n - 1) * 3 + 1]!;
  const bz = event.route[(n - 1) * 3 + 2]!;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  for (let k = 1; k <= extra; k++) {
    const o = (n - 1 + k) * 3;
    points[o] = bx + tx * 2 * k;
    points[o + 1] = by;
    points[o + 2] = bz + tz * 2 * k;
  }
  const cum = cumulativeOf(points);
  const gateS = [0, ...event.gates.map((gi) => cum[Math.min(gi, n - 1)]!)];
  const lengthM = cum[n - 1]!;
  return { id: event.id, points, cum, lengthM, gateS, yaw: yawsOf(points), world: 'island', flights: [] };
}
