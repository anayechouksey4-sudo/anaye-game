/**
 * The number plate as three.js assets: one canvas-drawn texture + one material per distinct
 * (text, accent) pair, and one 12-triangle box geometry shared by every plate. A plate costs the
 * car +1 draw call, +12 triangles, +1 256 KB texture and +1 shader program (measured, game/README.md
 * "Number plates"). The drawing itself is plateDraw.ts; the emissive map makes it read at night.
 *
 * Cache: `getPlateAsset` keeps the PLATE_CACHE_SIZE most recently used pairs and disposes the
 * texture + material of anything evicted (typing in the editor makes one texture per keystroke,
 * ≈ 1 ms each, never per frame). A plate currently on screen is always the most recent entry, so
 * it is never the one evicted while the editor is open on it.
 */
import { BoxGeometry, CanvasTexture, LinearMipmapLinearFilter, MeshStandardMaterial, NearestFilter, SRGBColorSpace } from 'three';
import { PLATE_TEXTURE_HEIGHT, PLATE_TEXTURE_WIDTH, drawPlate } from './plateDraw';

export { drawPlate };

/** Plate size, metres (a 4:1 plate, 2 cm thick so it reads as a plate, not a decal). */
export const PLATE_WIDTH = 0.52;
export const PLATE_HEIGHT = 0.13;
export const PLATE_THICKNESS = 0.02;
export const PLATE_CACHE_SIZE = 16;

export interface PlateAsset {
  key: string;
  text: string;
  accent: string;
  texture: CanvasTexture;
  material: MeshStandardMaterial;
}

const cache = new Map<string, PlateAsset>();
let built = 0;
let evicted = 0;

function buildAsset(text: string, accent: string): PlateAsset {
  const canvas = document.createElement('canvas');
  canvas.width = PLATE_TEXTURE_WIDTH;
  canvas.height = PLATE_TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) drawPlate(ctx, text, accent);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.name = `plate:${text}`;
  const material = new MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: '#ffffff',
    emissiveIntensity: 0.5,
    roughness: 0.45,
    metalness: 0.1,
  });
  material.name = 'voxel-car-plate';
  built++;
  return { key: `${text}|${accent}`, text, accent, texture, material };
}

/** The texture + material for a plate text in a car's accent (built once, LRU-cached). */
export function getPlateAsset(text: string, accent: string): PlateAsset {
  const key = `${text}|${accent}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh: Map keeps insertion order, the oldest entry is the first key.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const asset = buildAsset(text, accent);
  cache.set(key, asset);
  while (cache.size > PLATE_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    gone?.material.dispose();
    gone?.texture.dispose();
    evicted++;
  }
  return asset;
}

/** Cache counters for tests (`__CARFX__` / the lab page). */
export function plateCacheStats(): { size: number; built: number; evicted: number; keys: string[] } {
  return { size: cache.size, built, evicted, keys: [...cache.keys()] };
}

let geometry: BoxGeometry | null = null;

/** One box for every plate (12 triangles); its +Z face carries the upright texture. */
export function plateGeometry(): BoxGeometry {
  geometry ??= new BoxGeometry(PLATE_WIDTH, PLATE_HEIGHT, PLATE_THICKNESS);
  return geometry;
}
