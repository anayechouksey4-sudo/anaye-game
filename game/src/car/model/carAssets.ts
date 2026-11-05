/**
 * Builds the car's geometries and materials once per page and caches them: the car remounts on a
 * track change, the voxel meshes never need rebuilding.
 */
import { AdditiveBlending, BoxGeometry, BufferGeometry, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WHEELS } from '../vehicleSpec';
import { CAR_VOXEL_MATERIALS, createCarMaterial, type CarMaterialHandle } from './carMaterial';
import { buildFrontWingGeometries } from './frontWing';
import { EXHAUST_OUTLETS, buildHypercarGrid } from './hypercarShape';
import { buildWheelGeometry } from './wheelVoxels';
import type { VoxelMeshStats } from './voxelGrid';

export interface CarModelStats {
  body: VoxelMeshStats;
  /** Faces that a naive mesher (6 per voxel) would have emitted for the body. */
  bodyNaiveFaces: number;
  wheels: VoxelMeshStats[];
  frontWing: VoxelMeshStats;
  buildMs: number;
}

export interface CarAssets {
  material: CarMaterialHandle;
  body: BufferGeometry;
  /** Indexed like WHEELS (FL, FR, RL, RR). */
  wheels: BufferGeometry[];
  wingMain: BufferGeometry;
  wingUpper: BufferGeometry;
  flame: BufferGeometry;
  flameMaterial: MeshBasicMaterial;
  stats: CarModelStats;
}

let cache: CarAssets | null = null;

/** Two small voxel flame stacks pointing −Z out of the exhaust outlets (origin = outlet plane). */
function buildFlameGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const blocks: [size: number, z: number][] = [
    [0.13, -0.06],
    [0.1, -0.17],
    [0.07, -0.27],
    [0.045, -0.35],
  ];
  for (const outlet of EXHAUST_OUTLETS) {
    for (const [size, z] of blocks) {
      const box = new BoxGeometry(size, size, size * 1.15);
      box.translate(outlet[0], 0, z);
      parts.push(box);
    }
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('flame geometry merge failed');
  return merged;
}

export function getCarAssets(): CarAssets {
  if (cache) return cache;
  const t0 = performance.now();
  const grid = buildHypercarGrid();
  const body = grid.build(CAR_VOXEL_MATERIALS, 1);
  const wheelBuilds = WHEELS.map((w) => buildWheelGeometry(w, 20 + w.index));
  const wing = buildFrontWingGeometries();
  const flameMaterial = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: true,
  });
  flameMaterial.name = 'voxel-car-flame';
  cache = {
    material: createCarMaterial(),
    body: body.geometry,
    wheels: wheelBuilds.map((b) => b.geometry),
    wingMain: wing.main,
    wingUpper: wing.upper,
    flame: buildFlameGeometry(),
    flameMaterial,
    stats: {
      body: body.stats,
      bodyNaiveFaces: body.stats.voxels * 6,
      wheels: wheelBuilds.map((b) => b.stats),
      frontWing: wing.stats,
      buildMs: 0,
    },
  };
  cache.stats.buildMs = Math.round((performance.now() - t0) * 10) / 10;
  return cache;
}
