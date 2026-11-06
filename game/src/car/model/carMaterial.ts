/**
 * The car's single shared material + its voxel palette.
 *
 * MeshStandardMaterial patched to read per-vertex attributes written by VoxelGrid:
 *   glow    → static emissive (albedo × glow)
 *   surf    → per-vertex roughness / metalness (glossy glass, satin paint, matte carbon, rubber)
 *   channel → adds `uChannels[channel]` (an RGB radiance updated every frame) for the parts that
 *             react to the sim: headlights, tail/brake lights, exhaust, aero-status LEDs.
 * Body, wheels and the front-wing flaps all share it, so they share one shader program.
 */
import { Color, MeshStandardMaterial, Vector3 } from 'three';
import { PALETTE } from '../../scene/Environment';
import type { VoxelMaterial } from './voxelGrid';

/** Live emissive channels (index into uChannels). */
export const CH = {
  none: 0,
  headlight: 1,
  tail: 2,
  exhaust: 3,
  aero: 4,
} as const;
export const CHANNEL_COUNT = 5;

/** Car livery colours (sRGB). Neon accents come straight from the dashboard/HUD palette. */
export const CAR_COLORS = {
  paint: '#EEF2F8',
  carbon: '#15171E',
  glass: '#1B3A5A',
  glassStreak: '#6FB6D6',
  intake: '#06070B',
  grille: '#101320',
  tyre: '#121318',
  tread: '#1E2029',
  rimBarrel: '#2B303C',
  cyan: PALETTE.cyan,
  magenta: PALETTE.magenta,
  yellow: PALETTE.yellow,
} as const;

/** Palette indices. 0 is reserved for "empty" by VoxelGrid. */
export const M = {
  empty: 0,
  paint: 1,
  carbon: 2,
  glass: 3,
  glassStreak: 4,
  intake: 5,
  grille: 6,
  cyanStripe: 7,
  magentaStripe: 8,
  headlight: 9,
  tail: 10,
  exhaust: 11,
  aeroLed: 12,
  tyre: 13,
  tread: 14,
  rim: 15,
  rimBarrel: 16,
  hub: 17,
  sidewallBand: 18,
  /** Secondary body colour (two-tone liveries). */
  paint2: 19,
  /** Polished metal: bumpers, exhaust tips, rims. */
  chrome: 20,
  /** White decals: number boards, racing roundels. */
  decal: 21,
  /** Roll-cage tubes. */
  cage: 22,
} as const;

/** Palette slots a car class may recolour (its livery): material index → overrides. */
export type Livery = Partial<Record<number, Partial<VoxelMaterial>>>;

export const CAR_VOXEL_MATERIALS: readonly VoxelMaterial[] = (() => {
  const t: VoxelMaterial[] = [];
  t[M.empty] = { color: '#000000', roughness: 1, metalness: 0 };
  // A whisper of self-illumination keeps the white readable in shadow against the dark void.
  t[M.paint] = { color: CAR_COLORS.paint, roughness: 0.42, metalness: 0.05, glow: 0.05, jitter: 0.035 };
  t[M.carbon] = { color: CAR_COLORS.carbon, roughness: 0.5, metalness: 0.35, jitter: 0.12 };
  t[M.glass] = { color: CAR_COLORS.glass, roughness: 0.08, metalness: 0.35, jitter: 0.04 };
  t[M.glassStreak] = { color: CAR_COLORS.glassStreak, roughness: 0.05, metalness: 0.2, glow: 0.12 };
  t[M.intake] = { color: CAR_COLORS.intake, roughness: 0.95, metalness: 0, jitter: 0.05 };
  t[M.grille] = { color: CAR_COLORS.grille, roughness: 0.7, metalness: 0.3, jitter: 0.15 };
  t[M.cyanStripe] = { color: CAR_COLORS.cyan, roughness: 0.4, metalness: 0, glow: 1.4 };
  t[M.magentaStripe] = { color: CAR_COLORS.magenta, roughness: 0.4, metalness: 0, glow: 1.3 };
  t[M.headlight] = { color: '#9FEFFF', roughness: 0.2, metalness: 0, channel: CH.headlight };
  t[M.tail] = { color: '#5A0A22', roughness: 0.3, metalness: 0, channel: CH.tail };
  t[M.exhaust] = { color: '#1A1416', roughness: 0.4, metalness: 0.6, channel: CH.exhaust };
  t[M.aeroLed] = { color: '#202833', roughness: 0.3, metalness: 0, channel: CH.aero };
  t[M.tyre] = { color: CAR_COLORS.tyre, roughness: 0.92, metalness: 0, jitter: 0.06 };
  t[M.tread] = { color: CAR_COLORS.tread, roughness: 0.95, metalness: 0, jitter: 0.06 };
  t[M.rim] = { color: CAR_COLORS.cyan, roughness: 0.25, metalness: 0.3, glow: 0.9 };
  t[M.rimBarrel] = { color: CAR_COLORS.rimBarrel, roughness: 0.35, metalness: 0.7, jitter: 0.08 };
  t[M.hub] = { color: CAR_COLORS.yellow, roughness: 0.3, metalness: 0.2, glow: 0.7 };
  t[M.sidewallBand] = { color: CAR_COLORS.yellow, roughness: 0.6, metalness: 0, glow: 0.25 };
  t[M.paint2] = { color: '#15171E', roughness: 0.45, metalness: 0.2, jitter: 0.05 };
  t[M.chrome] = { color: '#C9D2E0', roughness: 0.18, metalness: 0.9, glow: 0.04, jitter: 0.05 };
  t[M.decal] = { color: '#F4F7FB', roughness: 0.5, metalness: 0, glow: 0.12, jitter: 0.02 };
  t[M.cage] = { color: '#20232C', roughness: 0.4, metalness: 0.6, jitter: 0.08 };
  return t;
})();

const liveryCache = new Map<Livery, readonly VoxelMaterial[]>();

/** The voxel palette with a livery's overrides applied (cached per livery object). */
export function materialsWithLivery(livery: Livery | undefined): readonly VoxelMaterial[] {
  if (!livery) return CAR_VOXEL_MATERIALS;
  const cached = liveryCache.get(livery);
  if (cached) return cached;
  const table = CAR_VOXEL_MATERIALS.map((m, i) => {
    const o = livery[i];
    return o ? { ...m, ...o } : m;
  });
  liveryCache.set(livery, table);
  return table;
}

export interface CarMaterialHandle {
  material: MeshStandardMaterial;
  /** Linear RGB radiance per channel; mutate in place every frame. */
  channels: Vector3[];
}

/** Writes `color × intensity` (linear) into a channel slot without allocating. */
export function setChannel(handle: CarMaterialHandle, channel: number, color: Color, intensity: number): void {
  handle.channels[channel]?.set(color.r * intensity, color.g * intensity, color.b * intensity);
}

export function createCarMaterial(): CarMaterialHandle {
  const channels = Array.from({ length: CHANNEL_COUNT }, () => new Vector3());
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  material.name = 'voxel-car';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uChannels = { value: channels };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float glow;
attribute float channel;
attribute vec2 surf;
uniform vec3 uChannels[${CHANNEL_COUNT}];
varying float vGlow;
varying vec2 vSurf;
varying vec3 vChannelRadiance;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vGlow = glow;
vSurf = surf;
vChannelRadiance = uChannels[int(channel + 0.5)];`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vGlow;
varying vec2 vSurf;
varying vec3 vChannelRadiance;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * vGlow + vChannelRadiance;`,
      );
  };
  material.customProgramCacheKey = () => 'voxel-car-v1';
  return { material, channels };
}
