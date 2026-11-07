/**
 * Geometry and materials for kinematic cars (rivals, ghost, remote players), built from the same
 * voxel pipeline as the player's car (ride/livery.ts applyLook over the class grid, the car
 * material's vertex attributes) at HALF resolution: every 2×2×2 block of the look's grid becomes
 * one voxel (majority material, kept when ≥ 2 of the 8 cells are filled, so one-voxel wings and
 * struts survive). A full car (body + wing merged, 4 wheels, plate) is ~5–8 k triangles instead
 * of 13–17 k, so three rivals fit the +30 k budget. Cached per class + look (LRU, disposed on
 * eviction); the materials are shared.
 */
import { BufferGeometry, Matrix4, type MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { avatarKey } from '../drivers/avatar';
import { CAR_COLORS, CH, createCarMaterial, type CarMaterialHandle } from '../car/model/carMaterial';
import { buildFrontWingGeometries, type FrontWingConfig } from '../car/model/frontWing';
import { CAR_MODELS } from '../car/model/models';
import { VoxelGrid, type VoxelMaterial } from '../car/model/voxelGrid';
import { buildWheelGeometry } from '../car/model/wheelVoxels';
import { getVehicleSpec } from '../car/vehicleSpec';
import { rideLookKey } from '../ride/config';
import { applyLook, type LookSpec } from '../ride/livery';
import { baseGridFor } from '../ride/previewAssets';
import { Color } from 'three';

export interface RivalAssets {
  carId: CarClassId;
  /** Body (+ front wing at its mid pose) in the chassis frame. */
  body: BufferGeometry;
  /** One wheel geometry per spec wheel index (the rear one serves the InstancedMesh). */
  wheels: BufferGeometry[];
  triangles: number;
  lookKey: string;
  buildMs: number;
}

const STOCK: LookSpec = { ride: null, driver: null };
const CACHE_MAX = 8;
const cache = new Map<string, RivalAssets>();

export function rivalLookKey(carId: CarClassId, look: LookSpec | null): string {
  const l = look ?? STOCK;
  return `${carId}|${l.ride ? rideLookKey(l.ride) : 'stock'}|${l.driver ? avatarKey(l.driver) : 'none'}`;
}

/** Half-resolution copy of a grid: majority material of each 2×2×2 block when ≥ `keep` cells are filled. */
export function downsampleGrid(g: VoxelGrid, f = 2, keep = 2): VoxelGrid {
  const [nx, ny, nz] = g.n;
  const out = new VoxelGrid([Math.ceil(nx / f), Math.ceil(ny / f), Math.ceil(nz / f)], [g.size[0] * f, g.size[1] * f, g.size[2] * f], [g.origin[0], g.origin[1], g.origin[2]]);
  const counts = new Uint8Array(256);
  const [cx, cy, cz] = out.n;
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        counts.fill(0);
        let filled = 0;
        let best = 0;
        let bestN = 0;
        for (let dk = 0; dk < f; dk++)
          for (let dj = 0; dj < f; dj++)
            for (let di = 0; di < f; di++) {
              const m = g.get(i * f + di, j * f + dj, k * f + dk);
              if (m === 0) continue;
              filled++;
              const n = ++counts[m]!;
              if (n > bestN) {
                bestN = n;
                best = m;
              }
            }
        if (filled >= keep) out.set(i, j, k, best);
      }
  return out;
}

const _mat = new Matrix4();

/** The class's front wing at its mid pose, merged into one geometry in the chassis frame (null without a wing). */
function wingGeometry(config: FrontWingConfig, materials: readonly VoxelMaterial[]): BufferGeometry | null {
  const built = buildFrontWingGeometries(config, materials);
  const parts: BufferGeometry[] = [];
  const mainDeg = config.mainDeg ?? [4, 22];
  const mainAngle = ((mainDeg[0] + mainDeg[1]) / 2) * (Math.PI / 180);
  _mat.makeRotationX(mainAngle).setPosition(config.pivot[0], config.pivot[1], config.pivot[2]);
  parts.push(built.main.applyMatrix4(_mat));
  if (built.upper && config.upper) {
    const upperDeg = config.upperDeg ?? [8, 38];
    const upperAngle = ((upperDeg[0] + upperDeg[1]) / 2) * (Math.PI / 180);
    const hinge = new Matrix4().makeTranslation(0, config.upper.hingeY, -config.main.chord + config.upper.hingeOverlap);
    const local = new Matrix4().makeRotationX(upperAngle - mainAngle);
    _mat.makeRotationX(mainAngle).setPosition(config.pivot[0], config.pivot[1], config.pivot[2]).multiply(hinge).multiply(local);
    parts.push(built.upper.applyMatrix4(_mat));
  }
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts);
  if (parts.length > 1) for (const p of parts) p.dispose();
  return merged;
}

function disposeAssets(a: RivalAssets): void {
  a.body.dispose();
  for (const w of a.wheels) w.dispose();
}

/** Geometry of `carId` wearing `look` at rival resolution (cached). */
export function getRivalAssets(carId: string, look: LookSpec | null): RivalAssets {
  const id: CarClassId = isCarClassId(carId) ? carId : 'hypercar';
  const key = rivalLookKey(id, look);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const t0 = performance.now();
  const spec = getVehicleSpec(id);
  const def = CAR_MODELS[id];
  const result = applyLook(baseGridFor(id), spec, def, look ?? STOCK);
  const coarse = downsampleGrid(result.grid, 2, 2);
  const bodyBuild = coarse.build(result.materials, 7);
  let body = bodyBuild.geometry;
  let triangles = bodyBuild.stats.triangles;
  if (def.wing) {
    const config: FrontWingConfig = { ...def.wing, pivot: [def.wing.pivot[0], def.wing.pivot[1] - spec.rideHeight, def.wing.pivot[2]] };
    const wing = wingGeometry(config, result.materials);
    if (wing) {
      const merged = mergeGeometries([body, wing]);
      if (merged) {
        body.dispose();
        wing.dispose();
        body = merged;
      }
      triangles += (wing.index ? wing.index.count : wing.attributes.position!.count) / 3;
    }
  }
  const wheels = spec.wheels.map((w) => {
    const built = buildWheelGeometry(w, 20 + w.index, result.materials, result.wheelStyle);
    triangles += built.stats.triangles;
    return built.geometry;
  });
  const assets: RivalAssets = { carId: id, body, wheels, triangles, lookKey: key, buildMs: Math.round((performance.now() - t0) * 10) / 10 };
  cache.set(key, assets);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    if (gone) disposeAssets(gone);
  }
  return assets;
}

export function rivalAssetCacheStats(): { size: number; keys: string[]; triangles: number[] } {
  return { size: cache.size, keys: [...cache.keys()], triangles: [...cache.values()].map((a) => a.triangles) };
}

// ── Materials ───────────────────────────────────────────────────────────────
// Every kinematic car draws with the player's car shader (same program when opaque). The live
// channels (headlights, tail, exhaust, aero LEDs) are static for kinematic cars: one shared set.
let channelsHandle: CarMaterialHandle | null = null;
function sharedChannels(): CarMaterialHandle {
  if (channelsHandle) return channelsHandle;
  channelsHandle = createCarMaterial();
  const set = (ch: number, hex: string, k: number) => {
    const c = new Color(hex);
    channelsHandle!.channels[ch]!.set(c.r * k, c.g * k, c.b * k);
  };
  set(CH.headlight, '#BDF6FF', 2.2);
  set(CH.tail, CAR_COLORS.magenta, 1.6);
  set(CH.exhaust, CAR_COLORS.yellow, 0.8);
  set(CH.aero, CAR_COLORS.cyan, 1.2);
  return channelsHandle;
}

/**
 * A material instance for one kinematic car: the car shader with the shared static channels.
 * `transparent` cars get their own depth-written translucent instance (opacity set by the caller).
 */
export function kinematicMaterial(): MeshStandardMaterial {
  const shared = sharedChannels();
  const handle = createCarMaterial();
  const material = handle.material;
  const orig = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    orig.call(material, shader, renderer);
    shader.uniforms.uChannels = { value: shared.channels };
  };
  material.name = 'voxel-car-kinematic';
  return material;
}
