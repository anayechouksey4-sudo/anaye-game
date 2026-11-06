/**
 * Section helpers shared by the map recipes (pure data, built on the plan builder).
 */
import type { PlanBuilder } from '../chaos/plan';
import { stepped, type Rng } from '../chaos/rng';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * `count` back-to-back staircase chicanes weaving across the centreline: each one swings to the
 * other side (a lane ±shift/2 from the centre, shift from the connector tuning). Consecutive
 * S-bends in alternating directions join with matching curvature, so together they drive as one
 * sinuous road rather than a string of lane changes.
 */
export function sBends(b: PlanBuilder, rng: Rng, count: number): void {
  const c = b.recipe.tunings.connector;
  const last = b.segments[b.segments.length - 1];
  let dir = last?.kind === 'chicane' ? -Math.sign(last.shift) : b.x > 0.5 ? -1 : b.x < -0.5 ? 1 : rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const amplitude = Math.min(c.maxOffset, stepped(rng, c.shiftMin, c.shiftMax, 1) / 2);
    const shift = Math.round((dir * amplitude - b.x) * 2) / 2;
    b.chicane(stepped(rng, c.chicaneMin, c.chicaneMax, 4), shift);
    dir = -dir;
  }
}

/**
 * Floating-island rock under every run of flat, touching, same-height decks (gap landings,
 * lead-ins, island decks, run-ups): each run reads as one island.
 */
export function rockUnderIslands(b: PlanBuilder, minLength = 12): void {
  const flats = b.decks
    .filter((d) => d.pitch === 0)
    .map((d) => ({
      z0: d.center[2] - d.size[2] / 2,
      z1: d.center[2] + d.size[2] / 2,
      x: d.center[0],
      top: d.center[1] + d.size[1] / 2,
      width: d.size[0],
    }))
    .sort((a, b2) => a.z0 - b2.z0);
  let run: { z0: number; z1: number; x: number; top: number; width: number } | null = null;
  const flush = () => {
    if (run && run.z1 - run.z0 >= minLength) b.islandRock(run.z0, run.z1, run.x, run.width, run.top);
  };
  for (const f of flats) {
    if (run && Math.abs(f.z0 - run.z1) < 0.05 && Math.abs(f.top - run.top) < 0.01 && Math.abs(f.x - run.x) < 0.01) {
      run.z1 = f.z1;
      run.width = Math.max(run.width, f.width);
    } else {
      flush();
      run = { ...f };
    }
  }
  flush();
}

/** Runway lights along both deck edges (visual): a glowing post every `every` m from z0 to z1. */
export function edgeLights(b: PlanBuilder, z0: number, z1: number, every: number, color: string, width = b.width): void {
  for (let z = z0; z <= z1; z += every) {
    for (const side of [-1, 1]) {
      const x = b.x + side * (width / 2 + 0.9);
      b.trims.push({ center: [r3(x), r3(b.y + 0.6), r3(z)], size: [0.35, 1.2, 0.35], color: '#1a1a24', glow: 0 });
      b.trims.push({ center: [r3(x), r3(b.y + 1.35), r3(z)], size: [0.5, 0.3, 0.5], color, glow: 3 });
    }
  }
}

/** Distance boards across the deck every `every` m (a glowing bar + side boards), for drag runs. */
export function distanceBars(b: PlanBuilder, z0: number, z1: number, every: number, color: string, width = b.width): void {
  for (let z = z0; z <= z1; z += every) {
    b.trims.push({ center: [r3(b.x), r3(b.y + 0.02), r3(z)], size: [width - 0.6, 0.05, 0.3], color, glow: 1.6 });
  }
}
