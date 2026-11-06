/**
 * Builds each car class's geometries once per page and caches them: the car remounts on a track
 * or car change, the voxel meshes never need rebuilding. One material (and one flame material)
 * serves every class — only one car is mounted at a time and the liveries live in vertex colours.
 *
 * A LOOK (ride/livery.ts: the active driver's painted window or bust colours, and MY RIDE's paint,
 * trim, wheels, spoiler and exhaust tips) is applied over the class's cached body grid; the result
 * is cached by `carId|rideLookKey|avatarKey` in a small LRU (evicted geometries are disposed), so
 * toggling a paint back and forth costs nothing and the stock look of a class is built once.
 */
import { AdditiveBlending, BoxGeometry, BufferGeometry, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { avatarKey } from '../../drivers/avatar';
import { rideLookKey } from '../../ride/config';
import { applyLook, type LookSpec } from '../../ride/livery';
import { baseGridFor } from '../../ride/previewAssets';
import { getVehicleSpec, type Tuple3 } from '../vehicleSpec';
import { createCarMaterial, type CarMaterialHandle } from './carMaterial';
import { buildFrontWingGeometries, type FrontWingConfig } from './frontWing';
import { CAR_MODELS } from './models';
import { buildWheelGeometry } from './wheelVoxels';
import type { VoxelMeshStats } from './voxelGrid';

export interface CarModelStats {
  carId: CarClassId;
  body: VoxelMeshStats;
  /** Faces that a naive mesher (6 per voxel) would have emitted for the body. */
  bodyNaiveFaces: number;
  wheels: VoxelMeshStats[];
  frontWing: VoxelMeshStats | null;
  buildMs: number;
}

export interface CarAssets {
  carId: CarClassId;
  material: CarMaterialHandle;
  body: BufferGeometry;
  /** Indexed like the spec's wheels (FL, FR, RL, RR). */
  wheels: BufferGeometry[];
  /** The animated front wing in the chassis frame (pivot converted from ground-relative), or null. */
  wing: { config: FrontWingConfig; main: BufferGeometry; upper: BufferGeometry | null } | null;
  /** Flame geometry: blocks behind every outlet, relative to `flameOrigin` (the first outlet's y/z plane); null for a car with no exhaust (electric). */
  flame: BufferGeometry | null;
  flameOrigin: Tuple3;
  flameMaterial: MeshBasicMaterial;
  stats: CarModelStats;
  /** The look these geometries wear (cache key; `stock` = no ride, no driver). */
  lookKey: string;
}

/** No ride, no driver: the class exactly as its shape file paints it. */
export const STOCK_LOOK: Readonly<LookSpec> = Object.freeze({ ride: null, driver: null });

/** Cache key of a look on a class (the same inputs always give the same cells, ride/livery.ts). */
export function lookCacheKey(carId: CarClassId, look: LookSpec): string {
  return `${carId}|${look.ride ? rideLookKey(look.ride) : 'stock'}|${look.driver ? avatarKey(look.driver) : 'none'}`;
}

/** Looks kept built; the mounted car's is always the most recent, so it is never the one evicted. */
const CACHE_MAX = 8;
const cache = new Map<string, CarAssets>();
let sharedMaterial: CarMaterialHandle | null = null;
let sharedFlameMaterial: MeshBasicMaterial | null = null;

/** The one material every car (and the driver bust) draws with. */
export function sharedCarMaterial(): CarMaterialHandle {
  sharedMaterial ??= createCarMaterial();
  return sharedMaterial;
}

function disposeAssets(a: CarAssets): void {
  a.body.dispose();
  for (const w of a.wheels) w.dispose();
  a.wing?.main.dispose();
  a.wing?.upper?.dispose();
  a.flame?.dispose();
}

function flameMaterial(): MeshBasicMaterial {
  if (sharedFlameMaterial) return sharedFlameMaterial;
  const m = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: true,
  });
  m.name = 'voxel-car-flame';
  sharedFlameMaterial = m;
  return m;
}

/** Small voxel flame stacks pointing −Z out of the exhaust outlets (origin = first outlet's plane). */
function buildFlameGeometry(outlets: readonly Tuple3[], origin: Tuple3): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const blocks: [size: number, z: number][] = [
    [0.13, -0.06],
    [0.1, -0.17],
    [0.07, -0.27],
    [0.045, -0.35],
  ];
  for (const outlet of outlets) {
    for (const [size, z] of blocks) {
      const box = new BoxGeometry(size, size, size * 1.15);
      box.translate(outlet[0], outlet[1] - origin[1], outlet[2] - origin[2] + z);
      parts.push(box);
    }
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('flame geometry merge failed');
  return merged;
}

/**
 * Geometry + materials of a car class wearing `look` (built on first use, then cached by class and
 * look). The stock look with no driver is the shape file's car exactly; a driver recolours the glass
 * beside the seat of a closed cabin; a ride repaints, re-wheels and stamps spoiler / exhaust tips
 * (ride/livery.ts). `look.outlets` places the flame, so a ride with exhaust 'none' has no flame.
 */
export function getCarAssets(carId: string = 'hypercar', look: LookSpec = STOCK_LOOK): CarAssets {
  const id: CarClassId = isCarClassId(carId) ? carId : 'hypercar';
  const key = lookCacheKey(id, look);
  const cached = cache.get(key);
  if (cached) {
    // Most recently used last: the mounted car's assets are never the ones evicted.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const t0 = performance.now();
  const spec = getVehicleSpec(id);
  const def = CAR_MODELS[id];
  // The class's body grid is filled once per page (shared with the MY RIDE preview); the look copies it.
  const result = applyLook(baseGridFor(id), spec, def, look);
  const materials = result.materials;
  const body = result.grid.build(materials, 1);
  const wheelBuilds = spec.wheels.map((w) => buildWheelGeometry(w, 20 + w.index, materials, result.wheelStyle));
  const toChassis = (p: readonly [number, number, number]): Tuple3 => [p[0], p[1] - spec.rideHeight, p[2]];
  let wing: CarAssets['wing'] = null;
  let wingStats: VoxelMeshStats | null = null;
  if (def.wing) {
    const config: FrontWingConfig = { ...def.wing, pivot: toChassis(def.wing.pivot) };
    const built = buildFrontWingGeometries(config, materials);
    wing = { config, main: built.main, upper: built.upper };
    wingStats = built.stats;
  }
  const outlets = result.outlets.map(toChassis);
  const flameOrigin: Tuple3 = [0, outlets[0]?.[1] ?? 0, outlets[0]?.[2] ?? -spec.body.length / 2];
  const assets: CarAssets = {
    carId: id,
    material: sharedCarMaterial(),
    body: body.geometry,
    wheels: wheelBuilds.map((b) => b.geometry),
    wing,
    flame: outlets.length > 0 ? buildFlameGeometry(outlets, flameOrigin) : null,
    flameOrigin,
    flameMaterial: flameMaterial(),
    stats: {
      carId: id,
      body: body.stats,
      bodyNaiveFaces: body.stats.voxels * 6,
      wheels: wheelBuilds.map((b) => b.stats),
      frontWing: wingStats,
      buildMs: 0,
    },
    lookKey: key,
  };
  assets.stats.buildMs = Math.round((performance.now() - t0) * 10) / 10;
  cache.set(key, assets);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    if (gone) disposeAssets(gone);
  }
  return assets;
}
