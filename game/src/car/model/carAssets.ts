/**
 * Builds each car class's geometries once per page and caches them: the car remounts on a track
 * or car change, the voxel meshes never need rebuilding. One material (and one flame material)
 * serves every class — only one car is mounted at a time and the liveries live in vertex colours.
 */
import { AdditiveBlending, BoxGeometry, BufferGeometry, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { getVehicleSpec, type Tuple3 } from '../vehicleSpec';
import { createCarMaterial, materialsWithLivery, type CarMaterialHandle } from './carMaterial';
import { buildFrontWingGeometries, type FrontWingConfig } from './frontWing';
import { CAR_MODELS } from './models';
import { DEFAULT_WHEEL_STYLE, buildWheelGeometry } from './wheelVoxels';
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
  /** Flame geometry: blocks behind every outlet, relative to `flameOrigin` (the first outlet's y/z plane). */
  flame: BufferGeometry;
  flameOrigin: Tuple3;
  flameMaterial: MeshBasicMaterial;
  stats: CarModelStats;
}

const cache = new Map<CarClassId, CarAssets>();
let sharedMaterial: CarMaterialHandle | null = null;
let sharedFlameMaterial: MeshBasicMaterial | null = null;

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

/** Geometry + materials of a car class (built on first use, then cached). */
export function getCarAssets(carId: string = 'hypercar'): CarAssets {
  const id: CarClassId = isCarClassId(carId) ? carId : 'hypercar';
  const cached = cache.get(id);
  if (cached) return cached;
  const t0 = performance.now();
  const spec = getVehicleSpec(id);
  const def = CAR_MODELS[id];
  const materials = materialsWithLivery(def.livery);
  const body = def.buildBody(spec).build(materials, 1);
  const wheelStyle = { ...DEFAULT_WHEEL_STYLE, ...def.wheel };
  const wheelBuilds = spec.wheels.map((w) => buildWheelGeometry(w, 20 + w.index, materials, wheelStyle));
  const toChassis = (p: readonly [number, number, number]): Tuple3 => [p[0], p[1] - spec.rideHeight, p[2]];
  let wing: CarAssets['wing'] = null;
  let wingStats: VoxelMeshStats | null = null;
  if (def.wing) {
    const config: FrontWingConfig = { ...def.wing, pivot: toChassis(def.wing.pivot) };
    const built = buildFrontWingGeometries(config, materials);
    wing = { config, main: built.main, upper: built.upper };
    wingStats = built.stats;
  }
  const outlets = def.exhaust.map(toChassis);
  const flameOrigin: Tuple3 = [0, outlets[0]?.[1] ?? 0, outlets[0]?.[2] ?? -spec.body.length / 2];
  sharedMaterial ??= createCarMaterial();
  const assets: CarAssets = {
    carId: id,
    material: sharedMaterial,
    body: body.geometry,
    wheels: wheelBuilds.map((b) => b.geometry),
    wing,
    flame: buildFlameGeometry(outlets, flameOrigin),
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
  };
  assets.stats.buildMs = Math.round((performance.now() - t0) * 10) / 10;
  cache.set(id, assets);
  return assets;
}
