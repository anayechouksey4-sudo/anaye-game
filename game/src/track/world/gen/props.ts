/**
 * Props: every voxel structure on the island as boxes, split into near (everything), far
 * (buildings as 1-2 boxes, trees as 1 box) and solid (collider) lists, plus footprints for the
 * clearance rules. Ghost props (bushes, cacti, crops, fences, lamps, signs, rails, small rocks,
 * hay bales) get no collider. Pure; seeded.
 */
import { mulberry32, type Rng } from '../../chaos/rng';
import type { Box } from './boxMesher';
import type { SegmentIndex } from './geom';
import { heightAt } from './heightAt';
import type { Island } from './island';
import type { RoadBuild } from './roads';
import {
  AVENUES,
  COBBLE_HILL,
  GLASSMERE,
  HEARTHWICK,
  LANTERN_POINT,
  PEAK,
  PLAZA,
  RUNWAY,
  SALTGLASS,
  STREETS,
  rimAt,
  runwayPoint,
  thetaOf,
} from './tessera';
import { CELL, WORLD_CELLS, WORLD_HALF } from './types';

export type PropKind = 'building' | 'solid' | 'tree' | 'ghost' | 'rail' | 'ramp' | 'arch';

/** Rotated footprint rectangle (for clearance checks). */
export interface Footprint {
  kind: PropKind;
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  /** Lowest point of the prop (spans higher than road + 6 m are exempt from road clearances). */
  y0: number;
  label: string;
}

export interface PropSet {
  near: Box[];
  far: Box[];
  solid: Box[];
  footprints: Footprint[];
  trees: number;
  ghostBoxes: number;
}

interface Ctx {
  heights: Float32Array;
  cliff: Uint8Array;
  roads: RoadBuild[];
  index: SegmentIndex;
  island: Island;
  out: PropSet;
  rng: Rng;
}

const C = {
  concrete: 0x4a4f5c,
  glassDark: 0x1d2a3d,
  glassBlue: 0x2b4f7a,
  neonCyan: 0x29f0ff,
  neonPink: 0xff3fb4,
  neonGold: 0xffc23d,
  neonLime: 0x8cff4a,
  steel: 0x6d7480,
  rust: 0xa4552f,
  container: [0xc0392b, 0x2e86c1, 0xf39c12, 0x27ae60, 0x8e44ad, 0xd35400],
  timber: 0x8a5a33,
  timberDark: 0x5e3b20,
  plaster: 0xe8dcc0,
  roofRed: 0xa8432f,
  roofSlate: 0x4d5560,
  stone: 0x9c958a,
  stoneDark: 0x6f6a62,
  sandstone: 0xc97c4f,
  white: 0xf0f0ec,
  pine: 0x2f6b3a,
  pineDark: 0x24552e,
  oak: 0x4f8f3a,
  oakLight: 0x6aa846,
  trunk: 0x5a3d26,
  cactus: 0x4f8a43,
  rock: 0x857a70,
  rockRed: 0xa0573a,
  hay: 0xd8b25a,
  lamp: 0x30343c,
} as const;

/** Distance from (x, z) to the nearest road EDGE (all roads except rails if `skipRail`). */
export function edgeDistance(index: SegmentIndex, roads: RoadBuild[], x: number, z: number, radius = 80, skipRail = true): number {
  let best = Infinity;
  index.forEachNear(x, z, radius, (li, s) => {
    const r = roads[li]!;
    if (skipRail && r.def.kind === 'rail') return;
    const n = r.n;
    const ax = r.xs[s]!;
    const az = r.zs[s]!;
    const bx = r.xs[(s + 1) % n]!;
    const bz = r.zs[(s + 1) % n]!;
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x;
    const ez = az + dz * t - z;
    const d = Math.sqrt(ex * ex + ez * ez) - r.def.width / 2;
    if (d < best) best = d;
  });
  return best;
}

/** Least distance from an axis-aligned w × d rectangle centred at (x, z) to any road edge (perimeter sampled ≤ 3 m apart). */
function rectClearance(ctx: Ctx, x: number, z: number, w: number, d: number): number {
  let best = Infinity;
  const nx = Math.max(1, Math.ceil(w / 3));
  const nz = Math.max(1, Math.ceil(d / 3));
  for (let i = 0; i <= nx; i++) {
    const px = x - w / 2 + (w * i) / nx;
    best = Math.min(best, edgeDistance(ctx.index, ctx.roads, px, z - d / 2), edgeDistance(ctx.index, ctx.roads, px, z + d / 2));
  }
  for (let j = 1; j < nz; j++) {
    const pz = z - d / 2 + (d * j) / nz;
    best = Math.min(best, edgeDistance(ctx.index, ctx.roads, x - w / 2, pz), edgeDistance(ctx.index, ctx.roads, x + w / 2, pz));
  }
  // a road could pass through the lot's interior without touching the sampled rim
  return Math.min(best, edgeDistance(ctx.index, ctx.roads, x, z) - Math.min(w, d) / 2);
}

function ground(ctx: Ctx, x: number, z: number): number {
  return heightAt(ctx.heights, x, z);
}

/** Lowest terrain height under a footprint (corners + centre). */
function groundMin(ctx: Ctx, x: number, z: number, hx: number, hz: number, yaw: number): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let m = ground(ctx, x, z);
  for (const [a, b] of [
    [hx, hz],
    [-hx, hz],
    [hx, -hz],
    [-hx, -hz],
  ] as const) m = Math.min(m, ground(ctx, x + a * c + b * s, z - a * s + b * c));
  return m;
}

function isCliff(ctx: Ctx, x: number, z: number): boolean {
  const cx = Math.floor((x + WORLD_HALF) / CELL);
  const cz = Math.floor((z + WORLD_HALF) / CELL);
  if (cx < 0 || cz < 0 || cx >= WORLD_CELLS || cz >= WORLD_CELLS) return true;
  return ctx.cliff[cz * WORLD_CELLS + cx]! !== 0;
}

interface AddOpts {
  near?: boolean;
  far?: boolean;
  solid?: boolean;
  ghost?: boolean;
}
function box(
  ctx: Ctx,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  color: number,
  glow: number,
  opts: AddOpts,
  groundBox = false,
): Box {
  const b: Box = { x, y, z, sx, sy, sz, yaw, color, glow, ground: groundBox };
  if (opts.near !== false) ctx.out.near.push(b);
  if (opts.far) ctx.out.far.push(b);
  if (opts.solid) ctx.out.solid.push(b);
  if (opts.ghost) ctx.out.ghostBoxes++;
  return b;
}

function footprint(ctx: Ctx, kind: PropKind, x: number, z: number, hx: number, hz: number, yaw: number, y0: number, label: string): void {
  ctx.out.footprints.push({ kind, x, z, hx, hz, yaw, y0, label });
}

/** Local → world offset for a yawed frame. */
function rot(x: number, z: number, lx: number, lz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

// ── Prism City ───────────────────────────────────────────────────────────────────────────────

const SPIRE = { x: -580, z: -160 };

function tower(ctx: Ctx, x: number, z: number, w: number, d: number, h: number, accent: number, rng: Rng): void {
  const g = groundMin(ctx, x, z, w / 2, d / 2, 0);
  const podH = 5 + rng() * 3;
  // podium (sunk 2 m into the ground)
  box(ctx, x, g + (podH - 2) / 2, z, w, podH + 2, d, 0, C.concrete, 0, { far: false, solid: true }, true);
  const bw = w * (0.62 + rng() * 0.18);
  const bd = d * (0.62 + rng() * 0.18);
  const bodyH = h * 0.78;
  const body = box(ctx, x, g + podH + bodyH / 2, z, bw, bodyH, bd, 0, rng() < 0.5 ? C.glassDark : C.glassBlue, 0, { solid: true });
  // far: one box from the ground to the top of the body
  ctx.out.far.push({ ...body, y: g + (podH + bodyH) / 2, sy: podH + bodyH, sx: Math.max(bw, w * 0.8), sz: Math.max(bd, d * 0.8), ground: true });
  const tw = bw * 0.62;
  const td = bd * 0.62;
  const topH = h * 0.22;
  box(ctx, x, g + podH + bodyH + topH / 2, z, tw, topH, td, 0, C.glassDark, 0, { solid: true });
  // glow window strips on the two long faces + a neon crown band
  const strips = Math.max(2, Math.round(bw / 6));
  for (let k = 0; k < strips; k++) {
    const ox = -bw / 2 + (bw / strips) * (k + 0.5);
    box(ctx, x + ox, g + podH + bodyH * 0.5, z + bd / 2 + 0.06, 0.5, bodyH * 0.86, 0.12, 0, accent, 1.6, { ghost: true });
    box(ctx, x + ox, g + podH + bodyH * 0.5, z - bd / 2 - 0.06, 0.5, bodyH * 0.86, 0.12, 0, accent, 1.6, { ghost: true });
  }
  box(ctx, x, g + podH + bodyH - 0.6, z, bw + 0.3, 0.7, bd + 0.3, 0, accent, 2.2, { ghost: true });
  // roof kit
  box(ctx, x + tw * 0.2, g + podH + bodyH + topH + 1, z - td * 0.15, 3, 2, 3, 0, C.steel, 0, { ghost: true });
  box(ctx, x - tw * 0.25, g + podH + bodyH + topH + 2.5, z + td * 0.2, 0.3, 5, 0.3, 0, accent, 2.5, { ghost: true });
  footprint(ctx, 'building', x, z, w / 2, d / 2, 0, g - 2, 'tower');
}

function prismSpire(ctx: Ctx): void {
  const { x, z } = SPIRE;
  const g = groundMin(ctx, x, z, 24, 24, 0);
  box(ctx, x, g + 3, z, 46, 10, 46, 0, C.concrete, 0, { solid: true, far: true }, true);
  let w = 30;
  let y = g + 8;
  for (let k = 0; k < 8; k++) {
    const h = 12 - k * 0.6;
    box(ctx, x, y + h / 2, z, w, h, w, (k % 2) * (Math.PI / 4), k % 2 ? C.glassBlue : C.glassDark, 0, { solid: true, far: k < 4 });
    box(ctx, x, y + h - 0.4, z, w + 0.4, 0.5, w + 0.4, (k % 2) * (Math.PI / 4), k % 3 === 0 ? C.neonPink : C.neonCyan, 2.4, { ghost: true });
    for (const [ox, oz] of [
      [w / 2 + 0.08, 0],
      [-w / 2 - 0.08, 0],
      [0, w / 2 + 0.08],
      [0, -w / 2 - 0.08],
    ] as const) {
      const [px, pz] = rot(x, z, ox, oz, (k % 2) * (Math.PI / 4));
      box(ctx, px, y + h / 2, pz, ox === 0 ? w * 0.5 : 0.14, h * 0.7, oz === 0 ? w * 0.5 : 0.14, (k % 2) * (Math.PI / 4), C.neonCyan, 1.4, { ghost: true });
    }
    y += h;
    w *= 0.86;
  }
  // neon crown + mast
  box(ctx, x, y + 4, z, w * 0.9, 8, w * 0.9, 0, C.neonPink, 3, { far: true, ghost: true });
  box(ctx, x, y + 16, z, 1.2, 18, 1.2, 0, C.neonGold, 3, { far: true, ghost: true });
  footprint(ctx, 'building', x, z, 23, 23, 0, g - 2, 'Prism Spire');
}

function city(ctx: Ctx): void {
  const rng = mulberry32(0xc17);
  const accents = [C.neonCyan, C.neonPink, C.neonGold, C.neonLime];
  const av = [...AVENUES];
  const st = [...STREETS];
  // lots: between consecutive avenues/streets, plus the rim-bounded edge strips
  const xs = [-860, ...av];
  const zs = [-300, ...st, 300];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i]! + 13;
      const x1 = xs[i + 1]! - 13;
      const z0 = zs[j]! + 13;
      const z1 = zs[j + 1]! - 13;
      if (x1 - x0 < 16 || z1 - z0 < 16) continue;
      const cxB = (x0 + x1) / 2;
      const czB = (z0 + z1) / 2;
      if (Math.abs(cxB - SPIRE.x) < 40 && Math.abs(czB - SPIRE.z) < 40) continue; // the Spire block
      const nx = (x1 - x0) > 40 ? 2 : 1;
      const nz = (z1 - z0) > 40 ? 2 : 1;
      for (let a = 0; a < nx; a++)
        for (let b = 0; b < nz; b++) {
          const lx0 = x0 + ((x1 - x0) / nx) * a + 2;
          const lx1 = x0 + ((x1 - x0) / nx) * (a + 1) - 2;
          const lz0 = z0 + ((z1 - z0) / nz) * b + 2;
          const lz1 = z0 + ((z1 - z0) / nz) * (b + 1) - 2;
          const w = lx1 - lx0;
          const d = lz1 - lz0;
          const x = (lx0 + lx1) / 2;
          const z = (lz0 + lz1) / 2;
          // clear of every road (the Rimway bounds the edge strips) and on the city plateau
          if (rectClearance(ctx, x, z, w, d) < 6) continue;
          if (ground(ctx, x, z) < 4.5) continue;
          const near = Math.hypot(x - SPIRE.x, z - SPIRE.z);
          const h = 18 + rng() * 34 + Math.max(0, 140 - near) * 0.22;
          tower(ctx, x, z, w, d, h, accents[Math.floor(rng() * accents.length)]!, rng);
        }
    }
  prismSpire(ctx);
  // neon lamps along the grid streets (alternating sides every 50 m)
  for (const r of ctx.roads) {
    if (r.def.kind !== 'street' || r.def.id === 'pier') continue;
    let side = 1;
    for (let s = 20; s < r.length - 20; s += 50) {
      const i = Math.round(s / r.ds);
      const off = r.def.width / 2 + 2.6;
      const x = r.xs[i]! - r.tz[i]! * off * side;
      const z = r.zs[i]! + r.tx[i]! * off * side;
      if (edgeDistance(ctx.index, ctx.roads, x, z, 30) < 2.2) continue;
      const g = ground(ctx, x, z);
      box(ctx, x, g + 3, z, 0.3, 6, 0.3, 0, C.lamp, 0, { ghost: true }, true);
      box(ctx, x, g + 6.1, z, 1.4, 0.3, 0.3, Math.atan2(r.tx[i]!, r.tz[i]!), r.def.neon ? C.neonCyan : C.neonGold, 2.6, { ghost: true });
      footprint(ctx, 'ghost', x, z, 0.3, 0.3, 0, g, 'lamp');
      side = -side;
    }
  }
}

function docks(ctx: Ctx): void {
  const rng = mulberry32(0xd0c);
  // gantry cranes on the quay edge (legs at z 358 / 372)
  for (const x of [-700, -655, -560, -530]) {
    const g = ground(ctx, x, 365);
    for (const dx of [-5, 5])
      for (const z of [358, 372]) {
        box(ctx, x + dx, g + 11, z, 1.2, 22, 1.2, 0, C.neonGold, 0.2, { solid: true, far: true }, true);
        footprint(ctx, 'solid', x + dx, z, 0.6, 0.6, 0, g, 'crane leg');
      }
    box(ctx, x, g + 22.5, 365, 12, 1.8, 18, 0, C.neonGold, 0.15, { far: true });
    box(ctx, x, g + 23, 365 + 22, 2, 1.2, 30, 0, C.neonGold, 0.15, {});
    box(ctx, x, g + 20, 360, 4, 3, 4, 0, C.steel, 0, {});
    box(ctx, x, g + 24.2, 365, 12.2, 0.3, 0.3, 0, C.neonPink, 2.4, { ghost: true });
  }
  // container stacks north of the quay road
  for (let k = 0; k < 14; k++) {
    const x = -722 + k * 15 + (k > 6 ? 18 : 0);
    if (Math.abs(x + 620) < 12) continue;
    const z = 316 + (k % 2) * 6;
    const g = ground(ctx, x, z);
    if (edgeDistance(ctx.index, ctx.roads, x, z) < 3 + 3.2) continue;
    const levels = 1 + Math.floor(rng() * 3);
    for (let l = 0; l < levels; l++)
      box(ctx, x, g + 1.3 + l * 2.6, z, 12, 2.6, 2.5, 0, C.container[(k + l) % C.container.length]!, 0, { solid: true, far: l === 0 }, l === 0);
    footprint(ctx, 'solid', x, z, 6, 1.25, 0, g, 'container');
  }
  // two warehouses
  for (const [x, z] of [
    [-690, 318],
    [-550, 318],
  ] as const) {
    if (edgeDistance(ctx.index, ctx.roads, x, z) < 3 + 12) continue;
    const g = groundMin(ctx, x, z, 14, 7, 0);
    box(ctx, x, g + 4, z, 28, 10, 14, 0, C.rust, 0, { solid: true, far: true }, true);
    box(ctx, x, g + 9.6, z, 29, 1.2, 15, 0, C.steel, 0, {});
    box(ctx, x, g + 5, z + 7.1, 24, 0.3, 0.2, 0, C.neonCyan, 2, { ghost: true });
    footprint(ctx, 'building', x, z, 14, 7, 0, g - 1, 'warehouse');
  }
}

// ── Coast ───────────────────────────────────────────────────────────────────────────────────

function lighthouse(ctx: Ctx): void {
  const x = LANTERN_POINT.x;
  const z = LANTERN_POINT.z;
  const g = groundMin(ctx, x, z, 4, 4, 0);
  const tiers = [
    [7, 6, C.white],
    [6, 6, C.roofRed],
    [5, 6, C.white],
    [4.2, 4, C.roofRed],
  ] as const;
  let y = g - 1;
  for (const [w, h, col] of tiers) {
    box(ctx, x, y + h / 2, z, w, h, w, 0, col, 0, { solid: true, far: true }, y === g - 1);
    y += h;
  }
  box(ctx, x, y + 1.5, z, 3.4, 3, 3.4, 0, C.neonGold, 3.5, { far: true });
  box(ctx, x, y + 3.4, z, 4.4, 0.8, 4.4, 0, C.roofSlate, 0, {});
  box(ctx, x + 9, g + 2, z + 3, 8, 5, 6, 0.3, C.plaster, 0, { solid: true }, true);
  box(ctx, x + 9, g + 5, z + 3, 8.6, 1.2, 6.6, 0.3, C.roofRed, 0, {});
  footprint(ctx, 'building', x, z, 3.5, 3.5, 0, g - 1, 'lighthouse');
  footprint(ctx, 'building', x + 9, z + 3, 4, 3, 0.3, g, 'keeper house');
}

function kiteflat(ctx: Ctx): void {
  const yaw = RUNWAY.yaw;
  // control tower (W end, seaward apron) and two hangars
  {
    const [x, z] = runwayPoint(14, 40);
    const g = ground(ctx, x, z);
    box(ctx, x, g + 6, z, 4, 12, 4, yaw, C.concrete, 0, { solid: true, far: true }, true);
    box(ctx, x, g + 13.5, z, 7, 3, 7, yaw, C.glassBlue, 0.4, { solid: true, far: true });
    box(ctx, x, g + 15.4, z, 7.6, 0.8, 7.6, yaw, C.roofSlate, 0, {});
    box(ctx, x, g + 16.6, z, 0.3, 2.4, 0.3, 0, C.neonPink, 3, { ghost: true });
    footprint(ctx, 'building', x, z, 3.5, 3.5, yaw, g, 'control tower');
  }
  for (const s of [52, 92]) {
    const [x, z] = runwayPoint(s, 38);
    const g = ground(ctx, x, z);
    box(ctx, x, g + 4.5, z, 22, 9, 16, yaw, C.steel, 0, { solid: true, far: true }, true);
    box(ctx, x, g + 9.4, z, 22.6, 1, 16.6, yaw, C.rust, 0, {});
    const [dx, dz] = rot(x, z, 0, -8.1, yaw);
    box(ctx, dx, g + 3.5, dz, 18, 6.6, 0.2, yaw, C.glassDark, 0, {});
    footprint(ctx, 'building', x, z, 11, 8, yaw, g, 'hangar');
  }
  // windsock pole
  const [wx, wz] = runwayPoint(30, 26);
  const gw = ground(ctx, wx, wz);
  box(ctx, wx, gw + 3, wz, 0.25, 6, 0.25, 0, C.white, 0, { ghost: true }, true);
  box(ctx, wx + 1.2, gw + 5.6, wz, 2.4, 0.7, 0.7, 0, 0xff7a1a, 0.6, { ghost: true });
  footprint(ctx, 'ghost', wx, wz, 0.3, 0.3, 0, gw, 'windsock');
  // runway edge lights (ghost, every 40 m, ±19 m)
  for (let s = 0; s <= RUNWAY.length; s += 40)
    for (const a of [-19, 19]) {
      const [x, z] = runwayPoint(s, a);
      const g = ground(ctx, x, z);
      box(ctx, x, g + 0.25, z, 0.5, 0.5, 0.5, 0, C.neonGold, 2.5, { ghost: true }, true);
    }
}

// ── Cinnabar Reach ──────────────────────────────────────────────────────────────────────────

function tinSpur(ctx: Ctx, loop: RoadBuild): void {
  const rng = mulberry32(0x7151);
  // main street = the loop between x 330 and 405 (heading west)
  let placed = 0;
  for (let s = 0; s < loop.length && placed < 16; s += 2) {
    const i = Math.round(s / loop.ds) % loop.n;
    const x0 = loop.xs[i]!;
    const z0 = loop.zs[i]!;
    if (x0 < 335 || x0 > 400 || z0 < -590 || z0 > -565) continue;
    if (s % 12 !== 0) continue;
    for (const side of [-1, 1]) {
      const yaw = Math.atan2(loop.tx[i]!, loop.tz[i]!);
      const off = 5 + 3 + 6; // road half + clearance + half depth
      const x = x0 - loop.tz[i]! * off * side;
      const z = z0 + loop.tx[i]! * off * side;
      if (edgeDistance(ctx.index, ctx.roads, x, z) - 5.5 < 3.2) continue;
      const g = groundMin(ctx, x, z, 5, 5, yaw);
      const h = 4.5 + rng() * 2.5;
      const col = [C.timber, C.sandstone, C.plaster, C.timberDark][Math.floor(rng() * 4)]!;
      box(ctx, x, g + h / 2 - 0.5, z, 9, h + 1, 9, yaw, col, 0, { solid: true, far: true }, true);
      // false front facing the street
      const [fx, fz] = rot(x, z, 0, 4.6 * side, yaw);
      box(ctx, fx, g + h + 1, fz, 9.4, 3, 0.4, yaw, col, 0, { solid: true });
      const [px, pz] = rot(x, z, 0, 5.4 * side, yaw);
      box(ctx, px, g + 3, pz, 9, 0.3, 1.8, yaw, C.timberDark, 0, { ghost: true });
      footprint(ctx, 'building', x, z, 5, 5, yaw, g - 0.5, 'false front');
      placed++;
    }
  }
  // Copper Cup saloon (two storeys) south of the street
  {
    const x = 362;
    const z = -560;
    if (edgeDistance(ctx.index, ctx.roads, x, z) - 9 > 3) {
      const g = groundMin(ctx, x, z, 8, 7, 0);
      box(ctx, x, g + 4, z, 16, 9, 14, 0, C.timberDark, 0, { solid: true, far: true }, true);
      box(ctx, x, g + 9, z - 7.3, 17, 4, 0.5, 0, C.timber, 0, { solid: true });
      box(ctx, x, g + 9.5, z - 7.6, 8, 1.2, 0.2, 0, 0xffa23a, 2.6, { ghost: true });
      footprint(ctx, 'building', x, z, 8, 7, 0, g, 'Copper Cup');
    }
  }
  // water tower and depot (Dustline terminus)
  {
    const x = 425;
    const z = -600;
    if (edgeDistance(ctx.index, ctx.roads, x, z) > 8) {
      const g = ground(ctx, x, z);
      for (const [dx, dz] of [
        [-2, -2],
        [2, -2],
        [-2, 2],
        [2, 2],
      ] as const)
        box(ctx, x + dx, g + 4, z + dz, 0.5, 8, 0.5, 0, C.timberDark, 0, { solid: true }, true);
      box(ctx, x, g + 10, z, 6, 4.5, 6, 0, C.timber, 0, { solid: true, far: true });
      footprint(ctx, 'solid', x, z, 3, 3, 0, g, 'water tower');
    }
  }
  {
    const x = 416;
    const z = -604;
    const g = groundMin(ctx, x, z, 9, 4, 0.45);
    if (edgeDistance(ctx.index, ctx.roads, x, z) > 13) {
      box(ctx, x, g + 3, z, 18, 6, 8, 0.45, C.sandstone, 0, { solid: true, far: true }, true);
      box(ctx, x, g + 6.4, z, 19, 1, 9, 0.45, C.roofRed, 0, {});
      footprint(ctx, 'building', x, z, 9, 4, 0.45, g, 'depot');
    }
  }
}

function cinnabarArch(ctx: Ctx, loop: RoadBuild): void {
  // nearest loop sample to (112, -560)
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < loop.n; i++) {
    const d = Math.hypot(loop.xs[i]! - 112, loop.zs[i]! - 560 * -1);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  const x = loop.xs[bi]!;
  const z = loop.zs[bi]!;
  const y = loop.h[bi]!;
  const yaw = Math.atan2(loop.tx[bi]!, loop.tz[bi]!);
  const half = loop.def.width / 2;
  const off = half + 4 + 3; // pillar centre: road edge + 4 m + half pillar
  for (const side of [-1, 1]) {
    const [px, pz] = rot(x, z, off * side, 0, yaw);
    const g = Math.min(y, ground(ctx, px, pz));
    box(ctx, px, g + 7, pz, 6, 16, 8, yaw, C.rockRed, 0, { solid: true, far: true }, true);
    box(ctx, px, g + 16, pz, 7, 4, 9, yaw, C.sandstone, 0, { solid: true });
    footprint(ctx, 'arch', px, pz, 3, 4, yaw, g, 'Cinnabar Arch pillar');
  }
  // span: clearance 10 m above the road
  const spanY = y + 10;
  for (let k = -3; k <= 3; k++) {
    const [sx, sz] = rot(x, z, k * 3.1, 0, yaw);
    const hump = 1.2 - Math.abs(k) * 0.25;
    box(ctx, sx, spanY + 2 + hump, sz, 3.4, 4 + hump * 2, 7, yaw, k % 2 ? C.rockRed : C.sandstone, 0, { solid: true, far: k === 0 });
  }
}

function speedTrap(ctx: Ctx, rim: RoadBuild): void {
  const [tx, tz] = rimAt(33);
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < rim.n; i++) {
    const d = Math.hypot(rim.xs[i]! - tx, rim.zs[i]! - tz);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  const x = rim.xs[bi]!;
  const z = rim.zs[bi]!;
  const y = rim.h[bi]!;
  const yaw = Math.atan2(rim.tx[bi]!, rim.tz[bi]!);
  const off = rim.def.width / 2 + 4;
  for (const side of [-1, 1]) {
    const [px, pz] = rot(x, z, off * side, 0, yaw);
    const g = ground(ctx, px, pz);
    box(ctx, px, g + 4.5, pz, 0.8, 9, 0.8, yaw, C.steel, 0, { solid: true, far: true }, true);
    footprint(ctx, 'solid', px, pz, 0.4, 0.4, yaw, g, 'trap post');
  }
  box(ctx, x, y + 8.6, z, off * 2 + 1, 1.2, 1, yaw, C.steel, 0, { far: true });
  box(ctx, x, y + 8.6, z + 0, off * 2 - 2, 0.4, 1.1, yaw, C.neonPink, 2.8, { ghost: true });
}

// ── Patchwork Downs ─────────────────────────────────────────────────────────────────────────

function hearthwick(ctx: Ctx): void {
  const rng = mulberry32(0x4ea7);
  const cx = HEARTHWICK.x;
  const cz = HEARTHWICK.z;
  let n = 0;
  for (let k = 0; k < 60 && n < 24; k++) {
    const a = rng() * Math.PI * 2;
    const r = 40 + rng() * 55;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const yaw = Math.round((a + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
    if (edgeDistance(ctx.index, ctx.roads, x, z) - 5 < 6) continue;
    if (isCliff(ctx, x, z)) continue;
    if (ctx.out.footprints.some((f) => f.kind === 'building' && Math.hypot(f.x - x, f.z - z) < 13)) continue;
    const g = groundMin(ctx, x, z, 4, 3.5, yaw);
    const col = rng() < 0.5 ? C.plaster : C.stone;
    box(ctx, x, g + 2, z, 8, 5, 7, yaw, col, 0, { solid: true, far: true }, true);
    box(ctx, x, g + 5, z, 8.8, 1.4, 7.6, yaw, rng() < 0.6 ? C.roofRed : C.roofSlate, 0, { solid: true });
    box(ctx, x, g + 6.2, z, 6, 1.2, 4.4, yaw, rng() < 0.6 ? C.roofRed : C.roofSlate, 0, {});
    const [hx, hz] = rot(x, z, 2.5, 1.5, yaw);
    box(ctx, hx, g + 7, hz, 1, 2.4, 1, yaw, C.stoneDark, 0, { ghost: true });
    footprint(ctx, 'building', x, z, 4.4, 3.8, yaw, g, 'cottage');
    n++;
  }
  // windmill (east of the square)
  {
    const x = cx + 62;
    const z = cz - 40;
    if (edgeDistance(ctx.index, ctx.roads, x, z) > 10) {
      const g = ground(ctx, x, z);
      box(ctx, x, g + 6, z, 6, 12, 6, 0, C.white, 0, { solid: true, far: true }, true);
      box(ctx, x, g + 12.5, z, 4.5, 3, 4.5, 0, C.roofRed, 0, { solid: true });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.4;
        box(ctx, x + Math.cos(a) * 4.5, g + 12 + Math.sin(a) * 4.5, z + 3.4, 1.2, 1.2, 0.3, 0, C.timber, 0, { ghost: true });
        box(ctx, x + Math.cos(a) * 7, g + 12 + Math.sin(a) * 7, z + 3.4, 1.6, 1.6, 0.2, 0, C.plaster, 0, { ghost: true });
      }
      footprint(ctx, 'building', x, z, 3, 3, 0, g, 'windmill');
    }
  }
  // well + market stalls on the square (ghost, ≥ 2 m from the lane edge)
  const g0 = ground(ctx, cx, cz);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const x = cx + Math.cos(a) * 20;
    const z = cz + Math.sin(a) * 20;
    if (edgeDistance(ctx.index, ctx.roads, x, z) < 4) continue;
    box(ctx, x, g0 + 1, z, 3, 2, 2, a, C.timber, 0, { ghost: true }, true);
    box(ctx, x, g0 + 2.4, z, 3.6, 0.4, 2.6, a, [C.roofRed, C.neonGold, C.plaster][k % 3]!, 0, { ghost: true });
    footprint(ctx, 'ghost', x, z, 1.8, 1.3, a, g0, 'market stall');
  }
}

function cobblekeep(ctx: Ctx, ramp: RoadBuild | undefined): void {
  const cx = COBBLE_HILL.x;
  const cz = COBBLE_HILL.z;
  const y = COBBLE_HILL.top;
  // gate bearing: where the ramp meets the courtyard
  let gateA = Math.PI;
  if (ramp) gateA = Math.atan2(ramp.zs[ramp.n - 1]! - cz, ramp.xs[ramp.n - 1]! - cx);
  const R = 38;
  const segs = 20;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2;
    const a1 = ((k + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    let da = Math.abs(((am - gateA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.2) continue; // gate gap (≈ 10 m)
    const x = cx + Math.cos(am) * R;
    const z = cz + Math.sin(am) * R;
    const len = 2 * R * Math.sin(Math.PI / segs) + 0.6;
    const yaw = -am + Math.PI / 2;
    box(ctx, x, y + 3.5, z, len, 9, 3, yaw, C.stone, 0, { solid: true, far: true }, true);
    for (let b = -1; b <= 1; b++) {
      const [bx, bz] = rot(x, z, b * (len / 3), 0, yaw);
      box(ctx, bx, y + 8.6, bz, len / 5, 1.2, 3.2, yaw, C.stoneDark, 0, { ghost: true });
    }
    footprint(ctx, 'building', x, z, len / 2, 1.5, yaw, y - 1, 'curtain wall');
    da = 0;
  }
  // towers at the diagonals and flanking the gate
  const towerAt = (a: number, h: number) => {
    const x = cx + Math.cos(a) * R;
    const z = cz + Math.sin(a) * R;
    box(ctx, x, y + h / 2 - 1, z, 7, h + 2, 7, 0, C.stone, 0, { solid: true, far: true }, true);
    box(ctx, x, y + h + 0.6, z, 8, 1.2, 8, 0, C.stoneDark, 0, {});
    footprint(ctx, 'building', x, z, 3.5, 3.5, 0, y - 1, 'tower');
  };
  for (const a of [0.8, 2.4, 3.9, 5.5]) {
    const da = Math.abs(((a - gateA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da > 0.45) towerAt(a, 14);
  }
  towerAt(gateA + 0.3, 12);
  towerAt(gateA - 0.3, 12);
  // keep
  box(ctx, cx, y + 9, cz, 14, 20, 14, 0, C.stone, 0, { solid: true, far: true }, true);
  box(ctx, cx, y + 19.6, cz, 15, 1.4, 15, 0, C.stoneDark, 0, {});
  box(ctx, cx, y + 22, cz, 1, 4, 1, 0, C.neonGold, 2, { ghost: true });
  footprint(ctx, 'building', cx, cz, 7, 7, 0, y - 1, 'keep');
}

function glassmereJetty(ctx: Ctx): void {
  const x = GLASSMERE.x - 40;
  const z0 = GLASSMERE.z - GLASSMERE.b * 0.98;
  for (let k = 0; k < 6; k++) {
    const z = z0 + k * 3;
    box(ctx, x, GLASSMERE.level + 0.35, z, 3, 0.3, 2.8, 0, C.timber, 0, { ghost: true });
    box(ctx, x - 1.4, GLASSMERE.level - 0.2, z, 0.3, 1.4, 0.3, 0, C.timberDark, 0, { ghost: true });
  }
  footprint(ctx, 'ghost', x, z0 + 8, 1.5, 9, 0, GLASSMERE.level, 'jetty');
}

// ── The Crown ───────────────────────────────────────────────────────────────────────────────

function observatory(ctx: Ctx): void {
  const x = PEAK.x + 6;
  const z = PEAK.z - 7;
  const y = PLAZA.y;
  box(ctx, x, y + 2.5, z, 11, 7, 11, 0, C.white, 0, { solid: true, far: true }, true);
  const tiers = [10, 8, 6, 3.5];
  tiers.forEach((w, k) => box(ctx, x, y + 6.5 + k * 1.8, z, w, 1.8, w, 0, C.steel, 0, { solid: true, far: k === 0 }));
  box(ctx, x, y + 9, z + 3, 1.2, 5, 4, 0, C.neonCyan, 2.4, { ghost: true });
  footprint(ctx, 'building', x, z, 5.5, 5.5, 0, y - 1, 'observatory');
}

/** Guard rails: outside of hairpin pads, and where the drop beside a mountain road exceeds 6 m. */
function guardRails(ctx: Ctx): number {
  let count = 0;
  for (const r of ctx.roads) {
    if (r.def.kind !== 'mountain') continue;
    const off = r.def.width / 2 + 1.5;
    for (let s = 2; s < r.length - 2; s += 4) {
      const i = Math.round(s / r.ds);
      const pad = (r.flags[i]! & 1) !== 0;
      for (const side of [-1, 1]) {
        const nx = -r.tz[i]! * side;
        const nz = r.tx[i]! * side;
        const px = r.xs[i]! + nx * off;
        const pz = r.zs[i]! + nz * off;
        let need = false;
        if (pad) {
          // outside of the hairpin = away from the turn centre (side where the curvature points out)
          const ia = Math.max(0, i - 3);
          const ib = Math.min(r.n - 1, i + 3);
          const cross = r.tx[ia]! * r.tz[ib]! - r.tz[ia]! * r.tx[ib]!;
          need = (cross > 0 ? -1 : 1) === side && Math.abs(cross) > 0.05;
        }
        const drop = r.h[i]! - ground(ctx, r.xs[i]! + nx * (off + 8), r.zs[i]! + nz * (off + 8));
        if (drop > 6) need = true;
        if (!need) continue;
        if (edgeDistance(ctx.index, ctx.roads, px, pz, 24) < 1.0) continue; // a junction mouth
        const yaw = Math.atan2(r.tx[i]!, r.tz[i]!);
        const y = r.h[i]!;
        box(ctx, px, y + 0.45, pz, 0.35, 0.9, 4.1, yaw, C.steel, 0, { solid: true });
        box(ctx, px, y + 0.85, pz, 0.38, 0.12, 4.1, yaw, C.neonGold, 1.2, { ghost: true });
        footprint(ctx, 'rail', px, pz, 0.2, 2.05, yaw, y, r.def.id);
        count++;
      }
    }
  }
  return count;
}

// ── Vegetation and scatter ──────────────────────────────────────────────────────────────────

function trees(ctx: Ctx): void {
  const rng = mulberry32(0x7ee5);
  const noise = ctx.island.noise;
  const max = 2400;
  let placed = 0;
  const grid = new Map<number, number[]>();
  const key = (x: number, z: number) => Math.floor((x + 1024) / 12) * 4096 + Math.floor((z + 1024) / 12);
  const tooClose = (x: number, z: number, d: number) => {
    const kx = Math.floor((x + 1024) / 12);
    const kz = Math.floor((z + 1024) / 12);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = grid.get((kx + a) * 4096 + kz + b);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if (Math.hypot(list[k]! - x, list[k + 1]! - z) < d) return true;
      }
    return false;
  };
  const buildings = ctx.out.footprints.filter((f) => f.kind === 'building' || f.kind === 'solid');
  for (let attempt = 0; attempt < 26000 && placed < max; attempt++) {
    const x = -1000 + rng() * 2000;
    const z = -1000 + rng() * 2000;
    const h = ground(ctx, x, z);
    if (h < 2.5) continue;
    if (isCliff(ctx, x, z)) continue;
    const region = ctx.island.regionAt(x, z);
    if (region === 'sea' || region === 'prism-city') continue;
    const dens = noise.fbm(x + 3000, z - 1000, 160, 2);
    let kind: 'pine' | 'oak' | 'cactus';
    if (region === 'cinnabar-reach') {
      if (dens < 0.05) continue;
      kind = 'cactus';
    } else if (region === 'the-crown') {
      const rho = Math.hypot(x - PEAK.x, z - PEAK.z);
      const b = (Math.atan2(z - PEAK.z, x - PEAK.x) * 180) / Math.PI;
      const ws = b > 60 && b < 230; // W and S slopes (Pinewhisper Woods)
      if (!ws && dens < 0.25) continue;
      if (h < 14 || h > 112 || rho < 60) continue;
      kind = 'pine';
    } else {
      if (dens < 0.12) continue;
      kind = region === 'patchwork-downs' || region === 'kite-bay' ? 'oak' : 'pine';
    }
    // slope limit
    const hx = ground(ctx, x + 2, z) - ground(ctx, x - 2, z);
    const hz = ground(ctx, x, z + 2) - ground(ctx, x, z - 2);
    if (Math.hypot(hx, hz) / 4 > 0.5) continue;
    // clearances: road edge ≥ 8 m (trees), lake, flats, buildings
    if (edgeDistance(ctx.index, ctx.roads, x, z, 30) < 8.6) continue;
    if (Math.hypot((x - GLASSMERE.x) / GLASSMERE.a, (z - GLASSMERE.z) / GLASSMERE.b) < 1.3) continue;
    if (Math.hypot((x - SALTGLASS.x) / SALTGLASS.a, (z - SALTGLASS.z) / SALTGLASS.b) < 1.15) continue;
    if (Math.hypot(x - COBBLE_HILL.x, z - COBBLE_HILL.z) < 52) continue;
    if (Math.hypot(x - HEARTHWICK.x, z - HEARTHWICK.z) < 34) continue;
    if (inRunwayArea(x, z, 30)) continue;
    if (buildings.some((f) => Math.abs(f.x - x) < f.hx + f.hz + 4 && Math.abs(f.z - z) < f.hx + f.hz + 4)) continue;
    if (tooClose(x, z, kind === 'cactus' ? 9 : 6)) continue;
    const k2 = key(x, z);
    let list = grid.get(k2);
    if (!list) grid.set(k2, (list = []));
    list.push(x, z);
    const s = 0.8 + rng() * 0.5;
    if (kind === 'pine') {
      const big = s > 1.05;
      box(ctx, x, h + 1.6 * s - 0.4, z, 0.8, 3.2 * s + 0.8, 0.8, 0, C.trunk, 0, { solid: big }, true);
      box(ctx, x, h + 4.2 * s, z, 4.2 * s, 3.2 * s, 4.2 * s, 0, C.pine, 0, {});
      box(ctx, x, h + 6.8 * s, z, 2.6 * s, 2.6 * s, 2.6 * s, 0, C.pineDark, 0, {});
      ctx.out.far.push({ x, y: h + 4.6 * s, z, sx: 3.6 * s, sy: 7 * s, sz: 3.6 * s, yaw: 0, color: C.pine, glow: 0, ground: true });
      footprint(ctx, big ? 'tree' : 'tree', x, z, 0.4, 0.4, 0, h, 'pine');
    } else if (kind === 'oak') {
      const big = s > 1.05;
      box(ctx, x, h + 1.4 * s - 0.4, z, 0.8, 2.8 * s + 0.8, 0.8, 0, C.trunk, 0, { solid: big }, true);
      box(ctx, x, h + 4 * s, z, 5 * s, 3 * s, 5 * s, 0, C.oak, 0, {});
      box(ctx, x + 0.6, h + 5.8 * s, z - 0.4, 3.2 * s, 1.6 * s, 3.2 * s, 0, C.oakLight, 0, {});
      ctx.out.far.push({ x, y: h + 3.6 * s, z, sx: 4.6 * s, sy: 5.6 * s, sz: 4.6 * s, yaw: 0, color: C.oak, glow: 0, ground: true });
      footprint(ctx, 'tree', x, z, 0.4, 0.4, 0, h, 'oak');
    } else {
      box(ctx, x, h + 1.6 * s, z, 0.9, 3.2 * s, 0.9, 0, C.cactus, 0, { ghost: true }, true);
      box(ctx, x + 0.9, h + 2.2 * s, z, 0.9, 0.6, 0.6, 0, C.cactus, 0, { ghost: true });
      box(ctx, x + 1.2, h + 2.8 * s, z, 0.6, 1.4 * s, 0.6, 0, C.cactus, 0, { ghost: true });
      footprint(ctx, 'tree', x, z, 0.5, 0.5, 0, h, 'cactus');
    }
    placed++;
  }
  ctx.out.trees = placed;
}

function rocks(ctx: Ctx): void {
  const rng = mulberry32(0x40c5);
  let n = 0;
  for (let attempt = 0; attempt < 3000 && n < 220; attempt++) {
    const x = -1000 + rng() * 2000;
    const z = -1000 + rng() * 2000;
    const region = ctx.island.regionAt(x, z);
    if (region !== 'cinnabar-reach' && region !== 'the-crown' && region !== 'shell-cove') continue;
    const h = ground(ctx, x, z);
    if (h < 2 || isCliff(ctx, x, z)) continue;
    const big = rng() < 0.3;
    const s = big ? 1.6 + rng() * 1.4 : 0.5 + rng() * 0.8;
    const need = big ? 3.2 : 2.2;
    if (edgeDistance(ctx.index, ctx.roads, x, z, 30) < need + s + 0.5) continue;
    if (inRunwayArea(x, z, 10)) continue;
    if (Math.hypot((x - SALTGLASS.x) / SALTGLASS.a, (z - SALTGLASS.z) / SALTGLASS.b) < 1.1) continue;
    const col = region === 'cinnabar-reach' ? C.rockRed : C.rock;
    const yaw = rng() * Math.PI;
    box(ctx, x, h + s * 0.35, z, s * 1.3, s, s, yaw, col, 0, { solid: big, ghost: !big, far: big }, true);
    footprint(ctx, big ? 'solid' : 'ghost', x, z, s * 0.65, s * 0.5, yaw, h, big ? 'boulder' : 'rock');
    n++;
  }
}

function dustlineRails(ctx: Ctx, rail: RoadBuild | undefined): void {
  if (!rail) return;
  for (let s = 0; s < rail.length - 4; s += 8) {
    const i = Math.round(s / rail.ds);
    const yaw = Math.atan2(rail.tx[i]!, rail.tz[i]!);
    const y = rail.h[i]!;
    for (const side of [-0.75, 0.75]) {
      const [x, z] = rot(rail.xs[i]!, rail.zs[i]!, side, 0, yaw);
      const [cx, cz] = rot(x, z, 0, 4, yaw);
      box(ctx, cx, y + 0.12, cz, 0.15, 0.2, 8.05, yaw, C.steel, 0.1, { ghost: true });
    }
  }
}

function hayAndFences(ctx: Ctx): void {
  const rng = mulberry32(0x4a7);
  // hay bales in the meadows east of Hearthwick (ghost; the hop kickers are ramps)
  for (let k = 0; k < 18; k++) {
    const x = 230 + rng() * 140;
    const z = 630 + rng() * 70;
    if (edgeDistance(ctx.index, ctx.roads, x, z, 30) < 3) continue;
    if (Math.abs(z - 668) < 8 && x > 250 && x < 315) continue; // the Hay Hops line
    const h = ground(ctx, x, z);
    box(ctx, x, h + 0.6, z, 1.6, 1.2, 1.2, rng() * Math.PI, C.hay, 0, { ghost: true }, true);
    footprint(ctx, 'ghost', x, z, 0.8, 0.8, 0, h, 'hay bale');
  }
  // field fences along the lanes (ghost), 3 m outside the edge
  for (const r of ctx.roads) {
    if (r.def.id !== 'lanes') continue;
    for (let s = 40; s < r.length - 40; s += 6) {
      const i = Math.round(s / r.ds);
      if (r.flags[i]! & 8) continue;
      const side = Math.floor(s / 90) % 2 ? 1 : -1;
      const off = r.def.width / 2 + 3;
      const x = r.xs[i]! - r.tz[i]! * off * side;
      const z = r.zs[i]! + r.tx[i]! * off * side;
      if (edgeDistance(ctx.index, ctx.roads, x, z, 24) < 2.4) continue;
      if (Math.hypot((x - GLASSMERE.x) / GLASSMERE.a, (z - GLASSMERE.z) / GLASSMERE.b) < 1.2) continue;
      const h = ground(ctx, x, z);
      const yaw = Math.atan2(r.tx[i]!, r.tz[i]!);
      box(ctx, x, h + 0.55, z, 0.15, 1.1, 6, yaw, C.timber, 0, { ghost: true }, true);
    }
  }
}

function inRunwayArea(x: number, z: number, pad: number): boolean {
  const sx = Math.sin(RUNWAY.yaw);
  const sz = Math.cos(RUNWAY.yaw);
  const dx = x - RUNWAY.wx;
  const dz = z - RUNWAY.wz;
  const along = dx * sx + dz * sz;
  const across = -(dx * sz - dz * sx);
  return along > RUNWAY.s0 - pad && along < RUNWAY.s1 + pad && across > RUNWAY.across0 - pad && across < RUNWAY.across1 + pad;
}

export function buildProps(heights: Float32Array, cliff: Uint8Array, roads: RoadBuild[], index: SegmentIndex, island: Island): PropSet {
  const out: PropSet = { near: [], far: [], solid: [], footprints: [], trees: 0, ghostBoxes: 0 };
  const ctx: Ctx = { heights, cliff, roads, index, island, out, rng: mulberry32(0x9e0) };
  const byId = (id: string) => roads.find((r) => r.def.id === id);
  city(ctx);
  docks(ctx);
  lighthouse(ctx);
  kiteflat(ctx);
  const loop = byId('cinnabar-loop');
  if (loop) {
    tinSpur(ctx, loop);
    cinnabarArch(ctx, loop);
  }
  const rim = byId('rimway');
  if (rim) speedTrap(ctx, rim);
  hearthwick(ctx);
  cobblekeep(ctx, byId('castle-ramp'));
  glassmereJetty(ctx);
  observatory(ctx);
  guardRails(ctx);
  dustlineRails(ctx, byId('dustline'));
  hayAndFences(ctx);
  rocks(ctx);
  trees(ctx);
  void thetaOf;
  return out;
}
