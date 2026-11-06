/**
 * The active driver in the cockpit: the bust boxes (drivers/bust.ts, ≤ 40 boxes ≈ ≤ 480 triangles)
 * merged into ONE BufferGeometry with the car material's vertex attributes (color, glow, channel,
 * surf), so it shares the car's material and costs one draw call (no shadow pass: `castShadow`
 * off). Geometries are cached per avatar and reused across cars.
 *
 * Mount inside CarModel's root group (chassis frame) with the class id and ride height; the seat
 * anchor comes from ride/anchors.ts. Open cockpits (formula, buggy) show it; a closed cabin hides
 * it inside its voxels, so CarModel should mount it only when `seatFor(carId).open` (the livery
 * paints a driver window into the glass of closed cabins instead).
 */
import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, type Material } from 'three';
import { sharedCarMaterial } from '../car/model/carAssets';
import { seatFor } from '../ride/anchors';
import { avatarKey, type AvatarConfig } from './avatar';
import { buildBustBoxes, type Box } from './bust';

// Face table (same winding as voxelGrid.ts): neighbour direction, 4 corners of a unit cube.
type V3 = readonly [number, number, number];
const FACES: { d: V3; c: [V3, V3, V3, V3] }[] = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const _color = new Color();

/** One geometry for a list of boxes, with the car material's attribute layout. */
export function buildBoxGeometry(boxes: readonly Box[]): BufferGeometry {
  const faceCount = boxes.length * 6;
  const vertexCount = faceCount * 4;
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const glow = new Float32Array(vertexCount);
  const channel = new Float32Array(vertexCount);
  const surf = new Float32Array(vertexCount * 2);
  const index = new Uint16Array(faceCount * 6);
  let v = 0;
  let t = 0;
  for (const b of boxes) {
    _color.set(b.m.color);
    const x0 = b.c[0] - b.s[0] / 2;
    const y0 = b.c[1] - b.s[1] / 2;
    const z0 = b.c[2] - b.s[2] / 2;
    for (const f of FACES) {
      const base = v;
      for (const c of f.c) {
        const o3 = v * 3;
        position[o3] = x0 + c[0] * b.s[0];
        position[o3 + 1] = y0 + c[1] * b.s[1];
        position[o3 + 2] = z0 + c[2] * b.s[2];
        normal[o3] = f.d[0];
        normal[o3 + 1] = f.d[1];
        normal[o3 + 2] = f.d[2];
        color[o3] = _color.r;
        color[o3 + 1] = _color.g;
        color[o3 + 2] = _color.b;
        glow[v] = b.m.glow ?? 0;
        channel[v] = 0;
        surf[v * 2] = b.m.roughness;
        surf[v * 2 + 1] = b.m.metalness;
        v++;
      }
      index[t++] = base;
      index[t++] = base + 1;
      index[t++] = base + 2;
      index[t++] = base;
      index[t++] = base + 2;
      index[t++] = base + 3;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('glow', new BufferAttribute(glow, 1));
  geometry.setAttribute('channel', new BufferAttribute(channel, 1));
  geometry.setAttribute('surf', new BufferAttribute(surf, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const cache = new Map<string, { geometry: BufferGeometry; boxes: number }>();
const CACHE_MAX = 8;

/** The bust geometry of an avatar (cached, small LRU; evicted geometries are disposed). */
export function getBustGeometry(avatar: AvatarConfig): { geometry: BufferGeometry; boxes: number } {
  const key = avatarKey(avatar);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const boxes = buildBustBoxes(avatar);
  const entry = { geometry: buildBoxGeometry(boxes), boxes: boxes.length };
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.geometry.dispose();
    cache.delete(oldest);
  }
  return entry;
}

/** Last mounted bust's size, for `__CARFX__`-style diagnostics. */
export const bustStats = { boxes: 0, triangles: 0 };

export interface DriverBustProps {
  avatar: AvatarConfig;
  /** Car class id: picks the seat anchor and (by default) the car material. */
  carId: string;
  /** The class's ride height (ground-relative seat heights → chassis frame). */
  rideHeight: number;
  /** Material to draw with; default the shared voxel-car material of `carId`. */
  material?: Material;
  /** Render even in a closed cabin (previews); default only open cockpits. */
  force?: boolean;
}

export function DriverBust({ avatar, carId, rideHeight, material, force = false }: DriverBustProps) {
  const seat = seatFor(carId);
  const entry = useMemo(() => getBustGeometry(avatar), [avatar]);
  const mat = material ?? sharedCarMaterial().material;
  if (!seat.open && !force) return null;
  bustStats.boxes = entry.boxes;
  bustStats.triangles = entry.boxes * 12;
  return (
    <mesh
      name="car-driver"
      geometry={entry.geometry}
      material={mat}
      position={[seat.x, seat.h - rideHeight, seat.z]}
      castShadow={false}
      receiveShadow={false}
      dispose={null}
    />
  );
}
