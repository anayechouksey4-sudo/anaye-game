/**
 * Place and ramp signs (PLAN §3.9, §4.7): a dark voxel board on two posts (shared voxel material)
 * with the text as glow quads on both faces (eventAtlas cell). Ramp signs show the ramp name and
 * this car's best air off it, never a speed claim; the Saltglass sign shows this car's best
 * speed-trap pass. Texts are measured values from localStorage (physics/records.ts) or a dash.
 */
import type { Box } from '../gen/boxMesher';
import { heightAt } from '../gen/heightAt';
import { REGION_IDS, type RegionId, type SignData, type WorldData } from '../gen/types';
import { bestAir, bestTrap } from '../physics/records';
import type { SignSpec } from './eventAtlas';
import type { GlowBuilder, UvRect } from './glowMaterial';

const REGION_ACCENT: Readonly<Record<RegionId, string>> = {
  sea: '#ffd23f',
  'prism-city': '#38e8ff',
  'kite-bay': '#ffd23f',
  'cinnabar-reach': '#ff8a3d',
  'shell-cove': '#ffd23f',
  'patchwork-downs': '#9be15d',
  'lantern-bay': '#ffd23f',
  'the-crown': '#dfe9ff',
};
const RAMP_ACCENT = '#ffb02e';
/** Bottom edge of a sign board above the ground, m. */
const BOARD_LIFT = 2.2;
const BOARD_DEPTH = 0.3;
/** Glow text fades out by this distance, m. */
export const SIGN_FADE_M = 300;

/** Air records are kept per ramp; the three hay kickers share the first one's record. */
export const recordRampId = (rampId: string): string => (rampId.startsWith('hay-hop') ? 'hay-hop-1' : rampId);

export function regionAt(data: WorldData, x: number, z: number): RegionId {
  const rx = Math.max(0, Math.min(127, Math.floor((x + 1024) / 16)));
  const rz = Math.max(0, Math.min(127, Math.floor((z + 1024) / 16)));
  return REGION_IDS[data.region[rz * 128 + rx] ?? 0] ?? 'sea';
}

const fmtAir = (r: { s: number; m: number } | null): string => (r ? `BEST AIR ${r.s.toFixed(1)} S · ${Math.round(r.m)} M` : 'BEST AIR —');

/** The lines a sign shows for this car right now. */
export function signLines(sign: SignData, carId: string): string[] {
  if (sign.kind === 'ramp' && sign.rampId) {
    if (sign.rampId === 'pier-launch') return [sign.text, 'SPLASH ZONE'];
    return [sign.text, fmtAir(bestAir(carId, recordRampId(sign.rampId)))];
  }
  if (sign.id === 'sign-saltglass') {
    const kmh = bestTrap(carId);
    return [sign.text, kmh === null ? `${sign.sub} · BEST —` : `${sign.sub} · BEST ${Math.round(kmh)} KM/H`];
  }
  return [sign.text, sign.sub];
}

/** Signs whose text depends on this car's records. */
export const isRecordSign = (sign: SignData): boolean => (sign.kind === 'ramp' && sign.rampId !== 'pier-launch') || sign.id === 'sign-saltglass';

export function signSpecs(data: WorldData, carId: string): SignSpec[] {
  return data.signs.map((s) => ({
    width: s.width,
    height: s.height,
    accent: s.kind === 'ramp' ? RAMP_ACCENT : REGION_ACCENT[regionAt(data, s.position[0], s.position[2])],
    lines: signLines(s, carId),
  }));
}

/**
 * Board centre. A place sign's position is road width/2 + 3 m off the centreline, on the board's
 * right axis; the board spans that axis, so it is pushed out until its inner edge clears the road
 * edge by 2 m (posts never stand on the road). Ramp signs already sit clear of the ramp.
 */
export function boardCentre(s: SignData): { x: number; z: number } {
  const push = s.kind === 'place' ? s.width / 2 - 1 : 0;
  return { x: s.position[0] + Math.cos(s.yaw) * push, z: s.position[2] - Math.sin(s.yaw) * push };
}

/** Board + posts (voxel boxes) for every sign. */
export function signBoxes(data: WorldData): Box[] {
  const out: Box[] = [];
  for (const s of data.signs) {
    const c = boardCentre(s);
    const g = heightAt(data.heights, c.x, c.z);
    const cy = g + BOARD_LIFT + s.height / 2;
    out.push({ x: c.x, y: cy, z: c.z, sx: s.width + 0.4, sy: s.height + 0.4, sz: BOARD_DEPTH, yaw: s.yaw, color: 0x15171d, glow: 0, ground: false });
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    for (const side of [-1, 1]) {
      const o = side * (s.width / 2 - 0.6);
      const px = c.x + rx * o;
      const pz = c.z + rz * o;
      const pg = Math.min(g, heightAt(data.heights, px, pz));
      const top = g + BOARD_LIFT + 0.5;
      out.push({ x: px, y: (pg - 0.5 + top) / 2, z: pz, sx: 0.3, sy: top - pg + 0.5, sz: 0.3, yaw: s.yaw, color: 0x2a2d36, glow: 0, ground: true });
    }
  }
  return out;
}

/** Text quads on both faces of every board. */
export function signQuads(data: WorldData, uvs: readonly UvRect[], glow: GlowBuilder): void {
  data.signs.forEach((s, i) => {
    const uv = uvs[i];
    if (!uv) return;
    const c = boardCentre(s);
    const g = heightAt(data.heights, c.x, c.z);
    const cy = g + BOARD_LIFT + s.height / 2;
    const nx = Math.sin(s.yaw);
    const nz = Math.cos(s.yaw);
    const off = BOARD_DEPTH / 2 + 0.03;
    const white: [number, number, number] = [1, 1, 1];
    glow.upright([c.x + nx * off, cy, c.z + nz * off], s.yaw, s.width, s.height, uv, white, SIGN_FADE_M);
    glow.upright([c.x - nx * off, cy, c.z - nz * off], s.yaw + Math.PI, s.width, s.height, uv, white, SIGN_FADE_M);
  });
}
