/**
 * Island textures (pure byte arrays): surface map, region map, tile colours with baked prop
 * shadows / AO and water depth, the road field, and the north-up minimap. Pure.
 */
import { heightAt as heightAt_ } from './heightAt';
import type { Island } from './island';
import type { Footprint } from './props';
import type { RoadBuild } from './roads';
import { FLAT_AREAS as FLAT_AREAS_, GLASSMERE as GLASSMERE_, PALETTE } from './tessera';
import type { TerrainBuild } from './terrain';
import {
  CELL,
  FIELD_KERB as FIELD_KERB_,
  FIELD_KIND as FIELD_KIND_,
  FIELD_NEON as FIELD_NEON_,
  FIELD_PHASE_M,
  FIELD_WIDTHS as FIELD_WIDTHS_,
  LAKE_LEVEL as LAKE_LEVEL_,
  REGION_IDS as REGION_IDS_,
  SURF as SURF_,
  WORLD_CELLS,
  WORLD_HALF,
  WORLD_N,
  type RegionId,
} from './types';

// Local aliases: hot loops must not go through module-namespace getters.
const N = WORLD_N;
const NC = WORLD_CELLS;
const HALF = WORLD_HALF;
const STEP = CELL;
const heightAt = heightAt_;
const FLAT_AREAS = FLAT_AREAS_;
const LAKE = GLASSMERE_;
const FIELD_KERB = FIELD_KERB_;
const FIELD_KIND = FIELD_KIND_;
const FIELD_NEON = FIELD_NEON_;
const FIELD_WIDTHS = FIELD_WIDTHS_;
const LAKE_LEVEL = LAKE_LEVEL_;
const REGION_IDS = REGION_IDS_;
const SURF = SURF_;
const PHASE_K = (2 * Math.PI) / FIELD_PHASE_M;

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const P = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hex(v)])) as Record<keyof typeof PALETTE, [number, number, number]>;

// Constant colours (no per-cell array literals in the hot loop: the cold run is GC-bound otherwise).
type RGB = readonly [number, number, number];
const C_CITY: RGB = [86, 90, 102];
const C_CROP0: RGB = [196, 168, 74];
const C_CROP1: RGB = [120, 160, 70];
const C_CROP2: RGB = [150, 120, 70];
const M_HIGHWAY: RGB = [255, 206, 84];
const M_RAIL: RGB = [70, 60, 55];
const M_DIRT: RGB = [214, 160, 104];
const M_COBBLE: RGB = [215, 205, 190];
const M_ROAD: RGB = [236, 238, 244];

/** Integer hash → [0, 1). */
function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Is (x, z) inside Glassmere's water region? */
export function inLake(x: number, z: number): boolean {
  const ex = (x - LAKE.x) / LAKE.a;
  const ez = (z - LAKE.z) / LAKE.b;
  return ex * ex + ez * ez < 1.69;
}

/** Water level at (x, z): the lake inside its basin, else the sea. */
export function waterLevelAt(x: number, z: number): number {
  return inLake(x, z) ? LAKE_LEVEL : 0;
}

export interface TextureSet {
  surface: Uint8Array;
  region: Uint8Array;
  tileTex: Uint8Array;
  fieldTex: Uint8Array;
  minimap: Uint8Array;
}

export function buildTextures(t: TerrainBuild, island: Island, roads: RoadBuild[], footprints: readonly Footprint[]): TextureSet {
  const H = t.heights;
  const surface = new Uint8Array(NC * NC);
  const region = new Uint8Array(128 * 128);
  const tileTex = new Uint8Array(NC * NC * 4);
  const fieldTex = new Uint8Array(N * N * 4);
  const minimap = new Uint8Array(NC * NC * 4);

  // Region map (16 m cells).
  for (let rz = 0; rz < 128; rz++)
    for (let rx = 0; rx < 128; rx++) region[rz * 128 + rx] = REGION_IDS.indexOf(island.regionAt(-HALF + rx * 16 + 8, -HALF + rz * 16 + 8));

  // Road field (per vertex).
  for (let v = 0; v < N * N; v++) {
    const d = t.roadDist[v]!;
    const ri = t.roadNear[v]!;
    const o = v * 4;
    if (ri < 0 || d >= 63.75) {
      fieldTex[o] = 255;
      fieldTex[o + 1] = 128;
      fieldTex[o + 2] = 255;
      fieldTex[o + 3] = 0;
      continue;
    }
    const r = roads[ri]!;
    fieldTex[o] = Math.min(255, Math.round(d * 4));
    const ph = PHASE_K * t.roadStation[v]!;
    fieldTex[o + 1] = Math.round(128 + 127 * Math.sin(ph));
    fieldTex[o + 2] = Math.round(128 + 127 * Math.cos(ph));
    let kind: number = FIELD_KIND.asphalt;
    if (r.def.kind === 'rail') kind = FIELD_KIND.rail;
    else if (r.def.plank) kind = FIELD_KIND.plank;
    else if (r.def.surface === 'dirt') kind = FIELD_KIND.dirt;
    else if (r.def.surface === 'cobble') kind = FIELD_KIND.cobble;
    let wc = FIELD_WIDTHS.indexOf(r.def.width as (typeof FIELD_WIDTHS)[number]);
    if (wc < 0) wc = 0;
    let a = kind | (wc << 3);
    if (r.def.neon) a |= FIELD_NEON;
    if (r.def.kerbs) {
      const i = Math.round(t.roadStation[v]! / r.ds) % r.n;
      if (r.radius[i]! < 700) a |= FIELD_KERB;
    }
    fieldTex[o + 3] = a;
  }

  // Building / tree shading (baked AO + soft shadow toward +x +z).
  const shade = new Float32Array(NC * NC);
  for (const f of footprints) {
    const tall = f.kind === 'building' ? 1 : f.kind === 'tree' ? 0.45 : f.kind === 'solid' ? 0.6 : 0;
    if (!tall) continue;
    const r = Math.max(f.hx, f.hz) + (f.kind === 'building' ? 6 : 2.5);
    const sx = f.x + (f.kind === 'building' ? 4 : 1.5);
    const sz = f.z + (f.kind === 'building' ? 4 : 1.5);
    const c0 = Math.max(0, Math.floor((sx - r + HALF) / STEP));
    const c1 = Math.min(NC - 1, Math.floor((sx + r + HALF) / STEP));
    const z0 = Math.max(0, Math.floor((sz - r + HALF) / STEP));
    const z1 = Math.min(NC - 1, Math.floor((sz + r + HALF) / STEP));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = c0; cx <= c1; cx++) {
        const px = -HALF + cx * STEP + 2;
        const pz = -HALF + cz * STEP + 2;
        const d = Math.hypot(px - sx, pz - sz) / r;
        if (d < 1) shade[cz * NC + cx] = Math.max(shade[cz * NC + cx]!, tall * (1 - d) * 0.45);
      }
  }

  const regionNames = REGION_IDS.map((r) => r as RegionId);
  for (let cz = 0; cz < NC; cz++)
    for (let cx = 0; cx < NC; cx++) {
      const c = cz * NC + cx;
      const x = -HALF + cx * STEP + 2;
      const z = -HALF + cz * STEP + 2;
      const v = cz * N + cx;
      const h = heightAt(H, x, z);
      const gx = (H[v + 1]! + H[v + N + 1]! - H[v]! - H[v + N]!) / (2 * STEP);
      const gz = (H[v + N]! + H[v + N + 1]! - H[v]! - H[v + 1]!) / (2 * STEP);
      const slope = Math.hypot(gx, gz);
      const wl = waterLevelAt(x, z);
      const depth = wl - h;
      const reg = regionNames[region[(cz >> 2) * 128 + (cx >> 2)]!]!;
      // ── surface
      let s: number = SURF.grass;
      let col: RGB;
      const roadI = t.roadNear[v]!;
      const roadOn = roadI >= 0 && t.roadDist[v]! <= roads[roadI]!.def.width / 2;
      const ai = Math.max(t.areaIdx[v]!, t.areaIdx[v + N + 1]!);
      const area = ai >= 0 ? FLAT_AREAS[ai]! : null;
      if (depth > 0.05) {
        s = SURF.water;
        col = depth > 3 ? P.sea : P.shallow;
      } else if (roadOn) {
        const r = roads[roadI]!;
        s = SURF[r.def.surface];
        col = r.def.surface === 'dirt' ? P.dirt : r.def.surface === 'cobble' ? P.cobble : P.asphalt;
      } else if (area) {
        s = SURF[area.surface];
        col = area.surface === 'salt' ? P.salt : area.surface === 'cobble' ? P.cobble : P.asphalt;
      } else if (t.cliff[c] || slope > 0.62) {
        s = SURF.rock;
        col = reg === 'cinnabar-reach' ? P.cinnabar : reg === 'shell-cove' ? P.chalk : P.rock;
      } else if (h < 2.6 && island.landDist(x, z) < 40) {
        s = SURF.sand;
        col = P.sand;
      } else if (reg === 'the-crown' && h > 150) {
        s = SURF.snow;
        col = P.snow;
      } else if (reg === 'cinnabar-reach') {
        s = SURF.sand;
        col = hash2(cx >> 3, cz >> 3) < 0.5 ? P.cinnabar : P.cinnabarDust;
      } else if (reg === 'prism-city') {
        s = SURF.asphalt;
        col = C_CITY;
      } else {
        s = SURF.grass;
        if (reg === 'patchwork-downs') {
          // crop patchwork: 32 m fields in four tints
          const k = Math.floor(hash2((x + 2048) >> 5, (z + 2048) >> 5) * 5);
          col = k === 0 ? C_CROP0 : k === 1 ? C_CROP1 : k === 2 ? C_CROP2 : P.grassDowns;
        } else if (reg === 'kite-bay' || reg === 'lantern-bay' || reg === 'shell-cove') col = P.grassBay;
        else if (reg === 'the-crown') col = P.grassCrown;
        else col = P.grassCity;
      }
      surface[c] = s;
      // ── tile colour: per-tile jitter, slope darkening, baked shade
      const j = 0.92 + hash2(cx, cz) * 0.16;
      const lit = Math.max(0.55, 1 - slope * 0.35 - shade[c]! - (depth > 0.05 ? 0 : 0));
      const o = c * 4;
      tileTex[o] = Math.min(255, Math.round(col[0] * j * lit));
      tileTex[o + 1] = Math.min(255, Math.round(col[1] * j * lit));
      tileTex[o + 2] = Math.min(255, Math.round(col[2] * j * lit));
      tileTex[o + 3] = depth > 0 ? Math.min(255, Math.round(depth * 10)) : 0;
      // ── minimap pixel (scalars: same arithmetic as the array form, no allocation)
      let mr: number;
      let mg: number;
      let mb: number;
      if (depth > 0.05) {
        const k = Math.min(1, depth / 20);
        if (wl > 0) {
          mr = 70;
          mg = 190;
          mb = 200;
        } else {
          mr = Math.round(40 - 20 * k);
          mg = Math.round(120 - 60 * k);
          mb = Math.round(170 - 40 * k);
        }
      } else {
        const sh = Math.max(0.65, Math.min(1.15, 1 - (gx * 0.6 + gz * 0.8) * 0.9));
        mr = col[0] * sh;
        mg = col[1] * sh;
        mb = col[2] * sh;
        if (roadOn) {
          const r = roads[roadI]!;
          const mc: RGB = r.def.kind === 'highway' ? M_HIGHWAY : r.def.kind === 'rail' ? M_RAIL : r.def.surface === 'dirt' ? M_DIRT : r.def.surface === 'cobble' ? M_COBBLE : M_ROAD;
          mr = mc[0];
          mg = mc[1];
          mb = mc[2];
        }
        if (shade[c]! > 0.3) {
          mr = mr * 0.55;
          mg = mg * 0.55;
          mb = mb * 0.6;
        }
      }
      minimap[o] = Math.min(255, Math.round(mr));
      minimap[o + 1] = Math.min(255, Math.round(mg));
      minimap[o + 2] = Math.min(255, Math.round(mb));
      minimap[o + 3] = 255;
    }
  return { surface, region, tileTex, fieldTex, minimap };
}
